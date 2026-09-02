#!/usr/bin/env node
/**
 * Un turno pubblicato a blocchi si legge come UNA bolla.
 *
 * Da `CLODIA_BUBBLE_PER_BLOCK` (clodia-platform#243) ogni blocco che un agente
 * chiude è un messaggio vero: un turno lungo arriva come N messaggi. Renderli
 * come N bolle indipendenti è ciò che a schermo sembra una risposta che
 * «collassa e ricomincia col chunk dopo» — segnalato da Davide il 2 set 2026,
 * e non risolto dalla PR #197 (che chiudeva un difetto diverso, la cintura che
 * cancellava le bolle dei turni vivi).
 *
 * Perché una guard: la regressione qui è di RESA. Non rompe niente, non sposta
 * dati, non fallisce un tipo — semplicemente il discorso torna spezzato, e ci si
 * accorge solo guardando un turno lungo dal vivo. E la tentazione di
 * «semplificare» saldando per autore grezzo o senza soglia di tempo è concreta:
 * il primo caso spezza i turni multi-spawn, il secondo fonde due run di un job
 * schedulato in un unico muro di testo.
 *
 * Esegue le funzioni VERE (`src/lib/turnGrouping.js`), non una copia.
 *
 *     node scripts/check-turn-grouping.mjs
 */
import { leggiSorgente, senzaCommenti } from './lib/sorgente.mjs';

const guasti = [];

let sameTurn, turnContinuity, liveContinuesLast, TURN_GAP_MS;
try {
	({ sameTurn, turnContinuity, liveContinuesLast, TURN_GAP_MS } = await import(
		'../src/lib/turnGrouping.js'
	));
} catch (e) {
	guasti.push(`src/lib/turnGrouping.js non si importa (${e && e.message})`);
}
for (const [nome, fn] of [
	['sameTurn', sameTurn],
	['turnContinuity', turnContinuity],
	['liveContinuesLast', liveContinuesLast]
]) {
	if (typeof fn !== 'function') {
		guasti.push(`src/lib/turnGrouping.js non esporta ${nome}: senza, i blocchi di un turno tornano N bolle`);
	}
}

const SEEDS = new Set(['avvocato', 'fullstack-dev', 'clodia']);
const seedOf = (n) => {
	const m = String(n || '').match(/^(.+)-\d+$/);
	return m && SEEDS.has(m[1]) ? m[1] : String(n || '');
};
const T = (min) => new Date(Date.UTC(2026, 8, 2, 10, min, 0)).toISOString();
const ai = (author, min) => ({ author, kind: 'ai', ts: T(min) });

if (typeof turnContinuity === 'function' && typeof sameTurn === 'function') {
	/** @type {Array<[string, any[], Array<[boolean, boolean]>]>} */
	const casi = [
		[
			'IL CASO SEGNALATO: tre blocchi dello stesso turno → una bolla sola',
			[ai('avvocato-42', 0), ai('avvocato-42', 1), ai('avvocato-42', 3)],
			[
				[false, true],
				[true, true],
				[true, false]
			]
		],
		[
			'blocchi con label diverse dello stesso seed (spawn vs seed dal tool) → saldati',
			[ai('avvocato-42', 0), ai('avvocato', 1)],
			[
				[false, true],
				[true, false]
			]
		],
		[
			'un umano in mezzo è un confine: due risposte, due bolle',
			[ai('avvocato-42', 0), { author: 'davide', kind: 'human', ts: T(1) }, ai('avvocato-42', 2)],
			[
				[false, false],
				[false, false],
				[false, false]
			]
		],
		[
			'un system in mezzo (reset, nota del router) resta bolla a sé',
			[ai('clodia-81', 0), { author: 'system', kind: 'system', ts: T(1) }, ai('clodia-81', 2)],
			[
				[false, false],
				[false, false],
				[false, false]
			]
		],
		[
			'due agenti diversi non si saldano mai, nemmeno consecutivi',
			[ai('avvocato-42', 0), ai('clodia-81', 1)],
			[
				[false, false],
				[false, false]
			]
		],
		[
			'due run di un job schedulato, distanti: NON un turno solo',
			[ai('clodia-81', 0), ai('clodia-81', 45)],
			[
				[false, false],
				[false, false]
			]
		],
		['lista vuota', [], []]
	];

	for (const [nome, messaggi, atteso] of casi) {
		const avuto = turnContinuity(messaggi, seedOf).map((c) => [c.prev, c.next]);
		const ok = JSON.stringify(avuto) === JSON.stringify(atteso);
		if (!ok) guasti.push(`${nome}: ${JSON.stringify(avuto)} (atteso ${JSON.stringify(atteso)})`);
		console.log(`${ok ? 'ok  ' : 'KO  '} ${nome} → ${JSON.stringify(avuto)}`);
	}

	// La soglia deve esistere e stare fra «una tool-call» e «un run di scheduler».
	if (!(TURN_GAP_MS > 60_000 && TURN_GAP_MS < 60 * 60_000)) {
		guasti.push(
			`TURN_GAP_MS = ${TURN_GAP_MS}: fuori dalla finestra utile (fra un minuto e un'ora). ` +
				`Troppo corta spezza i turni con tool lente, troppo lunga fonde due run schedulati`
		);
	}
}

