/**
 * Shared store for the JOBS list — polled lightly so the list view can
 * reflect status / last_run / durata changes (job started, run completed)
 * without each page wiring its own fetch.
 *
 * The agent-server's global SSE stream (`/clodia/events`) does NOT publish
 * job-lifecycle events today; instead, jobs trigger chats. We therefore
 * rely on a low-frequency poll (7s, same cadence as the consumer-status
 * store — within the 5–10s window from the brief), supplemented by a
 * `bumpJobs()` helper that callers fire right after a CRUD action so the
 * effect of the action shows up instantly without waiting for the next
 * tick.
 *
 * Same lifecycle guarantees as `consumer-status.ts`:
 *  - reference-counted (single timer regardless of subscribers);
 *  - paused while the tab is hidden (Page Visibility API);
 *  - in-flight aborts on stop / refresh-bump so we don't race state.
 */

import { writable, type Readable } from 'svelte/store';
import { ApiError, getJobs } from '$lib/api/client';
import type { Job } from '$lib/api/types';

const POLL_INTERVAL_MS = 7_000;

interface JobsState {
	data: ReadonlyArray<Job> | null;
	errors: Record<string, string>;
	loading: boolean;
	error: string | null;
	lastFetchTs: number | null;
}

const initial: JobsState = {
	data: null,
	errors: {},
	loading: false,
	error: null,
	lastFetchTs: null
};

const _state = writable<JobsState>(initial);

export const jobsStore: Readable<JobsState> = { subscribe: _state.subscribe };

let refCount = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight: AbortController | null = null;
let visibilityHandlerAttached = false;

function isBrowser(): boolean {
	return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function isVisible(): boolean {
	if (!isBrowser()) return false;
	return document.visibilityState !== 'hidden';
}

async function pollOnce(): Promise<void> {
	if (!isVisible()) return;
	if (inFlight) inFlight.abort();
	const ctrl = new AbortController();
	inFlight = ctrl;
	_state.update((s) => ({ ...s, loading: true }));
	try {
		const jobs = await getJobs({ signal: ctrl.signal });
		if (ctrl.signal.aborted) return;
		_state.set({
			data: jobs,
			errors: {},
			loading: false,
			error: null,
			lastFetchTs: Date.now()
		});
	} catch (err) {
		if (ctrl.signal.aborted) return;
		const message =
			err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err);
		_state.update((s) => ({ ...s, loading: false, error: message }));
	} finally {
		if (inFlight === ctrl) inFlight = null;
	}
}

function startTimer(): void {
	if (timer !== null) return;
	timer = setInterval(() => void pollOnce(), POLL_INTERVAL_MS);
}

function stopTimer(): void {
	if (timer !== null) {
		clearInterval(timer);
		timer = null;
	}
	if (inFlight) {
		inFlight.abort();
		inFlight = null;
	}
}

function onVisibilityChange(): void {
	if (refCount === 0) return;
	if (isVisible()) {
		void pollOnce();
		startTimer();
	} else {
		stopTimer();
	}
}

function ensureVisibilityListener(): void {
	if (!isBrowser() || visibilityHandlerAttached) return;
	document.addEventListener('visibilitychange', onVisibilityChange);
	visibilityHandlerAttached = true;
}

/** Acquire a polling lease (mirror of `startConsumerStatusPolling`). */
export function startJobsPolling(): () => void {
	if (!isBrowser()) return () => {};
	refCount += 1;
	ensureVisibilityListener();
	if (refCount === 1) {
		void pollOnce();
		if (isVisible()) startTimer();
	}
	let released = false;
	return () => {
		if (released) return;
		released = true;
		refCount = Math.max(0, refCount - 1);
		if (refCount === 0) stopTimer();
	};
}

/** Force an immediate refresh (e.g. after a create/edit/delete/run action). */
export function refreshJobs(): Promise<void> {
	return pollOnce();
}

/**
 * Fire-and-forget bump used by CRUD callers right after a successful
 * mutation. Like `refreshJobs()` but explicitly non-awaitable so callers
 * don't have to add an `await` they don't need.
 */
export function bumpJobs(): void {
	void pollOnce();
}
