#!/usr/bin/env node
/**
 * La bolla live non deve passare per lo stato vuoto fra due blocchi
 * (clodia-platform#250).
 *
 * Questo NON è un test del browser: è un test della sottrazione, che è la parte
 * che si può sbagliare ragionando. Il caso che conta è il terzo qui sotto — il
 * messaggio persistito porta il blocco N mentre il buffer live contiene già
 * l'inizio di N+1. Con l'azzeramento totale di prima quella coda spariva, la
 * bolla si smontava e rinasceva: il lampeggio. Con il consumo del prefisso la
 * coda resta e la bolla non si smonta.
 *
 * Importa il modulo VERO (`src/lib/liveReply.js`), non una sua copia: una copia
 * qui potrebbe restare verde mentre ciò che gira in chat è già rotto.
 *
 *     node scripts/check-live-bubble-continuity.mjs
 */
import { consumePersisted, consumePersistedAll } from '../src/lib/liveReply.js';

/** @type {Array<[string, string, string|string[], string]>} */
const casi = [
	// nome, buffer live, testo(i) persistito(i), resto atteso
	['blocco unico, appena persistito → niente di nuovo da mostrare',
		'Ecco il piano.', 'Ecco il piano.', ''],
	['il backend strippa, il buffer no → si consuma comunque',
		'Ecco il piano.\n', 'Ecco il piano.', ''],
	['blocco N persistito mentre N+1 è già in streaming → la coda RESTA',
		'Ecco il piano.\n\nOra guardo il', 'Ecco il piano.', 'Ora guardo il'],
	['due blocchi chiusi fra due poll → consumati in ordine, coda salva',
		'Primo.\n\nSecondo.\n\nTer', ['Primo.', 'Secondo.'], 'Ter'],
	['messaggio estraneo allo stream (post via tool) → svuota, mai testo doppio',
		'Ecco il piano.', 'File scritto: local/nota.md', ''],
	['buffer più corto del persistito (delta persi, o pagina aperta a metà) → svuota',
		'Ecco il pi', 'Ecco il piano completo.', ''],
	['persistito vuoto → buffer intatto',
		'Sto scrivendo', '', 'Sto scrivendo'],
	['buffer vuoto → resta vuoto',
		'', 'Qualcosa', '']
];

let ko = 0;
for (const [nome, reply, persisted, atteso] of casi) {
	const resto = Array.isArray(persisted)
		? consumePersistedAll(reply, persisted)
		: consumePersisted(reply, persisted);
	const ok = resto === atteso;
	if (!ok) ko++;
	console.log(`${ok ? 'ok  ' : 'KO  '} ${nome}: resto ${JSON.stringify(resto)} (atteso ${JSON.stringify(atteso)})`);
}

// L'invariante che il caso 3 protegge, detta a voce alta: finché il turno
// continua a streammare, il buffer non deve mai diventare vuoto — è lo stato
// vuoto che smonta la bolla, ed è l'unmount che si vede come lampeggio.
const continua = consumePersistedAll('Blocco uno.\n\nsto già scrivendo il due', ['Blocco uno.']);
if (!continua) {
	ko++;
	console.log('KO   la bolla si svuota mentre lo stream continua → unmount/remount visibile');
}

console.log(ko ? `FALLITI: ${ko}` : 'continuità della bolla live: nessun passaggio per il vuoto ✓');
if (ko) process.exit(1);
