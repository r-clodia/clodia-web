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
	return packOf(entry) || 'piattaforma';
}

/** The pack an entry comes from: its `pack`, else (an instance listed by a
 * backend that does not fill `pack`) the pack of its id; '' = the platform.
 * @param {Entry | null | undefined} entry */
export function packOf(entry) {
	if (!entry) return '';
	if (entry.pack) return entry.pack;
	const p = entry.kind !== 'rag' ? parseInstanceId(entry.name) : null;
	return p ? p.pack : '';
}

/**
 * @template {Entry} T
 * @param {T[]} entries
 * @param {{kind?: string, pack?: string, tier?: string, structure?: string, q?: string}} f
 *   `pack`: '' = all, '@platform' = created on the platform, else a pack name.
 *   `structure`: '' = all, else a structure id `<pack>/<structure>` (#688).
 * @returns {T[]}
 */
export function filterEntries(entries, f = {}) {
	const q = String(f.q || '').trim().toLowerCase();
	return visibleEntries(entries).filter((e) => {
		if (f.kind && e.kind !== f.kind) return false;
		if (f.structure && structureOf(e) !== f.structure) return false;
		if (f.pack === '@platform' && packOf(e)) return false;
		if (f.pack && f.pack !== '@platform' && packOf(e) !== f.pack) return false;
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
	for (const e of visibleEntries(entries)) {
		const p = packOf(e);
		if (p) out.add(p);
	}
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

/** `"SEAL-2/name"` → `/topics/SEAL-2/name`; `"job:7"` → `/jobs/7` (#670).
 * @param {string} s */
export function scopeHref(s) {
	const job = /^job:(\d+)$/.exec(String(s));
	if (job) return `/jobs/${job[1]}`;
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

// ─────────────────────────────────────────────────────────────────────────
// Datastore STRUCTURES and INSTANCES (clodia-platform#684, #688). A pack
// declares structures (`<pack>/<structure>`: schema + migrations), never
// databases; each structure has any number of instances
// (`<pack>/<structure>:<name>`), created explicitly with "Crea db".
// ─────────────────────────────────────────────────────────────────────────

/** Instance name rule (same as the server, #685). */
export const INSTANCE_NAME_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;

/** @param {string} name */
export function validInstanceName(name) {
	return INSTANCE_NAME_RE.test(String(name || ''));
}

/** Why an instance name is refused ('' when it is fine). Live feedback for the dialog.
 * @param {string} name @param {string[]} [taken] names already used in the structure */
export function instanceNameProblem(name, taken = []) {
	const n = String(name || '');
	if (!n) return 'nome obbligatorio';
	if (n.length > 41) return 'massimo 41 caratteri';
	if (!/^[a-z0-9]/.test(n)) return 'deve iniziare con una minuscola o una cifra';
	if (!INSTANCE_NAME_RE.test(n)) return 'solo minuscole, cifre e «-»';
	if (taken.includes(n)) return 'esiste già un db con questo nome per questa struttura';
	return '';
}

/** Legacy P0–P3 are SEAL-0…SEAL-3 (retro-compatibility of the tier scale). */
/** @param {string | null | undefined} t */
export function normalizeTier(t) {
	const s = String(t || '').trim().toUpperCase();
	const p = /^P([0-4])$/.exec(s);
	if (p) return `SEAL-${p[1]}`;
	return TIERS.includes(s) ? s : '';
}

/** Tiers the person may give a new instance: ≤ their clearance. Unknown
 * clearance → [] (the caller says why; the server decides anyway).
 * @param {string | null | undefined} clearance */
export function tiersUpTo(clearance) {
	const c = normalizeTier(clearance);
	if (!c) return [];
	return TIERS.slice(0, TIERS.indexOf(c) + 1);
}

/** `"<pack>/<structure>:<name>"` → its parts; null for anything else
 * (a platform datastore, a legacy `<pack>/<name>`, a collection).
 * @param {string | null | undefined} id */
export function parseInstanceId(id) {
	const m = /^([^/:]+)\/([^/:]+):([^/:]+)$/.exec(String(id || ''));
	return m ? { pack: m[1], structure: m[2], name: m[3], structureId: `${m[1]}/${m[2]}` } : null;
}

/** Catalogue label: `<structure> · <name>` for an instance, else the name.
 * @param {{kind?: string, name: string}} entry */
export function instanceLabel(entry) {
	const p = entry && entry.kind !== 'rag' ? parseInstanceId(entry.name) : null;
	return p ? `${p.structure} · ${p.name}` : entry ? entry.name : '';
}

/** Structure id (`<pack>/<structure>`) of a catalogue entry, '' if not an instance.
 * @param {{kind?: string, name: string}} entry */
export function structureOf(entry) {
	const p = entry && entry.kind !== 'rag' ? parseInstanceId(entry.name) : null;
	return p ? p.structureId : '';
}

/** Distinct structures of the catalogue, sorted.
 * @param {Entry[]} entries
 * @returns {string[]} */
export function structuresOf(entries) {
	/** @type {Set<string>} */
	const out = new Set();
	for (const e of visibleEntries(entries)) {
		const s = structureOf(e);
		if (s) out.add(s);
	}
	return [...out].sort();
}

/** Structures declared by one pack (from `GET /clodia/databases/structures`).
 * @template {{pack: string}} S
 * @param {S[] | null | undefined} structures @param {string} pack
 * @returns {S[]} */
export function structuresOfPack(structures, pack) {
	return (structures || []).filter((s) => s.pack === pack);
}
