/**
 * Preferenze UI globali della webui: tema (diurno/notturno) e zoom font.
 * Applicate su `<html>` (data-theme + style.zoom) e persistite in localStorage.
 * Il primo apply avviene già pre-paint via lo script in app.html; qui
 * teniamo lo store in sync e gestiamo i toggle/step.
 */
import { writable } from 'svelte/store';
import { browser } from '$app/environment';

const THEME_KEY = 'clodia.webui.theme';
const FONT_KEY = 'clodia.webui.fontScale';
const MIN = 0.8;
const MAX = 1.6;
const STEP = 0.1;

export type Theme = 'dark' | 'light';

function readTheme(): Theme {
	if (!browser) return 'dark';
	return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
}
function readScale(): number {
	if (!browser) return 1;
	const v = parseFloat(localStorage.getItem(FONT_KEY) || '1');
	return Number.isFinite(v) ? Math.min(MAX, Math.max(MIN, v)) : 1;
}

export const theme = writable<Theme>(readTheme());
export const fontScale = writable<number>(readScale());

function applyTheme(t: Theme): void {
	if (!browser) return;
	document.documentElement.setAttribute('data-theme', t);
	try {
		localStorage.setItem(THEME_KEY, t);
	} catch {
		/* quota/privacy */
	}
}
function applyScale(s: number): void {
	if (!browser) return;
	// `zoom` scala l'intera UI (font in px inclusi); supportato da Chromium/Safari/FF recenti.
	(document.documentElement.style as unknown as { zoom: string }).zoom = String(s);
	// `zoom` scala anche le altezze viewport (100dvh): senza compensazione la shell
	// a height:100dvh diventa più alta della finestra e con overflow:hidden taglia
	// gli elementi in fondo. Esponiamo lo scale come var CSS per dividere le altezze
	// viewport (vedi .app in +layout.svelte). (issue #2)
	document.documentElement.style.setProperty('--ui-zoom', String(s));
	try {
		localStorage.setItem(FONT_KEY, String(s));
	} catch {
		/* quota/privacy */
	}
}

export function toggleTheme(): void {
	theme.update((t) => {
		const next: Theme = t === 'dark' ? 'light' : 'dark';
		applyTheme(next);
		return next;
	});
}

export function incFont(): void {
	fontScale.update((s) => {
		const next = Math.min(MAX, Math.round((s + STEP) * 10) / 10);
		applyScale(next);
		return next;
	});
}
export function decFont(): void {
	fontScale.update((s) => {
		const next = Math.max(MIN, Math.round((s - STEP) * 10) / 10);
		applyScale(next);
		return next;
	});
}

/** Re-applica le preferenze persistite e sincronizza lo store (idempotente). */
export function initPrefs(): void {
	if (!browser) return;
	applyTheme(readTheme());
	applyScale(readScale());
	theme.set(readTheme());
	fontScale.set(readScale());
}
