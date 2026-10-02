/**
 * Quali bolle mostrano il 💭 del ragionamento (clodia-platform#484).
 *
 * Il ragionamento di un turno adesso si conserva lato server e si riaggancia
 * alla bolla che quel turno ha prodotto. Qui sta l'unica domanda che il client
 * deve sapersi fare: su quali messaggi a schermo compare il bottone.
 *
 * La regola è una sola e va detta per intero, perché ognuno dei tre pezzi
 * corrisponde a un modo diverso di sbagliarla:
 *
 *   1. **lo decide lo store, non il client.** Un turno può non aver lasciato
 *      niente — è il limite dichiarato nell'issue — quindi «è un messaggio di
 *      un agente, quindi avrà pensato» produce bottoni che aprono il vuoto;
 *   2. **solo per bolle che esistono a schermo.** L'indice copre gli ultimi
 *      giorni del canale, la finestra dei messaggi no: un id senza bolla non
 *      ha dove mettere il bottone;
 *   3. **mai sulla bolla di una persona.** Un ragionamento appeso al messaggio
 *      di un umano si legge come se lo avesse pensato lui: è esattamente il
 *      genere di attribuzione che una interfaccia di agenti non può sbagliare.
 *      Le bolle `system` invece lo mostrano, ed è voluto: l'annuncio di un
 *      turno fallito è il caso in cui riaprire il ragionamento serve di più.
 */

/**
 * Normalizza la risposta dell'indice in una lista di id.
 * @param {unknown} payload il corpo di `GET …/reasoning`
 * @returns {string[]}
 */
export function indiceRagionamento(payload) {
	const righe = /** @type {any} */ (payload)?.messages;
	if (!Array.isArray(righe)) return [];
	return righe.filter((x) => typeof x === 'string' && x.length > 0);
}

/**
 * Gli id delle bolle a schermo che hanno un ragionamento da aprire.
 * @param {Array<{id?: unknown, kind?: unknown}>} messaggi i messaggi mostrati
 * @param {Iterable<string>} idsSalvati gli id che lo store dichiara di avere
 * @returns {Set<string>}
 */
export function bolleConRagionamento(messaggi, idsSalvati) {
	const salvati = idsSalvati instanceof Set ? idsSalvati : new Set(idsSalvati ?? []);
	/** @type {Set<string>} */
	const out = new Set();
	for (const m of messaggi ?? []) {
		const id = typeof m?.id === 'string' ? m.id : '';
		if (!id || m?.kind === 'human') continue;
		if (salvati.has(id)) out.add(id);
	}
	return out;
}

/**
 * State of the stored reasoning of one bubble, as kept by the page.
 *
 * `undefined` = never requested, `null` = request in flight,
 * `{ error }` = the request failed, `{ text, truncated }` = loaded.
 * A failed fetch must NOT look like a fetch in progress: otherwise the box
 * says "loading…" forever and nothing ever asks again.
 *
 * @param {unknown} entry
 * @returns {'idle' | 'loading' | 'error' | 'ready'}
 */
export function statoRagionamento(entry) {
	if (entry === undefined) return 'idle';
	if (entry === null) return 'loading';
	const e = /** @type {any} */ (entry);
	if (typeof e === 'object' && typeof e.error === 'string') return 'error';
	if (typeof e === 'object' && typeof e.text === 'string') return 'ready';
	return 'error';
}

/**
 * Whether opening (or retrying) this bubble must fetch the text: when it was
 * never requested or the last request failed. Never while a request is in
 * flight, never once loaded.
 * @param {unknown} entry
 * @returns {boolean}
 */
export function ragionamentoDaRichiedere(entry) {
	const s = statoRagionamento(entry);
	return s === 'idle' || s === 'error';
}

/**
 * The tool actions of a stored turn, as the live box showed them
 * (clodia-platform#484, reopened): the runtimes in use emit no thinking text,
 * so the live box is filled by tool actions — a stored box without them was
 * always empty. Defensive: anything malformed is dropped, never rendered.
 * @param {unknown} entry
 * @returns {Array<{ tool: string, input_summary: string }>}
 */
export function passiRagionamento(entry) {
	const e = /** @type {any} */ (entry);
	if (!e || typeof e !== 'object' || !Array.isArray(e.tools)) return [];
	return e.tools
		.filter((/** @type {any} */ t) => t && typeof t === 'object' && typeof t.tool === 'string' && t.tool)
		.map((/** @type {any} */ t) => ({
			tool: t.tool,
			input_summary: typeof t.input_summary === 'string' ? t.input_summary : ''
		}));
}
