/**
 * Le pill di una risposta non scadono perché è arrivato un altro messaggio
 * (clodia-platform#407).
 *
 * La pagina mostrava le pill **solo sull'ultimo messaggio della timeline**
 * (`i === shownMessages.length - 1`). In una chat a un agente solo la cosa
 * passava inosservata: la domanda era quasi sempre l'ultima riga. In un canale
 * multi-agente no — basta che un altro agente pubblichi un resoconto, o che
 * arrivi una bolla di sistema, e la domanda ancora aperta perde i bottoni. Chi
 * guarda vede una domanda con delle scelte elencate nel testo e nessun modo di
 * sceglierle: il meccanismo delle pill smette di funzionare proprio quando la
 * conversazione è viva, cioè sempre.
 *
 * Il criterio giusto non è «è l'ultimo messaggio» ma **«la domanda è ancora
 * aperta»**. Qui una domanda si chiude in tre modi, e nessuno dei tre è
 * l'arrivo di un messaggio qualunque:
 *
 *  1. **click**: l'utente ha scelto da questa pagina (`risolte`);
 *  2. **risposta già data a voce**: un messaggio UMANO successivo dice
 *     esattamente una delle scelte — è ciò che il click stesso pubblica, ed è
 *     l'unico segnale che sopravvive a un ricarico della pagina, dove la
 *     memoria del punto 1 non c'è più;
 *  3. **soppiantata**: lo stesso autore ha posto una nuova domanda con pill.
 *     Un agente che richiede una scelta sta riformulando, non aprendo un
 *     secondo sondaggio parallelo; le pill vecchie diventerebbero una risposta
 *     a una domanda che non è più quella.
 *
 * Il punto 3 è per AUTORE e non globale di proposito: due agenti possono avere
 * due domande aperte insieme, e chiudere quella di uno perché ha parlato
 * l'altro è lo stesso difetto di prima, solo più raro.
 *
 * Soffitto dichiarato: una domanda a cui l'utente risponde a parole SUE (non
 * una delle voci) resta aperta, e le sue pill restano cliccabili più in su
 * nella conversazione. È il verso giusto in cui sbagliare — una pill di troppo
 * costa un click che nessuno fa, una pill in meno costa la risposta.
 */

/** Il marcatore, in un posto solo: la pagina lo RIMUOVE dal testo prima di
 *  renderlo e qui lo si LEGGE — due copie della stessa regex sono due modi di
 *  restare indietro l'una sull'altra, e il costo di sbagliarsi è un marcatore
 *  HTML stampato in chiaro nella conversazione. */
export const CHOICES_RE = /<!--\s*choices(-multi)?\s*=(.*?)-->/i;

/**
 * Il marcatore di scelta dentro il testo di un messaggio.
 *
 * @param {string} text
 * @returns {{ multi: boolean, items: string[] } | null}
 */
export function leggiChoices(text) {
	const m = (text || '').match(CHOICES_RE);
	if (!m) return null;
	const items = m[2]
		.split(/[,;|]/)
		.map((s) => s.trim())
		.filter(Boolean);
	return items.length ? { multi: !!m[1], items } : null;
}

/** Il corpo utile di un messaggio umano: senza citazioni e senza menzioni —
 *  cioè esattamente ciò che resta di `@agente Procedi` dopo aver tolto la
 *  forma con cui la pagina lo spedisce. */
/** @param {string} text */
function corpoUmano(text) {
	return (text || '')
		.split('\n')
		.filter((r) => !r.startsWith('> '))
		.join(' ')
		.replace(/@[A-Za-z0-9._-]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

/**
 * Quel messaggio umano È la risposta a queste pill?
 *
 * Vero solo se ogni voce pronunciata è una delle scelte offerte: copre sia la
 * scelta singola (`Procedi`) sia quella multipla, che il click pubblica come
 * elenco separato da virgole. Un messaggio che dice altro non chiude niente.
 *
 * @param {string} text
 * @param {{ items: string[] }} ch
 */
export function rispondeAllePill(text, ch) {
	const corpo = corpoUmano(text);
	if (!corpo) return false;
	const voci = ch.items.map((s) => s.trim().toLowerCase());
	const dette = corpo
		.split(/[,;|]/)
		.map((s) => s.trim())
		.filter(Boolean);
	return dette.length > 0 && dette.every((d) => voci.includes(d));
}

/**
 * Gli id dei messaggi le cui pill devono restare cliccabili.
 *
 * @param {Array<{ id: string, author: string, kind?: string, text: string }>} messaggi
 * @param {Set<string>} [risolte]  id già risolti col click, in questa pagina
 * @returns {Set<string>}
 */
export function pillsAttive(messaggi, risolte = new Set()) {
	const lista = messaggi || [];
	/** @type {Array<{ m: { id: string, author: string, text: string }, i: number, ch: { multi: boolean, items: string[] } }>} */
	const conPill = [];
	lista.forEach((m, i) => {
		const ch = leggiChoices(m && m.text);
		if (ch) conPill.push({ m, i, ch });
	});
	/** @type {Set<string>} */
	const attive = new Set();
	for (const { m, i, ch } of conPill) {
		if (risolte.has(m.id)) continue;
		if (conPill.some((x) => x.i > i && x.m.author === m.author)) continue;
		if (lista.slice(i + 1).some((x) => x && x.kind === 'human' && rispondeAllePill(x.text, ch))) continue;
		attive.add(m.id);
	}
	return attive;
}
