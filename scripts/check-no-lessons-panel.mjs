#!/usr/bin/env node
/**
 * La sidebar del topic non mostra più la sezione «Lessons».
 *
 * Richiesta diretta dell'owner (issue clodia-platform#238): il pannello che
 * elencava per messaggio la lezione ricavata dal feedback — con il testo grezzo
 * del commento e il bottone che la cancellava — non sta più nella colonna
 * destra. Il feedback 👍/👎 sulla bolla RESTA: è l'atto, non il suo archivio.
 *
 * Perché un controllo e non solo il diff: la metà rimossa e la metà rimasta
 * vivono nello stesso modulo e nascono dallo stesso gesto. Rimettere il pannello
 * costa una `<details>` e una chiamata a `getFeedbackLessons` — che il client
 * API continua a esportare, perché l'endpoint resta in piedi per gli altri
 * consumatori — e in review sembra un dettaglio del blocco feedback che è
 * legittimamente lì accanto. Il danno sarebbe rimettere sotto gli occhi i
 * commenti grezzi che l'owner ha chiesto di togliere dalla pagina.
 *
 * LIMITE DICHIARATO: è un controllo sul TESTO del file, non sul DOM reso. Vede
 * le tracce elencate qui sotto, non un pannello equivalente scritto con altre
 * parole o spostato in un componente nuovo. Sopra questo soffitto serve un test
 * di render (nel repo oggi non c'è un runner di componenti).
 */
import { readFileSync } from 'node:fs';

const PAGINA = 'src/routes/topics/[tier]/[name]/+page.svelte';

/** Tracce del pannello dismesso: se una torna, torna l'archivio in pagina. */
const VIETATI = [
	['Lessons</span>', 'il titolo della sezione rimossa'],
	['feedbackLessons', 'lo stato che teneva la lista delle lesson'],
	['getFeedbackLessons', 'la lettura delle lesson dalla pagina del topic'],
	['deleteFeedbackLesson', 'la cancellazione di una lesson dalla sidebar'],
	['feedback-lessons', 'lo stile della lista di lesson']
];

/** Ciò che deve restare: il gesto di valutare un messaggio, che questa issue
 *  non tocca. Se sparisce anche quello, la rimozione è andata troppo in là. */
const RICHIESTI = [
	['sendMessageFeedback', "l'invio del feedback su un messaggio"],
	['feedbackByMessage', 'lo stato 👍/👎 mostrato sulla bolla'],
	["rateMessage(m, 'thumbs_up')", 'il bottone di valutazione sulla bolla']
];

const guasti = [];
let src;
try {
	src = readFileSync(PAGINA, 'utf8');
} catch {
	// Un ENOENT qui è un esito: la pagina è stata spostata e il controllo non
	// guarda più niente. Meglio rosso che verde per assenza.
	console.error(`pannello Lessons: ${PAGINA} assente — spostato o rinominato`);
	process.exit(1);
}

for (const [ago, cosa] of VIETATI) {
	if (src.includes(ago)) guasti.push(`ricompare «${ago}» — ${cosa}`);
}
for (const [ago, cosa] of RICHIESTI) {
	if (!src.includes(ago)) guasti.push(`manca «${ago}» — ${cosa}`);
}

if (guasti.length) {
	console.error(`sidebar del topic (${PAGINA}):`);
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log('sidebar del topic: nessuna sezione «Lessons», feedback 👍/👎 intatto ✓');
