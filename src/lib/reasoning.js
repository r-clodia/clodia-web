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
