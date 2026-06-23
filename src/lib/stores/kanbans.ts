/**
 * Shared store for the KANBAN wallboard — readonly aggregate of Trello
 * boards configured server-side. Polled at 30s (looser cadence than
 * jobs/consumer-status: card counts don't change second-by-second and the
 * backend already caches Trello calls for 60s anyway).
 *
 * Lifecycle parity with `jobs.ts`/`consumer-status.ts`:
 *  - reference-counted (single timer regardless of subscribers);
 *  - paused while the tab is hidden (Page Visibility API);
 *  - in-flight aborts on stop / refresh so we don't race state.
 */

import { writable, type Readable } from 'svelte/store';
import { ApiError, getKanbans } from '$lib/api/client';
import type { Kanban } from '$lib/api/types';

const POLL_INTERVAL_MS = 30_000;

interface KanbansState {
	data: ReadonlyArray<Kanban> | null;
	loading: boolean;
	error: string | null;
	lastFetchTs: number | null;
}

const initial: KanbansState = {
	data: null,
	loading: false,
	error: null,
	lastFetchTs: null
};

const _state = writable<KanbansState>(initial);

export const kanbansStore: Readable<KanbansState> = { subscribe: _state.subscribe };

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
		const kanbans = await getKanbans({ signal: ctrl.signal });
		if (ctrl.signal.aborted) return;
		_state.set({
			data: kanbans,
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

export function startKanbansPolling(): () => void {
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

export function refreshKanbans(): Promise<void> {
	return pollOnce();
}
