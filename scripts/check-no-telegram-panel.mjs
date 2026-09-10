#!/usr/bin/env node
/**
 * La sidebar del topic non mostra più la sezione «Telegram».
 *
 * Richiesta diretta dell'owner (issue clodia-platform#240): il pannello che
 * collegava/scollegava un gruppo Telegram allo scope e teneva la mappa
 * uid → persona non sta più nella colonna destra.
 *
 * Cosa NON viene toccato, e va detto perché è la metà che confonde: il mount
 * (`meta.mounts`, `type: "telegram"`), l'endpoint
 * `POST /api/topics/{tier}/{name}/telegram` e la skill `mention-relay` del
 * messaggero restano in piedi. I gruppi già collegati continuano a ricevere le
 * menzioni; sparisce la superficie che li configurava da questa pagina.
 *
 * Perché un controllo e non solo il diff: `setTopicTelegram` è ancora esportato
 * dal client API — l'endpoint serve altri consumatori — quindi rimettere il
 * pannello costa una `<details>` e una chiamata, e in review sembra un dettaglio
 * di una sezione vicina che sta legittimamente lì accanto.
 *
 * Il "testimone" di non-danno-collaterale era il pannello Proxy (condivideva
 * `.side-form`/`.side-form-row` col form Telegram): rimosso il 10 set 2026 e
 * sostituito da una sezione egress/ingress locale, quindi qui il testimone è
 * diventato quella — se la rimozione di Telegram si portasse via ANCHE la
 * sezione egress/ingress, avrebbe sforato.
 *
 * LIMITE DICHIARATO: è un controllo sul TESTO del file, non sul DOM reso. Vede
 * le tracce elencate qui sotto, non un pannello equivalente scritto con altre
 * parole o spostato in un componente nuovo. Sopra questo soffitto serve un test
 * di render (nel repo oggi non c'è un runner di componenti).
 */
import { readFileSync } from 'node:fs';

const PAGINA = 'src/routes/topics/[tier]/[name]/+page.svelte';

/** Tracce del pannello dismesso: se una torna, torna la sezione in pagina. */
const VIETATI = [
	['Telegram</span>', 'il titolo della sezione rimossa'],
	['setTopicTelegram', 'il collegamento/scollegamento del gruppo dalla pagina'],
	['tgMount', 'il mount telegram letto dalla sidebar'],
	['openTelegramForm', 'il bottone che apriva il form di collegamento'],
	['saveTelegram', 'il salvataggio del gruppo e della mappa uid → persona'],
	['unbindTelegram', 'lo scollegamento del gruppo'],
	['tg-', 'gli stili del pannello (.tg-form, .tg-mode, .tg-people, .tg-row)']
];

/** Ciò che deve restare: la sezione egress/ingress locale, vicina di posto
 *  alla Telegram rimossa. Se sparisse anche lei, la rimozione ha sforato. */
const RICHIESTI = [
	['getTopicEgressScope', 'la lettura dell\'egress/ingress locale del topic'],
	['egress-panel', 'la sezione che ha preso il posto del pannello Proxy']
];

const guasti = [];
let src;
try {
	src = readFileSync(PAGINA, 'utf8');
} catch {
	// Un ENOENT qui è un esito: la pagina è stata spostata e il controllo non
	// guarda più niente. Meglio rosso che verde per assenza.
	console.error(`pannello Telegram: ${PAGINA} assente — spostato o rinominato`);
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
console.log('sidebar del topic: nessuna sezione «Telegram», sezione egress/ingress intatta ✓');
