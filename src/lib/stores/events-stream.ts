/**
 * Global SSE multiplexer.
 *
 * The agent-server exposes a single broadcast stream at `/clodia/events`
 * that fans out every event published on the internal `EventBus`:
 *   - `agent_activity`  → an agent recorded a new activity entry
 *                         (run_started / run_done / handoff_* / ...)
 *   - `chat_*`          → chat lifecycle events (created, updated, deleted)
 *   - `message`, `message_chunk`, `tool_use`, `tool_result`,
 *     `thinking_chunk`, `task_progress`, `usage`, `status`, `interrupted`,
 *     `error` → in-chat streaming events (consumed by /chats/+page.svelte)
 *
 * This module opens ONE stream (a `fetch` reader, #511) for the lifetime of the SPA the first
 * time `startEventStream()` is called, and reference-counts subscribers so
 * the connection stays open while at least one page wants it.
 *
 * Pages can either:
 *   1. Subscribe to a typed event channel via `onEventStream(handler)` —
 *      receives every event (filtered by `type` if they want).
 *   2. Subscribe to the `agentActivityTick` readable store — increments
 *      every time an `agent_activity` event arrives, useful as a "refresh
 *      now" signal for pollers (jobs list, activity log, ...).
 *
 * Reconnect: the stream is a `fetch` reader (#511), which does not retry by
 * itself: on `onerror` (failure or end of stream) we tear down and reopen
 * with a simple 1s/2s/5s backoff.
 *
 * ONE stream per browser, not per tab (clodia-platform#509). A plain-http
 * origin (terra: `http://127.0.0.1:7842`) is HTTP/1.1, where the browser
 * keeps at most 6 connections per host: with one stream per tab, the 7th
 * topic tab would leave every API call of every tab queued. So the tabs
 * elect a leader with a Web Lock: only the tab holding it opens the stream,
 * and it re-broadcasts each event on a `BroadcastChannel` the other tabs
 * listen to. When the leader closes, the lock passes to a waiting tab, which
 * opens the stream. Without those APIs each tab keeps its own stream.
 */

import { writable, type Readable } from 'svelte/store';
import { apiSSE, type SSEEvent } from '$lib/api/client';

const STREAM_PATH = '/clodia/events';

/**
 * One event emitted by the multiplexer. We normalise the raw `SSEEvent`
 * into a slightly richer shape so handlers don't have to repeat the
 * `try { JSON.parse(data) } catch` dance.
 */
export interface StreamEvent {
	/** Event type as published by the agent-server (e.g. `agent_activity`). */
	readonly type: string;
	/** Parsed JSON payload, when the event body was JSON. */
	readonly payload: Record<string, unknown> | null;
	/** Raw event passthrough — for debugging or anything we didn't normalise. */
	readonly raw: SSEEvent;
}

type Handler = (ev: StreamEvent) => void;

const _handlers = new Set<Handler>();
let _refCount = 0;
let _cleanup: (() => void) | null = null;
let _retryAttempt = 0;
const _backoffMs = [1000, 2000, 5000];
let _retryTimer: ReturnType<typeof setTimeout> | null = null;
let _lastErrorAt = 0;

/** Bumped every time a fresh `agent_activity` event arrives. */
const _agentActivityTick = writable<number>(0);
export const agentActivityTick: Readable<number> = { subscribe: _agentActivityTick.subscribe };

/** Bumped every time a `chat_*` lifecycle event arrives. */
const _chatLifecycleTick = writable<number>(0);
export const chatLifecycleTick: Readable<number> = { subscribe: _chatLifecycleTick.subscribe };

function isBrowser(): boolean {
	return typeof window !== 'undefined' && typeof fetch !== 'undefined';
}

function fanOut(raw: SSEEvent) {
	_retryAttempt = 0;
	// Server publishes JSON envelopes with `{type, payload, timestamp}`. The
	// SSE plumbing uses the default `message` channel, so the type lives
	// inside the JSON.
	const payload = (raw.json && typeof raw.json === 'object'
		? (raw.json as Record<string, unknown>)
		: null);
	const innerType = payload && typeof payload.type === 'string' ? (payload.type as string) : raw.event;
	const inner = (payload && typeof payload.payload === 'object' && payload.payload !== null
		? (payload.payload as Record<string, unknown>)
		: payload);
	const ev: StreamEvent = { type: innerType, payload: inner, raw };

	// Side-channels for common cases — keeps callers from having to wire a
	// full handler when they only care about "did something happen".
	if (innerType === 'agent_activity') {
		_agentActivityTick.update((n) => n + 1);
	} else if (typeof innerType === 'string' && innerType.startsWith('chat_')) {
		_chatLifecycleTick.update((n) => n + 1);
	}

	for (const h of _handlers) {
		try {
			h(ev);
		} catch (err) {
			console.error('[events-stream] handler threw', err);
		}
	}
}