if (typeof liveContinuesLast === 'function') {
	const adesso = [{ author: 'avvocato-42', kind: 'ai', ts: new Date().toISOString() }];
	const casi = [
		['la coda in streaming continua il blocco appena persistito', adesso, 'avvocato-42', true],
		['seed contro spawn: è lo stesso turno', adesso, 'avvocato', true],
		['un altro agente in streaming: bolla a sé', adesso, 'clodia-81', false],
		['nessun messaggio: niente a cui saldarsi', [], 'avvocato-42', false],
		[
			'ultimo messaggio umano: la risposta apre una bolla nuova',
			[{ author: 'davide', kind: 'human', ts: new Date().toISOString() }],
			'avvocato-42',
			false
		]
	];
	for (const [nome, messaggi, chiave, atteso] of casi) {
		const avuto = liveContinuesLast(messaggi, chiave, seedOf);
		const ok = avuto === atteso;
		if (!ok) guasti.push(`${nome}: ${avuto} (atteso ${atteso})`);
		console.log(`${ok ? 'ok  ' : 'KO  '} ${nome} → ${avuto}`);
	}
}

// E la pagina deve USARE le saldature: le funzioni importate e non applicate
// alle classi sono il difetto di partenza con due import in più.
const FILE = 'src/routes/topics/[tier]/[name]/+page.svelte';
const src = leggiSorgente(FILE, guasti, 'saldature fra i blocchi del turno');
if (src !== null) {
	const codice = senzaCommenti(src);
	if (!/turnContinuity\s*\(/.test(codice)) {
		guasti.push(`${FILE}: non calcola le saldature con turnContinuity — i blocchi di un turno tornano N bolle`);
	}
	if (!/liveContinuesLast\s*\(/.test(codice)) {
		guasti.push(`${FILE}: non salda la coda in streaming (liveContinuesLast): il salto resta, spostato di un blocco`);
	}
	for (const cls of ['cont-prev', 'cont-next']) {
		if (!new RegExp(`class:${cls}=`).test(codice)) {
			guasti.push(`${FILE}: manca la classe ${cls} sulle bolle: senza, la saldatura è calcolata e non resa`);
		}
	}
	if (!/class:head-cont=/.test(codice)) {
		guasti.push(
			`${FILE}: manca head-cont: l'intestazione ripetuta a metà discorso lo spezza di nuovo`
		);
	}
	// Il badge dello streaming non deve finire nascosto dall'intestazione fuori
	// flusso: una risposta in corso diventerebbe indistinguibile da una finita.
	if (!/\.msg-head\.head-cont\.head-live\s*\{[^}]*opacity:\s*1/.test(src)) {
		guasti.push(
			`${FILE}: il badge «sta rispondendo» della coda saldata non è forzato visibile ` +
				`(.msg-head.head-cont.head-live { opacity: 1 })`
		);
	}
}

if (guasti.length) {
	console.error('saldature del turno:');
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log('saldature del turno: N blocchi si leggono come una bolla che cresce ✓');
