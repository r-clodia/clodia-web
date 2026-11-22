/**
 * The return of an MCP OAuth consent to the webui (clodia-platform#534).
 *
 * The consent leaves the Tools page for the authorization server and comes
 * back to `/tools/oauth/callback?code=…&state=…`. Two things live here, in
 * plain JS so the guard (`scripts/check-mcp-oauth-callback.mjs`) can RUN them
 * instead of reading their text:
 *
 * 1. **the binding to this browser session** — before leaving, the page
 *    writes `{state, server, returnTo}` to `sessionStorage` (per tab, gone
 *    when the tab closes). The callback forwards a `state` ONLY if this tab
 *    started it, and consumes the entry first: a link with someone else's
 *    `code` and `state` opened here forwards nothing, and a reload of the
 *    callback cannot replay. The gateway keeps its own checks (unknown,
 *    expired, already used, other backend, other session): this one is in
 *    front of them, not instead of them.
 *
 * 2. **where to go back** — only a path of this webui, under a page that can
 *    start a consent. Never an absolute URL, never `//host`, never a
 *    backslash, never the callback itself. Same rule as the gateway's
 *    `mcp_oauth.safe_return_path`: a wrong return costs a click, an open
 *    redirect costs the consent.
 */

export const CALLBACK_PATH = '/tools/oauth/callback';
export const DEFAULT_RETURN = '/tools';
export const RETURN_PREFIXES = ['/tools', '/packs', '/topics', '/databases', '/settings', '/agents'];

const KEY = 'clodia.mcpOAuth.';
/** Same lifetime as the gateway's pending consent (`FLOW_TTL_S`). */
export const PENDING_TTL_MS = 10 * 60 * 1000;

/**
 * @param {unknown} raw
 * @returns {string}
 */
export function safeReturnPath(raw) {
	if (typeof raw !== 'string') return DEFAULT_RETURN;
	const s = raw.trim();
	if (!s || s.length > 512 || !s.startsWith('/') || s.startsWith('//') || s.includes('\\')) {
		return DEFAULT_RETURN;
	}
	// eslint-disable-next-line no-control-regex
	if (/[\s\u0000-\u001f\u007f]/.test(s)) return DEFAULT_RETURN;
	let url;
	try {
		// A base on a fake origin: whatever resolves elsewhere is refused.
		url = new URL(s, 'https://webui.invalid');
	} catch {
		return DEFAULT_RETURN;
	}
	if (url.origin !== 'https://webui.invalid') return DEFAULT_RETURN;
	const path = url.pathname;
	if (path.startsWith(CALLBACK_PATH) || s.split(/[?#]/)[0].split('/').includes('..')) {
		return DEFAULT_RETURN;
	}
	if (!RETURN_PREFIXES.some((p) => path === p || path.startsWith(p + '/'))) return DEFAULT_RETURN;
	return s;
}

/**
 * Remember a consent this tab is about to start.
 * @param {Storage | null | undefined} store
 * @param {{ state: string, server: string, returnTo: string }} p
 * @param {number} [now]
 */
export function rememberPending(store, p, now = Date.now()) {
	if (!store || !p.state) return false;
	try {
		store.setItem(
			KEY + p.state,
			JSON.stringify({ server: p.server, returnTo: safeReturnPath(p.returnTo), at: now })
		);
		return true;
	} catch {
		return false;
	}
}

/**
 * The consent this tab started for `state`, CONSUMED (removed before use), or
 * null if this tab never started it or it is older than the gateway keeps it.
 * @param {Storage | null | undefined} store
 * @param {unknown} state
 * @param {number} [now]
 * @returns {{ server: string, returnTo: string } | null}
 */
export function takePending(store, state, now = Date.now()) {
	if (!store || typeof state !== 'string' || !state || state.length > 512) return null;
	let raw = null;
	try {
		raw = store.getItem(KEY + state);
		store.removeItem(KEY + state);
	} catch {
		return null;
	}
	if (!raw) return null;
	try {
		const v = JSON.parse(raw);
		if (!v || typeof v.server !== 'string' || !v.server) return null;
		if (typeof v.at !== 'number' || now - v.at > PENDING_TTL_MS || v.at > now + 60_000) return null;
		return { server: v.server, returnTo: safeReturnPath(v.returnTo) };
	} catch {
		return null;
	}
}
