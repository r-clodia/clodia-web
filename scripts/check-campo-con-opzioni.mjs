#!/usr/bin/env node
/**
 * Un campo che ha un insieme di valori si SCEGLIE, non si digita.
 *
 * Questo controllo sostituisce `check-mailbox-connector.mjs`, che teneva la
 * stessa invariante su un solo connettore: la tendina delle caselle di sistema
 * del connettore Mailbox (clodia-platform#406). Dal #520 i bottoni di un topic
 * non sono più scritti a mano uno per connettore — li dichiara il manifest — e
 * una regola scritta sul nome «mailbox» proteggerebbe l'unico caso che oggi
 * esiste, lasciando scoperto il prossimo connettore che dichiara un campo con
 * un insieme di valori.
 *
 * Il difetto che impedisce è uno solo, ed è silenzioso: un `<input>` al posto
 * della tendina. Un indirizzo digitato a mano finisce in whitelist identico a
 * uno vero, ma dietro non c'è nessuna credenziale — l'autorizzazione esiste, la
 * casella no, e il sintomo arriva più tardi come «il verbo email non funziona»,
 * che non nomina la causa. Per lo stesso motivo il client non deve comporre il
 * valore da mandare: manda ciò che l'owner ha SCELTO, e il valore vero
 * (l'indirizzo) lo risolve il gateway dalla vault. Una whitelist il cui
 * contenuto lo decide il chiamante non è una whitelist.
 *
 * Tre fonti, nessuna delle quali è questo file: il modulo (che viene ESEGUITO),
 * la pagina del topic (dove sta la tendina) e il client API (dove si compone la
 * richiesta).
 *
 * LIMITE DICHIARATO: sul modulo esegue, sulla pagina e su `client.ts` guarda il
 * TESTO — vede che il ramo «scelta» rende un `<select>`, non come è reso.
 * Sopra questo soffitto serve un test di render, che in questo repo non ha
 * ancora un runner.
 */
import { leggiSorgente, senzaCommenti } from './lib/sorgente.mjs';
import { tipoDiCampo } from '../src/lib/connettori.js';

const PAGINA = 'src/routes/topics/[tier]/[name]/+page.svelte';
const CLIENT = 'src/lib/api/client.ts';

const guasti = [];

// ── 1. la regola, eseguita ───────────────────────────────────────────────────
const CASI = [
	// [campo, atteso, perché]
	[{ name: 'account', options: [{ value: 'studio', label: 'studio · info@x.it' }] }, 'scelta',
		'i valori risolti dal gateway sono una tendina'],
	[{ name: 'account', options: 'mailboxes' }, 'scelta',
		"il NOME dell'insieme, come lo dichiara il manifest, vale quanto i valori"],
	[{ name: 'chat', placeholder: '-100…' }, 'testo', 'un campo senza insieme è libero'],
	[{ name: 'chat', options: null }, 'testo', 'nessun insieme, nessuna tendina'],
	[{ name: 'chat', options: [] }, 'scelta',
		'un insieme VUOTO resta una scelta: zero opzioni è «non ce ne sono», non «scrivine una»'],
	[{ name: 'chat', options: '' }, 'testo', 'un nome vuoto non è un insieme']
];
for (const [campo, atteso, perche] of CASI) {
	const avuto = tipoDiCampo(campo);
	if (avuto !== atteso) {
		guasti.push(`tipoDiCampo(${JSON.stringify(campo)}) = «${avuto}», atteso «${atteso}» — ${perche}`);
	}
}

// ── 2. la pagina usa quella regola per scegliere il controllo ───────────────
const pagina = leggiSorgente(PAGINA, guasti, 'la pagina del topic');
if (pagina !== null) {
	const codice = senzaCommenti(pagina);
	for (const [ago, cosa] of [
		['tipoDiCampo', 'la regola, invece di una condizione riscritta in pagina'],
		['getConnectorAction', "lo stato dell'azione, da cui arrivano i campi"],
		['applyConnectorAction', "l'esecuzione dell'azione dichiarata"]
	]) {
		if (!codice.includes(ago)) guasti.push(`${PAGINA}: manca «${ago}» — ${cosa}`);
	}
	// Il ramo «scelta» deve rendere un <select>, e nient'altro.
	const ramo = codice.indexOf("tipoDiCampo(f) === 'scelta'");
	if (ramo < 0) {
		guasti.push(`${PAGINA}: il controllo del campo non è scelto da «tipoDiCampo»`);
	} else {
		const fino = codice.indexOf('{:else}', ramo);
		const dentro = codice.slice(ramo, fino > 0 ? fino : ramo + 600);
		if (!/<select\b/.test(dentro)) {
			guasti.push(
				`${PAGINA}: il ramo «scelta» non rende un <select> — un campo con un ` +
					'insieme di valori si sceglie fra quelli esistenti, non si digita'
			);
		}
		if (/<input\b/.test(dentro)) {
			guasti.push(
				`${PAGINA}: il ramo «scelta» contiene un <input>: un valore scritto a ` +
					'mano autorizza una risorsa che non esiste'
			);
		}
	}
}

// ── 3. il client manda la scelta, non un valore che compone lui ─────────────
const client = leggiSorgente(CLIENT, guasti, 'il client API');
if (client !== null) {
	const codice = senzaCommenti(client);
	const da = codice.indexOf('export async function applyConnectorAction');
	if (da < 0) {
		guasti.push(`${CLIENT}: manca «applyConnectorAction» — l'esecuzione di un'azione`);
	} else {
		const corpo = codice.slice(da, codice.indexOf('\n}', da) + 2);
		if (!/\{\s*action:\s*verso,\s*\.\.\.fields\s*\}/.test(corpo)) {
			guasti.push(
				`${CLIENT}: «applyConnectorAction» non inoltra i campi così come sono — ` +
					'elencarli qui riporta dentro il per-connettore, e un campo nuovo di un ' +
					'pack sparirebbe per strada'
			);
		}
		for (const vietato of ['email', 'address', 'indirizzo']) {
			if (new RegExp(`\\b${vietato}\\b`).test(corpo)) {
				guasti.push(
					`${CLIENT}: «applyConnectorAction» nomina «${vietato}»: il valore vero lo ` +
						'risolve il gateway dalla vault, non il browser'
				);
			}
		}
	}
}

if (guasti.length) {
	console.error('campo con insieme di valori:');
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log(
	'campo con insieme di valori: si sceglie fra quelli che il gateway offre, ' +
		'il client inoltra la scelta ✓'
);
