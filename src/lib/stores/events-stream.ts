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
 * This module opens ONE EventSource for the lifetime of the SPA the first
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
 * Reconnect: the browser-native EventSource auto-reconnects on transient
 * drops, but to recover from a server restart cleanly we tear down and
 * reopen with a simple 1s/2s/5s backoff on `onerror`.
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
	return typeof window !== 'undefined' && typeof EventSource !== 'undefined';
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

function openConnection() {
	if (_cleanup) return;
	_cleanup = apiSSE(
		STREAM_PATH,
		(raw) => fanOut(raw),
		(_err) => {
			const now = Date.now();
			if (now - _lastErrorAt < 500) return;
			_lastErrorAt = now;
			scheduleRetry();
		}
	);
}

function closeConnection() {
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
		// as soon as it receives its first event.
		closeConnection();
		if (_refCount > 0) openConnection();
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
	if (_refCount === 1) openConnection();
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
