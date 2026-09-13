#!/usr/bin/env node
/**
 * Sulla bolla non c'è più il feedback 👍/👎.
 *
 * Richiesta dell'owner (clodia-platform#416): il pollice su/giù è inefficace
 * nella pratica, e l'evidenza non è un'impressione — sull'istanza non esisteva
 * un solo `feedback-lessons.json`, per nessun agente, in tutta la vita
 * dell'endpoint. Il backend ha rimosso le tre rotte; qui si toglie il gesto.
 *
 * Perché serve un controllo e non basta il diff: questa rimozione **rovescia**
 * la metà «deve restare» di `check-no-lessons-panel.mjs` (clodia-platform#238,
 * che tolse l'archivio e tenne l'atto). Chi legge quel guard oggi trova scritto
 * «il feedback 👍/👎 sulla bolla RESTA», e in buona fede potrebbe rimettere i
 * due bottoni credendo di riparare una regressione. Da qui in avanti la regola
 * è una sola e sta scritta in un posto solo: non tornano.
 *
 * Rimetterli costa poco — un `<div class="message-feedback">` e una chiamata a
 * `sendMessageFeedback`, che il client API **non esporta più**: il codice non
 * compilerebbe, ma la traccia CSS o lo stato possono rientrare da soli in un
 * merge e restare lì a non far niente.
 *
 * LIMITE DICHIARATO: è un controllo sul TESTO di due file, non sul DOM reso.
 * Vede le tracce elencate qui sotto, non un pulsante equivalente scritto con
 * altre parole o spostato in un componente nuovo. Sopra questo soffitto serve
 * un test di render, che in questo repo oggi non ha un runner.
 */
import { leggiSorgente } from './lib/sorgente.mjs';

const PAGINA = 'src/routes/topics/[tier]/[name]/+page.svelte';
const CLIENT = 'src/lib/api/client.ts';

/** Tracce del gesto rimosso, nella pagina del topic. */
const VIETATI_PAGINA = [
	['message-feedback', 'il contenitore (o lo stile) dei due bottoni'],
	['feedbackByMessage', "lo stato 👍/👎 per messaggio"],
	['feedbackBusy', 'lo stato «salvataggio…» del voto in corso'],
	['rateMessage', "l'handler che inviava la valutazione"],
	['sendMessageFeedback', "la chiamata all'endpoint rimosso"]
];

/** Tracce nel client API: l'endpoint non esiste più lato server. */
const VIETATI_CLIENT = [
	['sendMessageFeedback', "l'invio del feedback su un messaggio"],
	['getFeedbackLessons', 'la lettura delle lesson'],
	['deleteFeedbackLesson', 'la cancellazione di una lesson'],
	['FeedbackLesson', 'il tipo della lesson'],
	['feedback-lessons', "il path delle rotte rimosse"]
];

/** Ciò che NON va rimosso per errore: è un altro meccanismo, stesso nome. */
const RICHIESTI_CLIENT = [
	[
		'recordRoutingFeedback',
		'il feedback sulla scelta del ROUTER, fuori dall’ambito di #416'
	]
];

const guasti = [];
const pagina = leggiSorgente(PAGINA, guasti, 'la pagina del topic');
const client = leggiSorgente(CLIENT, guasti, 'il client API');

if (pagina !== null) {
	for (const [ago, cosa] of VIETATI_PAGINA) {
		if (pagina.includes(ago)) guasti.push(`${PAGINA}: ricompare «${ago}» — ${cosa}`);
	}
}
if (client !== null) {
	for (const [ago, cosa] of VIETATI_CLIENT) {
		if (client.includes(ago)) guasti.push(`${CLIENT}: ricompare «${ago}» — ${cosa}`);
	}
	for (const [ago, cosa] of RICHIESTI_CLIENT) {
		if (!client.includes(ago)) guasti.push(`${CLIENT}: manca «${ago}» — ${cosa}`);
	}
}

if (guasti.length) {
	console.error('feedback 👍/👎 sui messaggi:');
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log('bolla: nessun feedback 👍/👎, feedback di routing intatto ✓');
