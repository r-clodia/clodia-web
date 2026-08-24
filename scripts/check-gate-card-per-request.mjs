#!/usr/bin/env node
/**
 * Una card di gate = UNA richiesta, e nel dubbio si mostrano i bottoni.
 *
 * Riproduce l'incidente del 17 ago 2026 (clodia-platform#232): sette
 * `egress.allow` consecutivi, stessa tripla `sysadmin|-|egress.allow`,
 * destinazioni diverse. L'esito della prima decisione era ricordato sotto la
 * tripla, quindi ogni card successiva nasceva già «decisa» — nessun bottone,
 * gateway in attesa, agente in timeout — e l'ottavo tentativo passava solo
 * perché la pagina era stata ricaricata.
 *
 * Il caso 2 è quello che deve restare rosso per sempre: è la frase «approvato»
 * su una richiesta che nessuno ha approvato.
 */
import { gateCardState, gateDestination, recordDecision } from '../src/lib/gateCard.js';

const T0 = Date.parse('2026-08-17T19:00:00Z');
const msg = (id, secondi) => ({ id, ts: new Date(T0 + secondi * 1000).toISOString() });
const TRIPLA = { id: 'sysadmin|-|egress.allow' };

const casi = [
	{
		nome: 'una sola richiesta, in coda → da decidere',
		stato: { decisi: {}, aperti: new Set([TRIPLA.id]), listaTs: T0 + 5000 },
		msg: msg('m1', 0),
		gate: TRIPLA,
		atteso: 'da-decidere'
	},
	{
		// L'INCIDENTE. La decisione si registra come la registra la pagina —
		// `recordDecision` — e poi si legge la card del round SUCCESSIVO: scrittura
		// e lettura in coppia, che è l'unico modo di cogliere una chiave sbagliata.
		nome: "l'esito è di QUESTA card, non di tutte quelle con la stessa tripla",
		stato: {
			decisi: recordDecision({}, msg('m1', 0), 'negato'),
			aperti: new Set([TRIPLA.id]),
			listaTs: T0 + 60000
		},
		msg: msg('m2', 30),
		gate: TRIPLA,
		atteso: 'da-decidere'
	},
	{
		nome: 'la card decisa resta decisa',
		stato: {
			decisi: recordDecision({}, msg('m1', 0), 'negato'),
			aperti: new Set([TRIPLA.id]),
			listaTs: T0 + 60000
		},
		msg: msg('m1', 0),
		gate: TRIPLA,
		atteso: 'decisa'
	},
	{
		nome: 'coda letta DOPO il messaggio e tripla assente → chiusa altrove',
		stato: { decisi: {}, aperti: new Set(), listaTs: T0 + 60000 },
		msg: msg('m3', 30),
		gate: TRIPLA,
		atteso: 'chiusa'
	},
	{
		nome: 'coda più VECCHIA del messaggio → non poteva conoscerlo, si decide',
		stato: { decisi: {}, aperti: new Set(), listaTs: T0 + 10000 },
		msg: msg('m4', 30),
		gate: TRIPLA,
		atteso: 'da-decidere'
	},
	{
		nome: 'lista mai arrivata → non è una lista vuota, si decide',
		stato: { decisi: {}, aperti: new Set(), listaTs: 0 },
		msg: msg('m5', 30),
		gate: TRIPLA,
		atteso: 'da-decidere'
	},
	{
		nome: 'messaggio senza timestamp leggibile → nel dubbio si decide',
		stato: { decisi: {}, aperti: new Set(), listaTs: T0 + 60000 },
		msg: { id: 'm6' },
		gate: TRIPLA,
		atteso: 'da-decidere'
	}
];

let rotti = 0;
for (const c of casi) {
	const avuto = gateCardState(c.stato, c.msg, c.gate);
	const ok = avuto === c.atteso;
	if (!ok) rotti++;
	console.log(`${ok ? 'ok  ' : 'ROTTO'} ${c.nome}: ${avuto} (atteso ${c.atteso})`);
}

// La destinazione: chi decide deve leggere VERSO COSA sta aprendo.
const dest = [
	['egress:email:mailto:hr@x.io', 'mailto:hr@x.io'],
	['egress:github:https://github.com/r-clodia/clodia-packs', 'https://github.com/r-clodia/clodia-packs'],
	// Gate su un'AZIONE: l'argomento non viaggia nel marcatore. Non si inventa.
	['egress.allow', null],
	['topic.put', null]
];
for (const [verbo, atteso] of dest) {
	const d = gateDestination(verbo);
	const avuto = d ? d.dest : null;
	const ok = avuto === atteso;
	if (!ok) rotti++;
	console.log(`${ok ? 'ok  ' : 'ROTTO'} destinazione di ${verbo}: ${avuto} (atteso ${atteso})`);
}

// Nessuna scorciatoia rimasta nella pagina: l'esito NON si indicizza sulla
// tripla. È il difetto originale, e ricomparirebbe con una riga.
import { readFileSync } from 'node:fs';
const PAGINA = new URL(
	'../src/routes/topics/[tier]/[name]/+page.svelte',
	import.meta.url
).pathname;
const pagina = readFileSync(PAGINA, 'utf8');
// Un file VUOTO passa il regex qui sotto senza che nulla sia stato verificato
// (clodia-platform#290): la scorciatoia «non c'è» perché non c'è nemmeno la
// pagina. Va detto, non taciuto — e qui si dice a mano perché questo controllo
// legge per URL e non per percorso di repo, quindi non passa da leggiSorgente.
if (pagina.trim() === '') {
	console.log('ROTTO la pagina del topic è VUOTA: nessuna scorciatoia verificata');
	rotti++;
}
if (/gateDecided\[g\.id\]|gateDecided,\s*\n?\s*\[g\.id\]/.test(pagina)) {
	console.log('ROTTO la pagina indicizza ancora un esito sulla tripla (gateDecided[g.id])');
	rotti++;
}

if (rotti) {
	console.error(
		`\nUna card di gate parla per una richiesta che non è la sua (${rotti} casi).\n` +
			"Nel dubbio si mostrano i bottoni: un rifiuto del backend è leggibile,\n" +
			'un «approvato» inventato è una decisione di sicurezza che nessuno ha preso.\n'
	);
	process.exit(1);
}
console.log('card di gate: una card una richiesta, e nel dubbio si decide ✓');
