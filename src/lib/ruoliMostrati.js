/**
 * Who is who in a room: owner, manager, staff, deputy (clodia-platform#497).
 *
 * The roles are DERIVED ON THE SERVER, in one place (clodia-logic
 * `agents/display_roles.py`, served as `display_roles` by
 * `GET /clodia/channels/{tier}/{name}`), so the webui, the PWA and the agents
 * agree. This module only turns those rows into badges: it never decides who
 * is staff or who leads the room. In particular there is NO list of staff
 * seeds here — a new staff seed is marked by its `staff: true` seed attribute
 * alone, with no UI change (acceptance of #497).
 *
 * Two rules on top of the server rows, both owner decisions:
 *  - `owner` is rendered by the page's existing owner label (`role-fixed`),
 *    so it is not repeated as a badge here;
 *  - `contributor` gets NO badge (owner, 12 Nov 2026: «eliminiamo il ruolo
 *    contributor … eliminiamo la label»): it is the default, and a word next
 *    to everyone distinguishes nobody.
 *
 * Display only: none of these badges grants or denies anything.
 */

/**
 * @typedef {object} DisplayRoleRow
 * @property {string} name
 * @property {'owner'|'manager'|'staff'|'contributor'|string} display_role
 * @property {string[]} [marks]   `staff` · `deputy` · `acting manager`
 * @property {string} [role]      the technical role, unchanged
 * @property {boolean} [readonly]
 * @property {number} [sort]      the order decided by the server
 */

/** @typedef {{ testo: string, titolo: string, tipo: string }} Badge */

/** Italian tooltips; the badge words are the issue's wording. */
const TITOLI = {
	manager: 'Conduce la stanza: è l’orchestratore, parla con te e assegna i compiti',
	staff: 'Ruolo di piattaforma, non di questo topic (dichiarato dal seed)',
	deputy: 'Vice del manager: conduce la stanza quando clodia non c’è',
	'acting manager': 'Conduce questa stanza in quanto vice: clodia non è presente',
	'sola lettura': 'Partecipa in sola lettura'
};

/** Weight of a name the server did not describe: a contributor, last. */
const PESO_IGNOTO = 3;

/**
 * Rows by participant name. Tolerates an older backend (field absent) and a
 * malformed payload: no rows means no badges, never a broken panel.
 * @param {unknown} rows
 * @returns {Map<string, DisplayRoleRow>}
 */
export function righePerNome(rows) {
	const m = new Map();
	if (!Array.isArray(rows)) return m;
	for (const r of rows) {
		if (r && typeof r === 'object' && typeof r.name === 'string' && r.name) m.set(r.name, r);
	}
	return m;
}

/**
 * The badges next to one participant, in reading order.
 *
 * `acting manager` already says «manager»: when it is there the plain
 * `manager` badge is not added, so a deputy leading the room reads
 * «staff · deputy · acting manager», as the issue asks.
 * @param {DisplayRoleRow | undefined | null} row
 * @returns {Badge[]}
 */
export function badgeDi(row) {
	if (!row) return [];
	const marks = Array.isArray(row.marks) ? row.marks.filter((x) => typeof x === 'string' && x) : [];
	/** @type {string[]} */
	const parole = [];
	if (row.display_role === 'manager' && !marks.includes('acting manager')) parole.push('manager');
	for (const m of marks) if (!parole.includes(m)) parole.push(m);
	if (row.readonly) parole.push('sola lettura');
	return parole.map((p) => ({
		testo: p,
		titolo: /** @type {Record<string, string>} */ (TITOLI)[p] ?? p,
		tipo: p.replace(/\s+/g, '-')
	}));
}

/**
 * The participants in the server's order (owner, manager, staff,
 * contributors). Keeps EVERY name — it sorts, it never filters
 * (clodia-platform#190) — and is stable: equal weights keep the declared
 * order, and names without a row go last.
 * @param {string[]} nomi
 * @param {Map<string, DisplayRoleRow>} righe
 * @returns {string[]}
 */
export function ordinaPerRuolo(nomi, righe) {
	const peso = (/** @type {string} */ n) => {
		const s = righe.get(n)?.sort;
		return typeof s === 'number' && Number.isFinite(s) ? s : PESO_IGNOTO;
	};
	return nomi
		.map((n, i) => ({ n, i, w: peso(n) }))
		.sort((a, b) => a.w - b.w || a.i - b.i)
		.map((x) => x.n);
}
