#!/usr/bin/env node
/**
 * La sidebar del topic non offre più il «Client MCP» di una persona.
 *
 * Quel pannello emetteva un frammento di configurazione con dentro un token da
 * incollare in un client esterno (issue clodia-platform#242). Il proxy l'ha
 * superato: un sistema terzo entra in una stanza come partecipante con un nome,
 * una chiave e un owner che l'ha ammesso, e riceve un CONTRATTO — dove chiedere
 * il token firmando — non un segreto da copiare.
 *
 * Perché un controllo e non solo il diff: la metà rimossa e la metà rimasta
 * vivono nello stesso modulo e chiamano lo stesso endpoint. Reintrodurre il caso
 * umano costa una `<option>` e un campo di testo libero sul principal, e passa
 * inosservato in review — il pannello continuerebbe a chiamarsi «Proxy». Il
 * server rifiuta l'emissione (clodia-logic, `POST /mcp-clients`), quindi il
 * danno sarebbe una UI che promette una credenziale e riceve un 403: qui si
 * controlla che non la prometta.
 *
 * LIMITE DICHIARATO: è un controllo sul TESTO del file, non sul DOM reso. Vede
 * le tracce elencate qui sotto, non un pannello equivalente scritto con altre
 * parole o spostato in un componente nuovo. Sopra questo soffitto serve un test
 * di render (nel repo oggi non c'è un runner di componenti).
 */
import { readFileSync } from 'node:fs';

const PAGINA = 'src/routes/topics/[tier]/[name]/+page.svelte';

/** Tracce del pannello dismesso: se una torna, torna la credenziale. */
const VIETATI = [
	['Client MCP</span>', 'il titolo della sezione rimossa'],
	['collega un client', 'il bottone che apriva la coniazione per una persona'],
	['"anthropic-api"', 'le opzioni di provider del client di una persona'],
	["'anthropic-api'", 'il provider di default del client di una persona'],
	['configurazione MCP del client', 'le istruzioni per incollare il frammento']
];

/** Ciò che deve restare: l'arruolamento del proxy è l'unica cosa che questa
 *  superficie fa, e va offerto solo per chi è davvero un proxy. */
const RICHIESTI = [
	['proxyCandidates', 'la scelta del principal tra i proxy della stanza'],
	["a.type === 'proxy'", 'i proxy letti dal payload /api/agents'],
	['mcpFresh.contract', 'il contratto reso al posto del segreto']
];

const guasti = [];
let src;
try {
	src = readFileSync(PAGINA, 'utf8');
} catch {
	// Un ENOENT qui è un esito: la pagina è stata spostata e il controllo non
	// guarda più niente. Meglio rosso che verde per assenza.
	console.error(`pannello Client MCP: ${PAGINA} assente — spostato o rinominato`);
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
console.log('sidebar del topic: nessun pannello «Client MCP», solo proxy ✓');
