#!/usr/bin/env node
/**
 * Sotto la chat c'è la DIDASCALIA dell'obiettivo, non il pannello del routing
 * (clodia-platform#468).
 *
 * Cosa è cambiato e perché: da quando l'instradamento passa solo
 * dall'orchestratore o da una menzione diretta, la barra 🧭 mostrava punteggi
 * che nessuno correggeva più e teneva occupato il posto immediatamente sopra il
 * composer. Al suo posto, in una riga, sta l'obiettivo del canale — che prima
 * apriva lo stream con una fascia alta tre righe, e scorreva via appena si
 * leggevano i messaggi.
 *
 * Tre ricadute possibili, tutte mute:
 *
 *   1. il pannello del routing torna (ricompare un `lastRouting`, un chip di
 *      correzione, una tabella di punteggi): lo spazio sotto la chat è uno solo
 *      e tornerebbe a essere suo;
 *   2. la didascalia **risale** in cima allo stream, o finisce sotto il
 *      composer: non è un dettaglio estetico — in cima torna a scorrere via con
 *      la conversazione, sotto al composer non la guarda nessuno mentre scrive;
 *   3. la didascalia torna a crescere: il testo dell'obiettivo va a capo e la
 *      riga diventa la fascia di prima con un altro nome. La differenza si
 *      vede nel CSS (troncamento) e nel markup (il testo intero nel `title`):
 *      senza il `title` troncare vorrebbe dire NASCONDERE il requisito.
 *
 * E una ricaduta di senso opposto — aver sforato: i tre stati in cui il lavoro
 * è fermo ad aspettare l'owner (approva strategia, esito accettato, togli il
 * pin) devono avere un bottone DENTRO la didascalia. Spostare la fascia senza
 * portarsi dietro i bottoni non è una didascalia più piccola, è l'amputazione
 * degli unici tre gesti che sbloccano un obiettivo.
 *
 * Due file indipendenti, nessuno dei quali è questo:
 *   - la pagina del topic, per il markup e il CSS;
 *   - `src/lib/api/client.ts`, per dimostrare che è sparita la SUPERFICIE e non
 *     il meccanismo: le rotte di routing restano esposte (decisione dell'owner
 *     sulla #468), e la loro rimozione è semmai una issue a parte.
 *
 * LIMITE DICHIARATO: è un controllo sul TESTO, non sul DOM reso. Vede le tracce
 * elencate qui sotto e l'ORDINE in cui compaiono nel sorgente, non un pannello
 * di routing riscritto con altre parole o spostato in un componente nuovo.
 *
 *     node scripts/check-goal-caption.mjs
 */
import { leggiSorgente, senzaCommenti } from './lib/sorgente.mjs';

const PAGINA = 'src/routes/topics/[tier]/[name]/+page.svelte';
const CLIENT = 'src/lib/api/client.ts';

/** Tracce del pannello dismesso: se una torna, è tornato il pannello. */
const VIETATI = [
	['lastRouting', "lo stato dell'ultima decisione del router"],
	['routing-head', "l'intestazione comprimibile 🧭"],
	['routing-scores', 'la tabella dei punteggi di pertinenza'],
	['correctRoute', 'il chip «avresti usato: X»'],
	['confirmRoute', 'il chip «scelta corretta»'],
	['overruleRoute', 'il chip «passa il turno adesso a X»'],
	['routingReasonLabel', "l'etichetta della reason del router"],
	['isFallbackReason', "l'evidenza del ripiego"]
];

/** Ciò che deve restare: la rimozione riguarda il PANNELLO. */
const RICHIESTI_PAGINA = [
	[
		'on:stop={(e) => stopAgent(e.detail)}',
		'il ⏹ nel box live: è quel che resta per fermare un turno in corso ' +
			'(interrompe soltanto, non consegna il turno a un altro agente)'
	],
	[
		'resolveRoutingChoice',
		'la pill di scelta dentro la bolla, quando è il backend a chiedere chi ' +
			'deve rispondere: è un altro meccanismo, fuori dalla #468'
	]
];

/** Il meccanismo resta vivo lato client: sparisce la superficie, non la rotta. */
const RICHIESTI_CLIENT = [
	['overruleRouting', "il verbo che ferma il turno e lo consegna"],
	['recordRoutingFeedback', 'il feedback sulla scelta del router'],
	['routing-overrule', 'la rotta dello scavalcamento, che il backend espone ancora']
];

