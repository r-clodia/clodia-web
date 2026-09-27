/**
 * Quali box «ragionamento/attività» stanno a schermo in questo istante
 * (clodia-platform#417).
 *
 * Il difetto che questo modulo chiude: la visibilità del box era derivata dai
 * BYTE nei buffer —
 *
 *     liveEntries = Object.entries(liveAgents)
 *         .filter(([, l]) => l.think || l.reply || l.tools.length)
 *
 * — cioè da un effetto del turno, non dal turno. Ogni volta che i tre buffer di
 * un agente si trovano vuoti insieme il box viene SMONTATO, anche se l'agente
 * sta lavorando; ricompare al delta successivo. È il «a volte sparisce» della
 * segnalazione, e succede in due momenti che non sono di laboratorio:
 *
 * 1. **Fra due blocchi.** Con le bolle per blocco (#243) il backend persiste il
 *    blocco appena chiuso; `resetLiveReply` toglie dal buffer ciò che è
 *    diventato permanente (#250). Se in quel momento il blocco successivo non
 *    è ancora cominciato, `reply` resta `''` — e per un turno che non ha
 *    prodotto ragionamento né tool (un provider senza `reasoning`, o i primi
 *    secondi di qualunque turno) quei tre buffer sono vuoti tutti insieme.
 *    `consumePersisted` fa lo stesso quando il messaggio persistito non viene
 *    da questo stream (post via tool): svuota apposta, per non mostrare due
 *    volte lo stesso testo. Corretto per la BOLLA, fatale per il BOX.
 * 2. **Al rientro nella stanza a metà turno.** Gli eventi SSE che riempiono i
 *    buffer sono già passati: i buffer sono vuoti e restano vuoti finché
 *    l'agente non produce un altro delta, che su una tool-call lunga può
 *    significare minuti di schermo muto. È esattamente il caso per cui
 *    `active_responders` è stato inventato — ma finora alimentava solo la riga
 *    «sta scrivendo…», non il box.
 *
 * Qui la visibilità torna a poggiare su ciò che DICHIARA il turno:
 * `active_responders`, la sola sorgente che legge il task vivo lato server.
 * Un box resta su finché quel turno è dichiarato attivo, vuoto o pieno che sia
 * — e a spegnerlo resta la cintura di `refreshInfo` (due assenze consecutive),
 * che è l'unica cosa che sappia davvero che il turno è finito.
 *
 * NON si usa `typing` come sorgente, benché sia più tempestiva: `channel_typing`
 * si spegne a ogni messaggio pubblicato (`setTyping(autore, false)` in
 * `refreshMessages`), cioè NEL MEZZO di un turno che pubblica più blocchi.
 * Farci dipendere il box rimetterebbe lo sfarfallio dalla porta di servizio.
 *
 * Modulo JS e non TS di proposito, come `liveReply.js`: così
 * `scripts/check-live-box-durante-il-turno.mjs` importa ed ESEGUE la funzione
 * vera invece di riscriverne una copia che può divergere.
 */

/** Stato di un box senza nulla dentro: il turno c'è, i delta non ancora.
 *  Costante condivisa e congelata perché la sua identità non cambi a ogni
 *  ricalcolo reattivo (il box si aggiorna, non si rimonta). */
const VUOTO = Object.freeze({
	think: '',
	reply: '',
	tools: /** @type {string[]} */ (/** @type {unknown} */ (Object.freeze([])))
});

/** @param {{think?: string, reply?: string, tools?: string[]}} l */
function haContenuto(l) {
	return !!(l && (l.think || l.reply || (l.tools && l.tools.length)));
}

/**
 * I box live da rendere, in ordine di comparsa.
 *
 * Un agente entra nella lista se **almeno una** delle due è vera:
 *   - ha del contenuto nei buffer (delta già arrivati);
 *   - il backend dichiara il suo turno ATTIVO (`active_responders`).
 *
 * La seconda condizione è la correzione: tiene il box su nei buchi fra i delta
 * e lo fa nascere anche quando i delta sono già passati. La prima resta perché
 * un buffer pieno va mostrato comunque — anche nel poll in cui il turno è
 * appena finito e il testo non è ancora stato riconciliato.
 *
 * Il confronto passa per il SEED, come la cintura (`idleLiveKeys`) e per la
 * stessa ragione: le chiavi live sono SPAWN (`avvocato-42`, da `spawn_label`),
 * `active_responders` è per contratto una lista di SEED (`avvocato`). A stringa
 * non combaciano mai.
 *
 * Un seed dichiarato attivo che non ha ancora nessuna chiave live ottiene un
 * box VUOTO, indicizzato per seed: mostra «al lavoro…» finché il primo delta
 * non arriva. Quando arriverà, porterà con sé la chiave di spawn e il box si
 * sposterà sotto il nome preciso — un rimontaggio, ma di un box che non aveva
 * ancora niente dentro, e l'alternativa è nessun box affatto.
 *
 * @param {Record<string, {think: string, reply: string, tools: string[]}>} live  mappa live, per SPAWN
 * @param {readonly string[]} attivi     `active_responders` del backend (SEED)
 * @param {(n: string) => string} seedOf riduzione nome → seed
 * @returns {Array<[string, {think: string, reply: string, tools: string[]}]>}
 */
export function liveBoxEntries(live, attivi, seedOf) {
	/** @type {string[]} */
	const seedAttivi = [];
	for (const a of attivi || []) {
		const s = seedOf(a);
		if (s && !seedAttivi.includes(s)) seedAttivi.push(s);
	}
	const voci = Object.entries(live || {}).filter(
		([chiave, l]) => haContenuto(l) || seedAttivi.includes(seedOf(chiave))
	);
	const coperti = new Set(voci.map(([chiave]) => seedOf(chiave)));
	for (const s of seedAttivi) {
		if (!coperti.has(s)) voci.push([s, VUOTO]);
	}
	return /** @type {Array<[string, {think: string, reply: string, tools: string[]}]>} */ (voci);
}
