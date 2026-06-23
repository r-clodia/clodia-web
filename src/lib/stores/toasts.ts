/**
 * Tiny toast store + `pushToast` API.
 *
 * Toasts surface non-blocking feedback for write actions (success / error /
 * info) without ever stealing focus or pausing the UI. Three families:
 *  - `success` — short ack ("Job created", "Reload OK").
 *  - `error`   — surfaces an API failure inline; auto-dismiss after 8s but
 *                the user can also click × to drop it sooner.
 *  - `info`    — neutral note ("Run started", "Polling resumed").
 *
 * The store keeps a single, ordered array (newest first) and exposes a
 * dismiss helper. Toasts auto-expire on a timer; clearing the timer on
 * manual dismissal prevents the race where a user closes a toast just as
 * its TTL fires.
 *
 * Browser-only is implicit: the SPA never runs SSR (adapter-static +
 * `ssr: false`), so we don't need any window-guards here.
 */

import { writable, type Readable } from 'svelte/store';

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
	readonly id: string;
	readonly kind: ToastKind;
	readonly message: string;
	/** Optional secondary line — useful for surfacing the URL of an action. */
	readonly hint?: string;
	/** When 0 / undefined, defaults to the kind's standard TTL. */
	readonly ttlMs?: number;
}

const DEFAULT_TTL: Record<ToastKind, number> = {
	success: 3500,
	info: 4500,
	// Errors stay longer — the user often wants to read the message before it goes.
	error: 8000
};

let _nextId = 1;
function nextId(): string {
	return `t${(_nextId++).toString(36)}-${Date.now().toString(36)}`;
}

const _store = writable<ReadonlyArray<Toast>>([]);
export const toasts: Readable<ReadonlyArray<Toast>> = { subscribe: _store.subscribe };

const _timers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleDismiss(id: string, ttl: number) {
	const t = setTimeout(() => {
		dismissToast(id);
	}, ttl);
	_timers.set(id, t);
}

/** Push a toast. Returns its id so the caller can dismiss it explicitly. */
export function pushToast(input: Omit<Toast, 'id'>): string {
	const id = nextId();
	const ttl = input.ttlMs && input.ttlMs > 0 ? input.ttlMs : DEFAULT_TTL[input.kind];
	const toast: Toast = { id, ...input };
	_store.update((list) => [toast, ...list]);
	scheduleDismiss(id, ttl);
	return id;
}

/** Convenience shorthand for the three families. */
export const toastSuccess = (message: string, hint?: string) =>
	pushToast({ kind: 'success', message, hint });
export const toastError = (message: string, hint?: string) =>
	pushToast({ kind: 'error', message, hint });
export const toastInfo = (message: string, hint?: string) =>
	pushToast({ kind: 'info', message, hint });

/** Drop a toast (manual close or programmatic). */
export function dismissToast(id: string): void {
	const t = _timers.get(id);
	if (t) {
		clearTimeout(t);
		_timers.delete(id);
	}
	_store.update((list) => list.filter((x) => x.id !== id));
}

/** Drop all toasts at once (rare — exposed for tests/dev). */
export function clearToasts(): void {
	for (const t of _timers.values()) clearTimeout(t);
	_timers.clear();
	_store.set([]);
}