const guasti = [];
const src = leggiSorgente(PAGINA, guasti, "didascalia dell'obiettivo");
if (src !== null) {
	// I VIETATI si cercano a commenti spogliati: il commento che spiega perché
	// il pannello non c'è più lo nomina (web#181).
	const codice = senzaCommenti(src);
	for (const [ago, cosa] of VIETATI) {
		if (codice.includes(ago)) guasti.push(`ricompare «${ago}» — ${cosa}`);
	}
	for (const [ago, cosa] of RICHIESTI_PAGINA) {
		if (!codice.includes(ago)) guasti.push(`manca «${ago}» — ${cosa}`);
	}

	// ── Dove sta la didascalia ────────────────────────────────────────────
	// Il posto è definito da due vicini: viene DOPO la fine dello stream dei
	// messaggi (quindi non è più in cima) e PRIMA del composer (quindi la si
	// legge mentre si scrive). Cercare la posizione, e non la presenza, è
	// l'unico modo perché «l'ho spostata» sia una cosa verificabile.
	const cap = codice.indexOf('class="goal-cap"');
	const stream = codice.indexOf('class="stream"');
	const composer = codice.indexOf('class="composer"');
	if (cap < 0) {
		guasti.push(
			'nessun elemento `goal-cap`: la didascalia dell’obiettivo non è in pagina, ' +
				'e la fascia che sostituisce non deve tornare al suo posto'
		);
	} else if (stream < 0 || composer < 0) {
		guasti.push(
			'non trovo `stream` o `composer` nella pagina: se la struttura è stata ' +
				'riscritta, riscrivi anche questo controllo invece di lasciarlo passare'
		);
	} else if (!(cap > stream && cap < composer)) {
		guasti.push(
			'la didascalia non sta fra la fine della chat e il composer ' +
				`(goal-cap@${cap}, stream@${stream}, composer@${composer}): in cima allo ` +
				'stream torna a scorrere via coi messaggi, sotto al composer non la vede nessuno'
		);
	}

	// ── La didascalia resta una riga, e non nasconde il requisito ─────────
	const regola = codice.match(/\.goal-cap-text\s*\{([^}]*)\}/);
	if (!regola) {
		guasti.push('manca la regola CSS `.goal-cap-text`: il testo dell’obiettivo non ha più una forma');
	} else {
		if (!/text-overflow\s*:\s*ellipsis/.test(regola[1]) || !/white-space\s*:\s*nowrap/.test(regola[1])) {
			guasti.push(
				'`.goal-cap-text` non tronca più su una riga: una richiesta lunga fa ' +
					'crescere la didascalia, che torna a essere la fascia di prima'
			);
		}
	}
	if (!/class="goal-cap-text"[^>]*title=\{goal\.text\}/.test(codice)) {
		guasti.push(
			'il testo troncato non porta l’obiettivo intero nel `title`: troncare senza ' +
				'un modo di leggere tutto è nascondere il requisito, non riassumerlo'
		);
	}

	// ── I gesti dell'owner sono DENTRO la didascalia ──────────────────────
	// Non basta che esistano nel file: se restano appesi a un blocco rimosso,
	// il sorgente li contiene e lo schermo no.
	const blocco = codice.match(/<div class="goal-cap"[\s\S]*?\n\t{3}<\/div>/);
	if (!blocco) {
		if (cap >= 0) guasti.push('il blocco `goal-cap` non si chiude dove me lo aspetto: controllo saltato, quindi rosso');
	} else {
		for (const [ago, cosa] of [
			["goal.state === 'strategy-review'", "l'approvazione della strategia"],
			["goal.state === 'claimed-done'", "l'accettazione dell'esito"],
			['togliObiettivo', "il pin da togliere, che è ciò che ferma l'esecuzione"]
		]) {
			if (!blocco[0].includes(ago)) {
				guasti.push(
					`dentro la didascalia non c'è ${cosa}: spostare la fascia senza i suoi ` +
						`bottoni lascia l'obiettivo fermo senza un posto dove cliccare`
				);
			}
		}
	}
}

const cli = leggiSorgente(CLIENT, guasti, 'rotte di routing lato client');
if (cli !== null) {
	for (const [ago, cosa] of RICHIESTI_CLIENT) {
		if (!cli.includes(ago)) {
			guasti.push(
				`${CLIENT}: manca «${ago}» — ${cosa}. La #468 toglie il PANNELLO: ` +
					`le rotte restano, per decisione dell'owner`
			);
		}
	}
}

if (guasti.length) {
	console.error("didascalia dell'obiettivo sotto la chat:");
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log(
	"didascalia dell'obiettivo: una riga fra chat e composer, coi gesti dell'owner, " +
		'niente pannello del routing, rotte intatte ✓'
);