// ── Cross-tab sharing (#509) ─────────────────────────────────────────────
const LOCK_NAME = 'clodia-events-stream';
const CHANNEL_NAME = 'clodia-events';

let _channel: BroadcastChannel | null = null;
/** A connection is wanted by this tab: as leader (holding the lock) or as a
 *  follower (waiting for it, fed by the channel). */
let _wanted = false;
let _isLeader = false;
let _lockAbort: AbortController | null = null;
let _releaseLock: (() => void) | null = null;

function crossTab(): boolean {
	return (
		typeof BroadcastChannel !== 'undefined' &&
		typeof navigator !== 'undefined' &&
		!!(navigator as Navigator & { locks?: LockManager }).locks
	);
}

function channel(): BroadcastChannel {
	if (!_channel) {
		_channel = new BroadcastChannel(CHANNEL_NAME);
		_channel.onmessage = (m: MessageEvent) => {
			// The leader's own posts never come back to it; a follower fans
			// out what the leader read.
			const raw = (m.data && m.data.kind === 'event' ? m.data.raw : null) as SSEEvent | null;
			if (raw && !_isLeader) fanOut(raw);
		};
	}
	return _channel;
}

function onLeaderEvent(raw: SSEEvent) {
	fanOut(raw);
	try {
		_channel?.postMessage({ kind: 'event', raw });
	} catch {
		/* an event that cannot be cloned stays in this tab */
	}
}

function openConnection() {
	if (!crossTab()) {
		openDirect(fanOut);
		return;
	}
	if (_wanted) return;
	_wanted = true;
	channel();
	_lockAbort = new AbortController();
	navigator.locks
		.request(LOCK_NAME, { signal: _lockAbort.signal }, async () => {
			if (!_wanted) return;
			_isLeader = true;
			openDirect(onLeaderEvent);
			// Held until this tab no longer wants the stream (or closes).
			await new Promise<void>((resolve) => (_releaseLock = resolve));
			_isLeader = false;
			closeDirect();
		})
		.catch(() => {
			/* aborted while waiting: this tab no longer wants it */
		});
}

function closeConnection() {
	if (!crossTab()) {
		closeDirect();
		return;
	}
	_wanted = false;
	_lockAbort?.abort();
	_lockAbort = null;
	if (_releaseLock) {
		_releaseLock();
		_releaseLock = null;
	}
	closeDirect();
}

function openDirect(onEvent: (raw: SSEEvent) => void) {
	if (_cleanup) return;
	_directHandler = onEvent;
	_cleanup = apiSSE(
		STREAM_PATH,
		(raw) => onEvent(raw),
		(err) => {
			// Refused (expired or missing session): retrying every 5 s cannot
			// help. The next subscriber (a navigation, a new login) reopens.
			const status = (err as Event & { status?: number }).status;
			if (status === 401 || status === 403) {
				closeConnection();
				return;
			}
			const now = Date.now();
			if (now - _lastErrorAt < 500) return;
			_lastErrorAt = now;
			scheduleRetry();
		}
	);
}

let _directHandler: (raw: SSEEvent) => void = fanOut;

function closeDirect() {
	if (_cleanup) {
		try {
			_cleanup();
		} catch {
			/* ignore */
		}
		_cleanup = null;
	}
	if (_retryTimer) {
		clearTimeout(_retryTimer);
		_retryTimer = null;
	}
}

function scheduleRetry() {
	if (_retryTimer) return;
	if (_refCount === 0) return;
	const delay = _backoffMs[Math.min(_retryAttempt, _backoffMs.length - 1)];
	_retryAttempt += 1;
	_retryTimer = setTimeout(() => {
		_retryTimer = null;
		// Re-open. The new connection will reset the retry attempt counter
		// as soon as it receives its first event. Only the direct stream:
		// a leader keeps its lock while it reconnects.
		closeDirect();
		if (_refCount > 0) openDirect(_directHandler);
	}, delay);
}

/**
 * Acquire a lease on the global SSE stream. Opens the connection on the
 * first lease and closes it when the last lease is released.
 *
 * Returns a `release` function. Idempotent on repeat release.
 */
export function startEventStream(): () => void {
	if (!isBrowser()) return () => {};
	_refCount += 1;
	// Also when others hold a lease: after a 401/403 the stream stays closed
	// until someone subscribes again (a navigation, a new login).
	if (!_cleanup && !_retryTimer && !_wanted) openConnection();
	let released = false;
	return () => {
		if (released) return;
		released = true;
		_refCount = Math.max(0, _refCount - 1);
		if (_refCount === 0) closeConnection();
	};
}

/**
 * Register a handler that receives every event from the global stream.
 * Returns a `cleanup` function that removes the handler. Typical pattern:
 *
 *   onMount(() => {
 *     const releaseStream = startEventStream();
 *     const off = onEventStream((ev) => { ... });
 *     return () => { off(); releaseStream(); };
 *   });
 */
export function onEventStream(handler: Handler): () => void {
	_handlers.add(handler);
	return () => _handlers.delete(handler);
}
