#!/usr/bin/env node
/**
 * Un servizio di pack che non parte si VEDE, e si vede che non è partito.
 *
 * clodia-platform#515: il gateway supervisiona i processi lungo-vivi che i pack
 * dichiarano. Un connettore che ha bisogno di un processo è rotto quanto quel
 * processo — un listener morto non dà nessun errore a nessuno, semplicemente
 * non arriva più niente, ed è il guasto più silenzioso di tutti. La pagina
 * Tools è il posto dove quello stato diventa leggibile.
 *
 * Due difetti, entrambi plausibili, entrambi silenziosi:
 *
 * 1. **la pagina si rompe sul campo assente.** `services` arriva con
 *    clodia-tools#362: finché quella versione non è in produzione il gateway
 *    non lo manda. Una pagina che esplode su un campo che arriverà è peggio di
 *    una sezione che non c'è ancora;
 * 2. **un servizio fallito è disegnato come uno vivo.** Se «rotto» si deducesse
 *    solo da uno stato testuale, un backoff — che è un servizio che muore e
 *    riparte in cerchio — sembrerebbe un servizio sano, e l'`last_error` che
 *    dice perché resterebbe in un campo che nessuno legge.
 *
 * Due fonti indipendenti, nessuna delle quali è questo file: il modulo (che
 * viene ESEGUITO) e la pagina Tools (dove sta la sezione).
 */
import { leggiSorgente, senzaCommenti } from './lib/sorgente.mjs';
import { serviziDiPack } from '../src/lib/connettori.js';

const PAGINA = 'src/routes/tools/+page.svelte';
const guasti = [];

// ── 1. la regola, eseguita ───────────────────────────────────────────────────
for (const [payload, perche] of [
	[{ connectors: [] }, 'campo assente (gateway precedente a #362)'],
	[{ connectors: [], services: null }, 'campo nullo'],
	[{ services: 'boh' }, 'campo di un tipo che non ci aspettiamo'],
	[undefined, 'nessun payload']
]) {
	const out = serviziDiPack(payload);
	if (!Array.isArray(out) || out.length) {
		guasti.push(`serviziDiPack: ${perche} non dà una lista vuota — la pagina si romperebbe`);
	}
}

const RIGHE = [
	{ pack: 'sms-pack', service: 'listener', state: 'running', pid: 42, isolated: true, failures: 0, health: 'ok' },
	{ pack: 'sms-pack', service: 'poller', state: 'backoff', failures: 3, last_error: 'exit 1: porta occupata' },
	{ pack: 'altro', service: 'x', state: 'failed', failures: 9, last_error: 'credenziale assente' }
];
const out = serviziDiPack({ services: RIGHE });
if (out.length !== 3) guasti.push('serviziDiPack: perde delle righe');
const vivo = out[0];
const backoff = out[1];
const fallito = out[2];
if (!vivo?.vivo || vivo.rotto) guasti.push('un servizio che gira non è disegnato come vivo');
if (!backoff?.rotto) {
	guasti.push(
		'un servizio in backoff non è segnalato come rotto: muore e riparte in cerchio, ' +
			'e sembrerebbe sano'
	);
}
if (backoff?.ultimoErrore !== 'exit 1: porta occupata') {
	guasti.push("l'ultimo errore non arriva alla pagina: è l'unica cosa che dice PERCHÉ");
}
if (!fallito?.rotto || fallito.vivo) guasti.push('un servizio fallito non è disegnato come rotto');
if (out.some((r) => !r.chiave.includes('/'))) guasti.push('un servizio non è identificabile come pack/servizio');
// Nessun segreto: la riga porta nomi e stato, mai l'ambiente o il comando.
for (const r of out) {
	for (const chiave of Object.keys(r)) {
		if (/env|command|secret|token|credential/i.test(chiave)) {
			guasti.push(`la riga di un servizio porta «${chiave}»: non è roba da pagina`);
		}
	}
}

// ── 2. la pagina mostra stato e ultimo errore ───────────────────────────────
const pagina = leggiSorgente(PAGINA, guasti, 'la pagina Tools');
if (pagina !== null) {
	const codice = senzaCommenti(pagina);
	for (const [ago, cosa] of [
		['serviziDiPack', 'i servizi, derivati dal payload'],
		['{#if servizi.length}', 'la sezione compare solo se c’è qualcosa da mostrare'],
		['s.ultimoErrore', "l'ultimo errore, che è l'unica cosa che dice perché"],
		['s.stato', 'lo stato del servizio']
	]) {
		if (!codice.includes(ago)) guasti.push(`${PAGINA}: manca «${ago}» — ${cosa}`);
	}
}

if (guasti.length) {
	console.error('servizi dei pack:');
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log('servizi dei pack: stato e ultimo errore visibili, campo assente tollerato ✓');
