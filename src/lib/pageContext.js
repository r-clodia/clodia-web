/**
 * Page reference for the helpdesk widget (clodia-platform#702).
 *
 * Every message the side widget sends to sysadmin carries a hidden block that
 * says WHERE the person is writing from: the kind of page and the identifiers
 * in its route. Nothing else. The block is built from the URL path (plus, for
 * a room, whether it is a DM — metadata the topic page already holds), never
 * from what the page shows: no message text, no file names, no rows, no
 * document contents. sysadmin's charter is that it never reads scope contents
 * (#701/#704); the reference is a name it can act on through governance verbs,
 * not a window into the page.
 *
 * The block is an HTML comment at the top of the message. `renderMarkdown`
 * escapes HTML, so whoever renders a message that may carry it must strip it
 * with `PAGE_CONTEXT_RE` — otherwise it is printed verbatim in the DM.
 *
 * Plain JS with JSDoc so the guard (scripts/check-helpdesk-widget.mjs) can
 * import and exercise it without a build.
 */

/** The kinds of page a reference can name. Anything else is `other`. */
export const PAGE_KINDS = /** @type {const} */ ([
	'topic', 'dm', 'pack', 'datastore', 'collection', 'job', 'agent', 'settings', 'other'
]);

/** The only keys a reference may carry, in the order they are written. */
export const PAGE_REF_KEYS = /** @type {const} */ ([
	'kind', 'tier', 'name', 'pack', 'datastore', 'collection', 'job', 'agent', 'section'
]);

/** Matches the block, with the newline that follows it. Global: use with
 *  `.replace`, never with `.test` (a global regex keeps `lastIndex`). */
export const PAGE_CONTEXT_RE = /<!--\s*page-context:[\s\S]*?-->\n?/gi;

/** Admin/configuration sections: the reference names the section, nothing more. */
const SETTINGS_SECTIONS = new Set(['settings', 'tools', 'providers', 'rules', 'skills', 'colony']);

const MAX_ID = 96;

/**
 * An identifier as it may appear in the block: route-safe characters only,
 * bounded. This is what keeps a crafted name from closing the comment early
 * (`-->`) or smuggling free text into the block.
 *
 * @param {unknown} v
 * @returns {string}
 */
export function safeId(v) {
	let s = '';
	try {
		s = decodeURIComponent(String(v ?? ''));
	} catch {
		s = String(v ?? '');
	}
	return s.replace(/[^A-Za-z0-9._:@+-]/g, '').replace(/-{2,}/g, '-').slice(0, MAX_ID);
}

/**
 * The reference of the page at `pathname`.
 *
 * @param {string} pathname   `$page.url.pathname` — the path only, never the query
 * @param {{ tier: string, name: string, kind?: string } | null} [room]
 *        what the topic page knows about the room on screen (its `meta.kind`)
 * @returns {Record<string, string>}
 */
export function pageRef(pathname, room = null) {
	// The path only: a query string or a hash (search terms, a row anchor) is
	// page state, not a reference, even if a caller passes a full URL.
	const seg = String(pathname || '/').split(/[?#]/)[0].split('/').filter(Boolean);
	const [a, b, c, d] = seg;
	if (a === 'topics' && b && c) {
		const tier = safeId(b);
		const name = safeId(c);
		const isDm = !!room && safeId(room.tier) === tier && safeId(room.name) === name && room.kind === 'dm';
		return { kind: isDm ? 'dm' : 'topic', tier, name };
	}
	if (a === 'packs') return { kind: 'pack' };
	if (a === 'databases' && b === 'datastore' && c && d) return { kind: 'datastore', pack: safeId(c), datastore: safeId(d) };
	if (a === 'databases' && b === 'collection' && c) return { kind: 'collection', collection: safeId(c) };
	if (a === 'jobs' && b) return { kind: 'job', job: safeId(b) };
	if (a === 'agents' && b) return { kind: 'agent', agent: safeId(b) };
	if (a && SETTINGS_SECTIONS.has(a)) return b ? { kind: 'settings', section: `${a}/${safeId(b)}` } : { kind: 'settings', section: a };
	return a ? { kind: 'other', section: safeId(a) } : { kind: 'other' };
}

/**
 * Merges an explicit reference (e.g. the pack whose «Finish setup» was
 * pressed) over the page one, through the same whitelist.
 *
 * @param {Record<string, string>} base
 * @param {Record<string, unknown> | null | undefined} extra
 * @returns {Record<string, string>}
 */
export function mergeRef(base, extra) {
	if (!extra) return base;
	/** @type {Record<string, string>} */
	const out = { ...base };
	for (const k of PAGE_REF_KEYS) {
		if (extra[k] != null && extra[k] !== '') out[k] = safeId(extra[k]);
	}
	return out;
}

/**
 * The hidden block for `ref`. Whitelisted keys, sanitised values, one line.
 *
 * @param {Record<string, unknown>} ref
 * @returns {string}
 */
export function contextBlock(ref) {
	const kind = PAGE_KINDS.includes(/** @type {any} */ (ref?.kind)) ? String(ref.kind) : 'other';
	const parts = [`kind=${kind}`];
	for (const k of PAGE_REF_KEYS) {
		if (k === 'kind') continue;
		const v = safeId(ref?.[k]);
		if (v) parts.push(`${k}=${v}`);
	}
	return `<!-- page-context: ${parts.join(' ')} -->\n`;
}

/**
 * The message as sent: the block on top, then what the person typed.
 *
 * @param {Record<string, unknown>} ref
 * @param {string} text
 * @returns {string}
 */
export function withPageContext(ref, text) {
	return contextBlock(ref) + String(text ?? '').replace(PAGE_CONTEXT_RE, '');
}
