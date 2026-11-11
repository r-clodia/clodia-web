/**
 * Helpers of the Databases pages (clodia-platform#672).
 *
 * Plain JS on purpose, like `$lib/viewPref.js`: `scripts/check-databases-page.mjs`
 * imports and runs them.
 */

/**
 * @typedef {{kind: string, name: string, pack?: string | null, tier?: string, purpose?: string,
 *   imported_by_scopes?: string[], size?: any}} Entry
 */

/** Formats an upload may have; the server checks the same list. */
export const UPLOAD_FORMATS = ['.pdf', '.docx', '.pptx', '.md', '.txt'];

export const TIERS = ['SEAL-0', 'SEAL-1', 'SEAL-2', 'SEAL-3', 'SEAL-4'];

/** A topic's own RAG index: it belongs to its room, never to the catalogue.
 * @param {Entry | null | undefined} entry */
export function isTopicIndex(entry) {
	return !!entry && entry.kind === 'rag' && String(entry.name || '').startsWith('topic-');
}

/** The catalogue as shown: topic indexes out even if a server sent them.
 * @template {Entry} T
 * @param {T[] | null | undefined} entries
 * @returns {T[]} */
export function visibleEntries(entries) {
	return (entries || []).filter((e) => !isTopicIndex(e));
}

/** Origin label: the pack, or "piattaforma" for resources created here.
 * @param {Entry} entry */
export function originLabel(entry) {
	return entry && entry.pack ? entry.pack : 'piattaforma';
}

/**
 * @template {Entry} T
 * @param {T[]} entries
 * @param {{kind?: string, pack?: string, tier?: string, q?: string}} f
 *   `pack`: '' = all, '@platform' = created on the platform, else a pack name.
 * @returns {T[]}
 */
export function filterEntries(entries, f = {}) {
	const q = String(f.q || '').trim().toLowerCase();
	return visibleEntries(entries).filter((e) => {
		if (f.kind && e.kind !== f.kind) return false;
		if (f.pack === '@platform' && e.pack) return false;
		if (f.pack && f.pack !== '@platform' && e.pack !== f.pack) return false;
		if (f.tier && e.tier !== f.tier) return false;
		if (q && !String(e.name).toLowerCase().includes(q) &&
			!String(e.purpose || '').toLowerCase().includes(q)) return false;
		return true;
	});
}

/** Distinct packs of the catalogue, sorted.
 * @param {Entry[]} entries
 * @returns {string[]} */
export function packsOf(entries) {
	/** @type {Set<string>} */
	const out = new Set();
	for (const e of visibleEntries(entries)) if (e.pack) out.add(e.pack);
	return [...out].sort();
}

/** @param {string} path @param {string | null | undefined} scope */
function withScope(path, scope) {
	return scope ? `${path}?scope=${encodeURIComponent(scope)}` : path;
}

/** `/databases/datastore/<pack>/<name>` for a key `pack/name`.
 * @param {string} key @param {string | null} [scope] */
export function datastoreHref(key, scope) {
	const i = String(key).indexOf('/');
	const pack = encodeURIComponent(String(key).slice(0, i));
	const name = encodeURIComponent(String(key).slice(i + 1));
	return withScope(`/databases/datastore/${pack}/${name}`, scope);
}

/** @param {string} name @param {string | null} [scope] */
export function collectionHref(name, scope) {
	return withScope(`/databases/collection/${encodeURIComponent(name)}`, scope);
}

/** The detail page of a catalogue entry; a non-admin carries their first scope.
 * @param {Entry} entry @param {boolean} isAdmin */
export function entryHref(entry, isAdmin) {
	const scope = isAdmin ? '' : (entry.imported_by_scopes || [])[0] || '';
	return entry.kind === 'rag' ? collectionHref(entry.name, scope) : datastoreHref(entry.name, scope);
}

/** `"SEAL-2/name"` → `/topics/SEAL-2/name`.
 * @param {string} s */
export function scopeHref(s) {
	const i = String(s).indexOf('/');
	return i < 0
		? `/topics/${encodeURIComponent(s)}`
		: `/topics/${encodeURIComponent(s.slice(0, i))}/${encodeURIComponent(s.slice(i + 1))}`;
}

/** @param {number | null | undefined} n */
export function bytesLabel(n) {
	if (n == null) return '—';
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** @param {Entry} entry */
export function sizeLabel(entry) {
	const s = entry && entry.size;
	if (!s) return '—';
	if (entry.kind === 'rag') return `${s.documents ?? 0} doc · ${s.chunks ?? 0} chunk`;
	return `${s.tables ?? 0} tabelle · ${s.rows ?? 0} righe · ${bytesLabel(s.bytes)}`;
}

/** @param {string | null | undefined} iso */
export function dateLabel(iso) {
	if (!iso) return '—';
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString('it-IT', {
		day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
	});
}

/** @param {string} s */
export function statusLabel(s) {
	/** @type {Record<string, string>} */
	const labels = { active: 'attivo', missing: 'mancante', unreadable: 'illeggibile', unknown: 'sconosciuto' };
	return labels[s] || s;
}

/** Name accepted for a new datastore or collection (same rule as the server).
 * @param {string} name */
export function validName(name) {
	return /^[a-z0-9][a-z0-9_-]{0,62}$/.test(String(name || ''));
}

/** May this file be uploaded? '' when yes, else the reason.
 * @param {{name: string, size: number} | null | undefined} file
 * @param {number} [maxBytes] */
export function uploadProblem(file, maxBytes) {
	if (!file) return 'nessun file';
	const low = String(file.name || '').toLowerCase();
	if (!UPLOAD_FORMATS.some((ext) => low.endsWith(ext))) {
		return `formato non ammesso (${UPLOAD_FORMATS.join(', ')})`;
	}
	if (maxBytes && file.size > maxBytes) return `file troppo grande (max ${bytesLabel(maxBytes)})`;
	if (!file.size) return 'file vuoto';
	return '';
}
