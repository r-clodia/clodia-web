#!/usr/bin/env node
/**
 * Della delega per-agent dei connettori email non resta né la superficie in
 * pagina né il client che la serviva.
 *
 * Perché è sparita (clodia-platform#410): `getConnectors`/`grantConnector`
 * chiamavano `/api/connectors` e `/api/connectors/grant`, che l'agent-server
 * girava al gateway su `/internal/connectors` — una rotta che nel gateway non è
 * mai stata registrata. Ogni caricamento era un 502 finito in un `catch` che
 * mostrava «nessun connettore», e ogni spunta un errore: la UI raccontava una
 * decisione che il sistema non prendeva. Dietro, il modello era comunque
 * superato dal 18/09: una casella si autorizza PER SCOPE (whitelist
 * `inbox:`/`outbox:`, connettore Mailbox del canale, #406), non per agente.
 *
 * Perché un controllo e non solo il diff: questa superficie è sopravvissuta
 * rotta a lungo proprio perché il suo fallimento è silenzioso — lista vuota,
 * nessun errore in pagina. Rimetterla costa una riga di import e una `<section>`
 * che, accanto a «Grant del profilo» e alle caselle email, sembra a posto. Per
 * questo il controllo guarda TRE fonti indipendenti: il client API (l'appiglio)
 * e le due pagine che lo usavano. Nessuna delle tre, da sola, fa ricomparire la
 * superficie; ciascuna delle tre è il primo passo per farlo.
 *
 * Il testimone di non-danno-collaterale sono le due cose vicine che DEVONO
 * restare: la gestione delle caselle email nella pagina Tools (aggiungi /
 * rimuovi / stato) e i grant del profilo nella scheda agent — due UI di
 * concessione a un passo da quella rimossa. Se sparissero anche loro, la
 * rimozione ha sforato.
 *
 * LIMITE DICHIARATO: è un controllo sul TESTO dei file, non sul DOM reso. Vede
 * le tracce elencate qui sotto, non una delega equivalente riscritta con altri
 * nomi o spostata in un componente nuovo. Sopra questo soffitto serve un test
 * di render (nel repo oggi non c'è un runner di componenti).
 */
import { leggiSorgente, senzaCommenti } from './lib/sorgente.mjs';

const CLIENT = 'src/lib/api/client.ts';
const AGENTE = 'src/routes/agents/[name]/+page.svelte';
const TOOLS = 'src/routes/tools/+page.svelte';

/** Tracce della superficie dismessa, per file. */
const VIETATI = {
	[CLIENT]: [
		['getConnectors', 'la lettura dei connettori con lo stato di grant per-agent'],
		['grantConnector', 'la chiamata che concedeva/revocava un account a un agent'],
		['/api/connectors', "l'endpoint che il gateway non ha mai servito"]
	],
	[AGENTE]: [
		['loadConnectors', 'il caricamento dei connettori nella scheda agent'],
		['toggleConnector', "la spunta che concedeva l'account a questo agent"],
		['conn-toggle', 'gli stili della sezione «Connettori (delega per-agent)»']
	],
	[TOOLS]: [
		['cambiaGrant', 'la delega della casella dal modale Caselle email'],
		['chiHa', "l'elenco degli agenti che possono usare una casella"],
		['grant-chip', 'i chip di revoca per-agent accanto alla casella']
	]
};

/** Ciò che la rimozione non doveva toccare: le concessioni vicine di posto. */
const RICHIESTI = {
	[CLIENT]: [
		['getTools', 'lo stato dei connettori, che resta letto da `GET /tools`'],
		['getMailboxes', 'la gestione delle caselle email, che resta viva'],
		['grantAgentProfile', "i grant del profilo agent, che sono un'altra cosa"]
	],
	[AGENTE]: [['prof-grants', 'la sezione dei grant del profilo, vicina di posto']],
	[TOOLS]: [
		['addMailbox', "l'aggiunta di una casella IMAP/SMTP"],
		['deleteMailbox', 'la rimozione di una casella']
	]
};

const guasti = [];

for (const [file, tracce] of Object.entries(VIETATI)) {
	const src = leggiSorgente(file, guasti, 'superficie della delega per-agent rimossa');
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
	console.error('delega per-agent dei connettori nella webui:');
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log('connettori: nessuna delega per-agent, nessun client morto, caselle email e grant del profilo intatti ✓');
