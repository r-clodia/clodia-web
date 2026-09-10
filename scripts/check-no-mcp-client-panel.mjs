#!/usr/bin/env node
/**
 * La sidebar del topic non offre più né il «Client MCP» di una persona, né il
 * pannello «Proxy» che lo aveva superato.
 *
 * Storia in due passi. Il primo pannello (clodia-platform#242) emetteva un
 * frammento di configurazione con dentro un token da incollare in un client
 * esterno; il proxy l'ha superato — un sistema terzo entra come partecipante
 * con un nome, una chiave e un owner che l'ha ammesso, e riceve un CONTRATTO,
 * non un segreto da copiare. Questo controllo verificava che il primo non
 * tornasse e che il secondo restasse.
 *
 * Il secondo passo (Davide, 10 set 2026): anche il pannello Proxy sparisce
 * dalla sidebar del topic — sostituito da una sezione egress/ingress LOCALE
 * al topic, sola lettura, con un link alle impostazioni globali. L'emissione/
 * revoca dei grant proxy non è stata spostata altrove in questo giro: se
 * tornerà, sarà una decisione a sé, non un ritorno silenzioso di questa UI.
 *
 * LIMITE DICHIARATO: è un controllo sul TESTO del file, non sul DOM reso. Vede
 * le tracce elencate qui sotto, non un pannello equivalente scritto con altre
 * parole o spostato in un componente nuovo. Sopra questo soffitto serve un test
 * di render (nel repo oggi non c'è un runner di componenti).
 */
import { readFileSync } from 'node:fs';

const PAGINA = 'src/routes/topics/[tier]/[name]/+page.svelte';

/** Tracce dei due pannelli dismessi: se una torna, torna la credenziale
 *  incollata a mano o l'emissione di grant proxy da questa superficie. */
const VIETATI = [
	['Client MCP</span>', 'il titolo della sezione «Client MCP» (primo pannello)'],
	['collega un client', 'il bottone che apriva la coniazione per una persona'],
	['"anthropic-api"', 'le opzioni di provider del client di una persona'],
	["'anthropic-api'", 'il provider di default del client di una persona'],
	['configurazione MCP del client', 'le istruzioni per incollare il frammento'],
	['<span>Proxy</span>', 'il titolo della sezione «Proxy» (secondo pannello)'],
	['proxyCandidates', 'la scelta del principal tra i proxy della stanza'],
	['mcpFresh', 'il contratto reso al posto del segreto'],
	['issueTopicMcpClient', 'la funzione che coniava/revocava un grant proxy'],
	['ammetti un proxy', 'il bottone che apriva il form di arruolamento']
];

/** Ciò che deve restare: la sezione che ha preso il posto del pannello Proxy. */
const RICHIESTI = [
	['getTopicEgressScope', 'la lettura dell\'egress/ingress locale del topic'],
	['Egress/Ingress', 'il titolo della nuova sezione'],
	['/settings/egress', 'il link alle impostazioni globali']
];

const guasti = [];
let src;
try {
	src = readFileSync(PAGINA, 'utf8');
} catch {
	// Un ENOENT qui è un esito: la pagina è stata spostata e il controllo non
	// guarda più niente. Meglio rosso che verde per assenza.
	console.error(`pannello Client MCP/Proxy: ${PAGINA} assente — spostato o rinominato`);
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
console.log('sidebar del topic: nessun pannello «Client MCP»/«Proxy», solo egress/ingress locale ✓');
