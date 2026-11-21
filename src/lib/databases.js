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
export const UPLOAD_FORMATS = ['.pdf', '.docx', '.pptx', '.md', '.txt', '.zip'];

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
/**
 * One line for the result of an upload (#698): a `.zip` reports how many of
 * its files were indexed, skipped or failed; a single file its chunks.
 * @param {any} r
 */
export function uploadNote(r) {
	if (!r) return '';
	if (r.archive) {
		const parts = [`${r.indexed ?? 0} indicizzati`];
		if (r.skipped) parts.push(`${r.skipped} saltati`);
		if (r.errors) parts.push(`${r.errors} con errore`);
		return `archivio: ${parts.join(', ')}`;
	}
	return `${r.chunks ?? '?'} chunk`;
}

/**
 * Tooltip with the per-file detail of a `.zip` upload.
 * @param {any} r
 */
export function uploadDetail(r) {
	if (!r || !r.archive || !Array.isArray(r.members)) return '';
	return r.members
		.map((/** @type {any} */ m) => `${m.status === 'indexed' ? '✓' : m.status === 'skipped' ? '–' : '✗'} ${m.path}${m.reason ? ` (${m.reason})` : ''}`)
		.join('\n');
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
 *
 * The gateway names a structure after the folder of the PLUGIN that declares
 * it (`assetti-contabili/contabilita`), which is the pack's own name only when
 * pack and plugin share it (base-pack, tomato). So a pack owns the structures
 * whose `pack` is its name or the name of one of its plugins
 * (clodia-platform#716: studio-commercialista showed no «Crea db»).
 * @template {{pack: string}} S
 * @param {S[] | null | undefined} structures @param {string} pack
 * @param {string[]} [plugins] names of the pack's plugins
 * @returns {S[]} */
export function structuresOfPack(structures, pack, plugins = []) {
	const owners = new Set([pack, ...plugins]);
	return (structures || []).filter((s) => owners.has(s.pack));
}

/**
 * Who imports an instance, from whatever the backend sends: a list of scope
 * ids (`imported_by_scopes: [...]`), a bare count (`imported_by_scopes: N`, or
 * `imported_count`), or nothing. "Nobody" is said only when it is KNOWN —
 * an empty list or 0 — never because a count was mistaken for a list: before
 * a delete that would be a dangerous lie.
 * @param {{imported_by_scopes?: unknown, imported_count?: unknown} | null | undefined} inst
 * @returns {{scopes: string[] | null, count: number | null, label: string}}
 *   `scopes` when the list is known; `label` is the text to show when it is not
 *   (or when it is empty).
 */
export function importsOf(inst) {
	const raw = inst ? inst.imported_by_scopes : undefined;
	const n = inst && typeof inst.imported_count === 'number' ? inst.imported_count : null;
	if (Array.isArray(raw)) {
		const scopes = raw.filter((s) => typeof s === 'string' && s);
		if (scopes.length) return { scopes, count: scopes.length, label: '' };
		// An empty list with a positive count = the scopes are not visible to this
		// person, but they exist.
		if (n && n > 0) return { scopes: null, count: n, label: importedByLabel(n) };
		return { scopes, count: 0, label: 'nessuno spazio lo importa' };
	}
	const count = typeof raw === 'number' && Number.isFinite(raw) ? raw : n;
	if (count === null) return { scopes: null, count: null, label: 'spazi che la importano: non noti' };
	return { scopes: null, count, label: count > 0 ? importedByLabel(count) : 'nessuno spazio lo importa' };
}

/** @param {number} n */
function importedByLabel(n) {
	return `importata da ${n} ${n === 1 ? 'spazio' : 'spazi'}`;
}

/**
 * Does an instance need its schema migration retried? (#687, #688)
 * True when its status says a migration failed / is pending, when the backend
 * flags it (`migration_failed`, `migration_error`, `needs_migration`), or when
 * its `schema_version` is behind the structure's latest.
 * @param {{status?: unknown, schema_version?: unknown, migration_failed?: unknown,
 *   migration_error?: unknown, needs_migration?: unknown} | null | undefined} inst
 * @param {{latest_version?: unknown, schema_version?: unknown} | null | undefined} [structure]
 */
export function needsMigration(inst, structure) {
	if (!inst) return false;
	if (inst.migration_failed || inst.migration_error || inst.needs_migration) return true;
	if (/migra|schema[_-]?behind/i.test(String(inst.status || ''))) return true;
	const have = Number(inst.schema_version);
	const want = Number(structure ? (structure.latest_version ?? structure.schema_version) : NaN);
	return Number.isFinite(have) && Number.isFinite(want) && inst.schema_version !== null &&
		inst.schema_version !== undefined && inst.schema_version !== '' && have < want;
}
