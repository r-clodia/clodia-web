#!/usr/bin/env node
/**
 * L'immagine del topic si cambia dal monogramma, non da una sezione in sidebar.
 *
 * Richiesta diretta dell'owner (issue clodia-platform#241): la sezione
 * «Immagine» nella colonna destra è rimossa; il monogramma accanto al titolo
 * apre un dialogo con anteprima, upload e rimozione, e dichiara la forma 1:1
 * consigliata. Il monogramma è cliccabile SOLO per l'owner: è l'unico che può
 * cambiarla, e un affordance che apre un dialogo dove non si può fare niente è
 * peggio della sua assenza.
 *
 * Perché un controllo e non solo il diff: le funzioni che caricano e tolgono
 * l'immagine restano in pagina (le riusa il dialogo), quindi rimettere la
 * `<details>` in sidebar costa venti righe e in review sembra il ripristino di
 * un pannello sparito per sbaglio. E la guardia `isOwner` sul click è una riga
 * sola dentro una funzione che, letta da fuori, sembra un banale toggle: si
 * perde in un refactor senza che niente in pagina lo segnali, perché il
 * dialogo si aprirebbe lo stesso — solo su chi non può salvare.
 *
 * LIMITE DICHIARATO: è un controllo sul TESTO del file, non sul DOM reso. Vede
 * le tracce elencate qui sotto, non un pannello equivalente riscritto con altre
 * parole o spostato in un componente nuovo, né l'apertura effettiva del
 * dialogo. Sopra questo soffitto serve un test di render (nel repo oggi non c'è
 * un runner di componenti).
 */
import { readFileSync } from 'node:fs';

const PAGINA = 'src/routes/topics/[tier]/[name]/+page.svelte';

/** Tracce della sezione dismessa: se una torna, torna il form in sidebar. */
const VIETATI = [
	['<span>Immagine</span>', 'il titolo della sezione rimossa'],
	['logo-panel', 'la classe della `<details>` che la conteneva']
];

/** Ciò che deve restare in piedi perché la strada nuova esista davvero. */
const RICHIESTI = [
	['apriDialogoLogo', "l'apertura del dialogo dal monogramma"],
	// Non basta cercare `if (!isOwner) return;`: la pagina ne ha altri, e
	// passerebbe verde anche se la guardia sparisse proprio da qui.
	['function apriDialogoLogo() {\n\t\tif (!isOwner) return;', "la guardia: solo l'owner apre il dialogo"],
	['class="mark-btn"', 'il monogramma reso cliccabile in testata'],
	['open={logoDialogOpen}', 'il dialogo agganciato al suo stato'],
	['on:change={caricaLogo}', "l'upload dentro il dialogo"],
	['on:click={togliLogo}', 'la rimozione dentro il dialogo'],
	['<b>1:1</b>', 'la forma consigliata dichiarata nel dialogo']
];

const guasti = [];
let src;
try {
	src = readFileSync(PAGINA, 'utf8');
} catch {
	// Un ENOENT qui è un esito: la pagina è stata spostata e il controllo non
	// guarda più niente. Meglio rosso che verde per assenza.
	console.error(`immagine del topic: ${PAGINA} assente — spostato o rinominato`);
	process.exit(1);
}

for (const [ago, cosa] of VIETATI) {
	if (src.includes(ago)) guasti.push(`ricompare «${ago}» — ${cosa}`);
}
for (const [ago, cosa] of RICHIESTI) {
	if (!src.includes(ago)) guasti.push(`manca «${ago}» — ${cosa}`);
}

if (guasti.length) {
	console.error(`immagine del topic (${PAGINA}):`);
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log("immagine del topic: nessuna sezione in sidebar, dialogo dal monogramma solo per l'owner ✓");
