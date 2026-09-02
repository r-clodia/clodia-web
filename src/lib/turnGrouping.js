/**
 * Un turno, una bolla — anche quando il backend lo pubblica a blocchi.
 *
 * Da `CLODIA_BUBBLE_PER_BLOCK` (clodia-platform#243) ogni blocco di testo che
 * un agente chiude diventa un messaggio VERO nell'istante in cui compare,
 * invece di uno solo a fine turno. È la scelta giusta lato dato — prima il
 * testo già letto veniva buttato se nel frattempo l'agente postava via tool —
 * ma a schermo produceva la cosa che Davide ha segnalato il 2 set 2026: la
 * bolla cresce, «collassa», e riparte col blocco successivo. Tante volte quante
 * sono i blocchi.
 *
 * La risposta NON è tornare a una bolla per turno (si riaprirebbe #243): è
 * SALDARE i blocchi consecutivi dello stesso turno in un'unica bolla continua,
 * lasciando a ciascuno le proprie affordance (copia, feedback, allegati, pill).
 * Qui si calcola solo DOVE cade una saldatura; il resto è CSS.
 *
 * Modulo JS e non TS di proposito, come `$lib/liveReply`:
 * `scripts/check-turn-grouping.mjs` lo importa ed esegue la funzione vera,
 * invece di riscriverne una copia che può divergere.
 */

/**
 * Quanto silenzio separa due turni distinti dello stesso agente.
 *
 * Serve perché i messaggi NON portano un `turn_id`: la consecutività non basta
 * a distinguere «due blocchi dello stesso turno» da «due turni di fila», caso
 * che capita quando nessun altro parla in mezzo — un job schedulato, o una
 * catena che rientra sullo stesso agente. Dentro un turno il salto fra blocchi
 * è quello di una tool-call (secondi, al massimo qualche minuto); fra due turni
 * autonomi è l'intervallo di uno scheduler. Dieci minuti stanno comodamente in
 * mezzo, e sbagliare qui costa una saldatura di troppo o di meno, non del testo
 * perso.
 *
 * Se un giorno i messaggi porteranno il turno, questa soglia va via e il
 * confronto diventa esatto.
 */
export const TURN_GAP_MS = 10 * 60 * 1000;

/**
 * @param {string|null|undefined} ts
 * @returns {number|null}
 */
function istante(ts) {
	const t = Date.parse(ts || '');
	return Number.isNaN(t) ? null : t;
}

/**
 * Due messaggi consecutivi appartengono allo stesso turno?
 *
 * @param {{author?: string, kind?: string, ts?: string}|null|undefined} prima
 * @param {{author?: string, kind?: string, ts?: string}|null|undefined} dopo
 * @param {(n: string) => string} seedOf   riduzione nome → seed
 * @param {number} [gapMs]
 * @returns {boolean}
 */
export function sameTurn(prima, dopo, seedOf, gapMs = TURN_GAP_MS) {
	if (!prima || !dopo) return false;
	// Solo fra messaggi di agenti: un `human` o un `system` in mezzo è per
	// definizione un confine — e i `system` (reset del contesto, note del
	// router) devono restare bolle a sé, o si saldano dentro una risposta.
	if (prima.kind !== 'ai' || dopo.kind !== 'ai') return false;
	// SEED e non autore grezzo: fra due blocchi dello stesso turno la label può
	// cambiare vocabolario (spawn per la risposta finale, seed per ciò che passa
	// dal tool gateway) — vedi `reference` in $lib/liveReply e clodia-platform#294.
	if (seedOf(prima.author || '') !== seedOf(dopo.author || '')) return false;
	const a = istante(prima.ts);
	const b = istante(dopo.ts);
	if (a === null || b === null) return true; // senza tempi, decide la consecutività
	return b - a <= gapMs && b >= a;
}

/**
 * Dove saldare, per ogni messaggio della lista.
 *
 * `prev` = questa bolla continua quella sopra (niente intestazione, bordo
 * superiore fuso). `next` = continua in quella sotto (bordo inferiore fuso).
 * Le due insieme fanno una bolla sola che cresce, invece di N bolle che
 * sembrano N risposte.
 *
 * @param {ReadonlyArray<{author?: string, kind?: string, ts?: string}>} messaggi
 * @param {(n: string) => string} seedOf
 * @param {number} [gapMs]
 * @returns {Array<{prev: boolean, next: boolean}>}
 */
export function turnContinuity(messaggi, seedOf, gapMs = TURN_GAP_MS) {
	const lista = messaggi || [];
	return lista.map((m, i) => ({
		prev: sameTurn(lista[i - 1], m, seedOf, gapMs),
		next: sameTurn(m, lista[i + 1], seedOf, gapMs)
	}));
}

/**
 * La bolla live va saldata all'ultimo messaggio della lista?
 *
 * È il caso NORMALE mentre si guarda un turno: il blocco appena chiuso è già
 * un messaggio, e il testo che sta arrivando è la coda dello stesso discorso.
 * Senza questa saldatura resterebbe il salto visivo anche a saldature interne
 * corrette — cioè il difetto, spostato di un blocco.
 *
 * @param {ReadonlyArray<{author?: string, kind?: string, ts?: string}>} messaggi
 * @param {string} chiaveLive   chiave della mappa live (SPAWN)
 * @param {(n: string) => string} seedOf
 * @param {number} [gapMs]
 * @returns {boolean}
 */
export function liveContinuesLast(messaggi, chiaveLive, seedOf, gapMs = TURN_GAP_MS) {
	const lista = messaggi || [];
	const ultimo = lista[lista.length - 1];
	if (!ultimo || !chiaveLive) return false;
	// Il messaggio persistito porta un `ts`, la bolla live no: il tempo di
	// riferimento è ADESSO, perché è ora che quel testo sta arrivando.
	return sameTurn(ultimo, { author: chiaveLive, kind: 'ai', ts: new Date().toISOString() },
		seedOf, gapMs);
}
