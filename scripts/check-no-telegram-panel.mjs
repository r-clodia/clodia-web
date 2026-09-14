#!/usr/bin/env node
/**
 * Del meccanismo A di Telegram (gruppo «collegato» a uno scope dal pannello
 * della sidebar) non resta né la sezione in pagina né il codice che la serviva.
 *
 * Richiesta diretta dell'owner (issue clodia-platform#240): il pannello che
 * collegava/scollegava un gruppo Telegram allo scope e teneva la mappa
 * uid → persona non sta più nella colonna destra. Con clodia-platform#362
 * (epic #359, Telegram diventa un ingress come gli altri) è sparito anche il
 * codice client che lo alimentava: `telegram_binds` su `ChannelInfo.meta`,
 * l'interfaccia `TelegramMount` e la funzione `setTopicTelegram()`.
 *
 * Cosa NON viene toccato, e va detto perché è la metà che confonde: il mount
 * lato server (`meta.mounts`, `type: "telegram"`), l'endpoint
 * `POST /api/topics/{tier}/{name}/telegram` e la skill `mention-relay` del
 * messaggero restano in piedi. I gruppi già collegati continuano a ricevere le
 * menzioni; qui sparisce solo il client che li configurava. Resta in piedi
 * anche tutto il Telegram «buono»: la connessione del bot (`connectTelegram`)
 * e il recapito ai contatti umani.
 *
 * Perché un controllo e non solo il diff: finché `setTopicTelegram` era ancora
 * esportata dal client API, rimettere il pannello costava una `<details>` e una
 * chiamata, e in review sembrava un dettaglio di una sezione vicina che sta
 * legittimamente lì accanto. Ora che l'appiglio non c'è più, il modo di far
 * tornare il pannello è ri-scrivere prima la funzione: per questo il controllo
 * guarda DUE fonti indipendenti — la pagina e il client API — e non solo la
 * pagina. Una sola delle due non basta a far ricomparire la superficie, ma
 * ciascuna delle due è il primo passo per farlo.
 *
 * Il "testimone" di non-danno-collaterale era il pannello Proxy (condivideva
 * `.side-form`/`.side-form-row` col form Telegram): rimosso il 10 set 2026 e
 * sostituito da una sezione egress/ingress locale, quindi qui il testimone è
 * diventato quella — se la rimozione di Telegram si portasse via ANCHE la
 * sezione egress/ingress, avrebbe sforato.
 *
 * LIMITE DICHIARATO: è un controllo sul TESTO dei file, non sul DOM reso. Vede
 * le tracce elencate qui sotto, non un pannello equivalente scritto con altre
 * parole o spostato in un componente nuovo. Sopra questo soffitto serve un test
 * di render (nel repo oggi non c'è un runner di componenti).
 */
import { leggiSorgente, senzaCommenti } from './lib/sorgente.mjs';

const PAGINA = 'src/routes/topics/[tier]/[name]/+page.svelte';
const CLIENT = 'src/lib/api/client.ts';

/** Tracce della superficie dismessa, per file. Se una torna, torna il pannello
 *  (in pagina) o l'appiglio per riscriverlo in dieci righe (nel client). */
const VIETATI = {
	[PAGINA]: [
		['Telegram</span>', 'il titolo della sezione rimossa'],
		['setTopicTelegram', 'il collegamento/scollegamento del gruppo dalla pagina'],
		['tgMount', 'il mount telegram letto dalla sidebar'],
		['openTelegramForm', 'il bottone che apriva il form di collegamento'],
		['saveTelegram', 'il salvataggio del gruppo e della mappa uid → persona'],
		['unbindTelegram', 'lo scollegamento del gruppo'],
		['tg-', 'gli stili del pannello (.tg-form, .tg-mode, .tg-people, .tg-row)']
	],
	[CLIENT]: [
		['setTopicTelegram', 'la chiamata che collegava/scollegava il gruppo'],
		['TelegramMount', 'il tipo del mount telegram di uno scope'],
		['telegram_binds', 'i gruppi collegati sul meta del topic']
	]
};

/** Ciò che deve restare. In pagina: la sezione egress/ingress locale, vicina di
 *  posto alla Telegram rimossa. Nel client: il Telegram che serve ancora —
 *  la connessione del bot — e la lettura dell'egress/ingress del topic. Se
 *  sparissero anche loro, la rimozione ha sforato. */
const RICHIESTI = {
	[PAGINA]: [
		['getTopicEgressScope', "la lettura dell'egress/ingress locale del topic"],
		['egress-panel', 'la sezione che ha preso il posto del pannello Proxy']
	],
	[CLIENT]: [
		['getTopicEgressScope', "l'endpoint dell'egress/ingress locale del topic"],
		['connectTelegram', 'la connessione del bot Telegram, che resta un tool vivo']
	]
};

const guasti = [];

for (const [file, tracce] of Object.entries(VIETATI)) {
	const src = leggiSorgente(file, guasti, 'superficie del meccanismo A rimossa');
	if (src === null) continue;
	// I nomi rimossi compaiono ancora nei commenti che spiegano perché non ci
	// sono più: si cerca nel codice, non nella prosa (web#181).
	const codice = senzaCommenti(src);
	for (const [ago, cosa] of tracce) {
		if (codice.includes(ago)) guasti.push(`${file}: ricompare «${ago}» — ${cosa}`);
	}
}

for (const [file, tracce] of Object.entries(RICHIESTI)) {
	const src = leggiSorgente(file, guasti, 'ciò che la rimozione non doveva toccare');
	if (src === null) continue;
	for (const [ago, cosa] of tracce) {
		if (!src.includes(ago)) guasti.push(`${file}: manca «${ago}» — ${cosa}`);
	}
}

if (guasti.length) {
	console.error('meccanismo A Telegram nella webui:');
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log('meccanismo A Telegram: nessuna sezione in pagina, nessun client morto, egress/ingress e bot intatti ✓');
