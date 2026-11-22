/**
 * The signed-in person's channel aliases, shared by every reader
 * (clodia-platform#723): the alias pills in each chat input, the `$name`
 * expansion of the topic composer, and Settings → «Alias canali», which
 * pushes the saved set here so the pills refresh without a reload.
 *
 * Fetched lazily once per session, then refreshed when the tab becomes
 * visible again (aliases edited in another tab or device show up on return).
 */
import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import { getChannelAliases } from '$lib/api/client';

export const channelAliases = writable<Record<string, string>>({});

let loaded = false;
let inflight: Promise<void> | null = null;
let lastFetch = 0;
const REFRESH_MIN_MS = 15_000;

/** Fetch the aliases; `force` refetches even if already loaded. Errors keep
 *  the last known set (the pills are a convenience, never a blocker). */
export function loadChannelAliases(force = false): Promise<void> {
	if (inflight) return inflight;
	if (loaded && !force) return Promise.resolve();
	inflight = getChannelAliases()
		.then((aliases) => {
			channelAliases.set(aliases);
			loaded = true;
		})
		.catch(() => {})
		.finally(() => {
			lastFetch = Date.now();
			inflight = null;
		});
	return inflight;
}

/** Called by the settings section after a successful save. */
export function setChannelAliases(aliases: Record<string, string>): void {
	loaded = true;
	channelAliases.set({ ...aliases });
}

if (browser) {
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState !== 'visible' || !loaded) return;
		if (Date.now() - lastFetch < REFRESH_MIN_MS) return;
		void loadChannelAliases(true);
	});
}
