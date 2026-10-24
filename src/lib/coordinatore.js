/**
 * «Questa stanza non ha un coordinatore» (clodia-platform#607, coda webui).
 *
 * La clearance effettiva di un agente è quella del suo PROVIDER, e i provider
 * che arrivano a SEAL-3 sono pochi: basta metterne uno in pausa perché una
 * stanza confidenziale resti senza nessuno che possa prenderne i turni. Fino a
 * ieri l'unico modo di accorgersene era scrivere un messaggio e non vedere
 * arrivare niente. L'agent-server ora lo dice PRIMA, nel payload del canale
 * (`coordinator: {name, available, reason}`), e qui si decide se mostrarlo.
 *
 * Due regole, e sono quelle che un `{#if}` scritto a mano sbaglia:
 *
 * 1. **L'assenza del campo non è un allarme.** Un agent-server che non lo manda
 *    ancora (deploy in corso, versione precedente) non ha detto «non c'è
 *    coordinatore»: non ha detto niente. Un banner rosso su ogni stanza al
 *    primo deploy disallineato è peggio del difetto che segnala — e lo stesso
 *    vale per un payload malformato.
 * 2. **`available: false` si mostra anche senza `reason`.** Il motivo è un
 *    testo di cortesia; la segnalazione è il bit. Legarla alla presenza della
 *    frase farebbe sparire l'avviso proprio nel caso in cui il backend non sa
 *    spiegarsi.
 *
 * Modulo JS e non TS di proposito, come `liveBox.js`: così
 * `scripts/check-coordinator-banner.mjs` importa ed ESEGUE questa funzione
 * invece di riscriverne una copia che può divergere.
 */

/**
 * Il banner da mostrare, o `null` se non c'è niente da dire.
 *
 * @param {unknown} coordinator  il campo `coordinator` del payload del canale
 * @returns {{titolo: string, segmenti: {testo: string, forte: boolean}[]}|null}
 */
export function bannerCoordinatore(coordinator) {
	if (!coordinator || typeof coordinator !== 'object') return null;
	const c = /** @type {{available?: unknown, reason?: unknown}} */ (coordinator);
	// `available` deve essere esattamente `false`: `undefined` è «non so», e
	// non si allarma la stanza per un campo che nessuno ha scritto.
	if (c.available !== false) return null;
	const reason = typeof c.reason === 'string' ? c.reason.trim() : '';
	return {
		titolo: 'Questa stanza non ha un coordinatore',
		segmenti: reason
			? segmenti(reason)
			: [{ testo: 'Nessun agente idoneo può prendere i turni di questa stanza.', forte: false }]
	};
}

/**
 * Il motivo arriva con il grassetto Markdown attorno al nome dell'agente
 * (`**segretario**`). Qui diventa una lista di pezzi, che il componente rende
 * con `<strong>` e nient'altro: è testo che nasce sul server, e passarlo a un
 * renderer HTML per due asterischi aprirebbe una superficie che non serve.
 *
 * @param {string} testo
 * @returns {{testo: string, forte: boolean}[]}
 */
export function segmenti(testo) {
	const out = [];
	for (const pezzo of String(testo ?? '').split(/(\*\*[^*]+\*\*)/g)) {
		if (!pezzo) continue;
		const forte = pezzo.length > 4 && pezzo.startsWith('**') && pezzo.endsWith('**');
		out.push({ testo: forte ? pezzo.slice(2, -2) : pezzo, forte });
	}
	return out;
}
