/**
 * Per-page "cards | table" view preference, kept in a cookie
 * (clodia-platform#656).
 *
 * Cookie `clodia_view_<page>=cards|table`, `Path=/`, `SameSite=Lax`, one year.
 * It holds a layout choice and nothing else: no identifier, no personal data —
 * a strictly necessary preference cookie.
 *
 * The app is a SPA (`ssr = false` in `src/routes/+layout.ts`), so there is no
 * server load to read it from. Pages call `readView` synchronously while the
 * component initialises — before the first render, not in `onMount` — so the
 * stored layout is the first one painted and there is no cards→table flicker.
 *
 * Plain JS module on purpose, like `$lib/polling`: `scripts/check-view-pref.mjs`
 * imports and runs it.
 */

/** @typedef {'cards' | 'table'} ViewMode */

/** @type {ReadonlyArray<ViewMode>} */
export const VIEW_MODES = ['cards', 'table'];

/** @type {ViewMode} */
export const DEFAULT_VIEW = 'cards';

/** One year, in seconds. */
export const VIEW_COOKIE_MAX_AGE = 31_536_000;

/**
 * Cookie name for a page. Only `[a-z0-9_-]` survive, so a page id can never
 * break out of the cookie name.
 * @param {string} page
 * @returns {string}
 */
export function viewCookieName(page) {
	const safe = String(page).toLowerCase().replace(/[^a-z0-9_-]/g, '');
	return `clodia_view_${safe}`;
}

/**
 * Normalise any value to a valid mode: anything that is not exactly
 * `cards` or `table` falls back to the default.
 * @param {unknown} value
 * @returns {ViewMode}
 */
export function normalizeView(value) {
	return value === 'table' || value === 'cards' ? value : DEFAULT_VIEW;
}

/**
 * Read a page's view from a `document.cookie`-style string.
 * @param {string | null | undefined} cookieHeader
 * @param {string} page
 * @returns {ViewMode}
 */
export function parseView(cookieHeader, page) {
	if (!cookieHeader) return DEFAULT_VIEW;
	const name = viewCookieName(page);
	for (const part of String(cookieHeader).split(';')) {
		const eq = part.indexOf('=');
		if (eq < 0) continue;
		if (part.slice(0, eq).trim() !== name) continue;
		return normalizeView(part.slice(eq + 1).trim());
	}
	return DEFAULT_VIEW;
}

/**
 * The `Set-Cookie`-style string to store a page's view.
 * @param {string} page
 * @param {unknown} view
 * @returns {string}
 */
export function serializeView(page, view) {
	return `${viewCookieName(page)}=${normalizeView(view)}; Path=/; Max-Age=${VIEW_COOKIE_MAX_AGE}; SameSite=Lax`;
}

/**
 * Read the stored view in the browser; `cards` outside it.
 * @param {string} page
 * @returns {ViewMode}
 */
export function readView(page) {
	if (typeof document === 'undefined') return DEFAULT_VIEW;
	try {
		return parseView(document.cookie, page);
	} catch {
		return DEFAULT_VIEW;
	}
}

/**
 * Store the view in the browser. A blocked cookie only loses the preference.
 * @param {string} page
 * @param {unknown} view
 */
export function writeView(page, view) {
	if (typeof document === 'undefined') return;
	try {
		document.cookie = serializeView(page, view);
	} catch {
		/* cookies disabled: the choice lasts for this page view only */
	}
}
