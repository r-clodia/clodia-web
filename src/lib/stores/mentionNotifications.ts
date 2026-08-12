import { get } from 'svelte/store';
import { browser } from '$app/environment';
import { session } from '$lib/auth/session';
import { toastInfo } from '$lib/stores/toasts';
import { activeTopic, topicKey } from '$lib/stores/unread';

export interface ChannelMessagePayload {
	tier?: unknown;
	name?: unknown;
	author?: unknown;
	kind?: unknown;
	id?: unknown;
	text?: unknown;
	mentions?: unknown;
	topic_title?: unknown;
}

const BLINK_MS = 1000;
let blinkTimer: ReturnType<typeof setInterval> | null = null;
let blinkBaseTitle = '';
let blinkOn = false;
const seenToasts = new Set<string>();

function stopBlink() {
	if (!browser) return;
	if (blinkTimer) clearInterval(blinkTimer);
	blinkTimer = null;
	blinkOn = false;
	if (blinkBaseTitle) document.title = blinkBaseTitle;
}

function startBlink() {
	if (!browser || blinkTimer || document.visibilityState === 'visible') return;
	blinkBaseTitle = document.title || 'Clodia';
	blinkTimer = setInterval(() => {
		blinkOn = !blinkOn;
		document.title = blinkOn ? '● Mention — Clodia' : blinkBaseTitle;
	}, BLINK_MS);
}

function asString(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

function mentionsFor(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.map((v) => String(v).toLowerCase());
}

function topicHref(tier: string, name: string, id: string): string {
	const base = `/topics/${encodeURIComponent(tier)}/${encodeURIComponent(name)}`;
	return id ? `${base}#m-${encodeURIComponent(id)}` : base;
}

function snippet(text: string): string {
	const compact = text.split(/\s+/).filter(Boolean).join(' ');
	return compact.length <= 96 ? compact : `${compact.slice(0, 95).trim()}…`;
}

export function handleMentionEvent(payload: ChannelMessagePayload): void {
	if (!browser) return;
	const principal = get(session)?.principal?.toLowerCase();
	if (!principal) return;
	const tier = asString(payload.tier);
	const name = asString(payload.name);
	if (!tier || !name) return;
	if (!mentionsFor(payload.mentions).includes(principal)) return;
	if (asString(payload.author).toLowerCase() === principal) return;

	const key = topicKey(tier, name);
	const foregroundHere = document.visibilityState === 'visible' && get(activeTopic) === key;
	if (foregroundHere) return;

	const id = asString(payload.id);
	const dedupeKey = id ? `${key}/${id}/${principal}` : `${key}/${Date.now()}`;
	if (!seenToasts.has(dedupeKey)) {
		seenToasts.add(dedupeKey);
		const title = asString(payload.topic_title) || name;
		const author = asString(payload.author) || 'qualcuno';
		const text = snippet(asString(payload.text));
		toastInfo(
			`${author} ti ha menzionato in ${title}`,
			[text, topicHref(tier, name, id)].filter(Boolean).join(' · ')
		);
	}

	if (document.visibilityState !== 'visible') startBlink();
}

if (browser) {
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') stopBlink();
	});
}
