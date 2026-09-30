#!/usr/bin/env node
/**
 * L'obiettivo del canale: chi lo può fissare, e da dove si legge
 * (clodia-platform#457).
 *
 * Due regressioni possibili, entrambe mute:
 *   1. il bottone 🎯 finisce anche sulle bolle degli AGENTI — pinnare la
 *      risposta di Clodia le farebbe eseguire il proprio riassunto — o su
 *      quelle di un non-owner, e allora un partecipante può appendere al
 *      canale un lavoro che impegna gli agenti finché resta lì;
 *   2. la fascia dell'obiettivo si mette a leggere il TESTO delle bolle invece
 *      del meta: allora il requisito scorre via con la conversazione, che è
 *      esattamente la cosa che il pin doveva impedire.
 *
 * Tre controlli su file indipendenti: la funzione vera eseguita sui casi, la
 * pagina che la usa, il client che non firma il pin da sé.
 *
 *     node scripts/check-goal-pin.mjs
 */
import { leggiSorgente, senzaCommenti } from './lib/sorgente.mjs';

const guasti = [];

let goal;
try {
	goal = await import('../src/lib/goal.js');
} catch (e) {
	guasti.push(`src/lib/goal.js non si importa (${e && e.message})`);
}

if (goal) {
	const { puoDiventareObiettivo, eObiettivoFissato, statoObiettivo, attendeOwner } = goal;
	for (const [nome, fn] of Object.entries({
		puoDiventareObiettivo,
		eObiettivoFissato,
		statoObiettivo,
		attendeOwner
	})) {
		if (typeof fn !== 'function') guasti.push(`src/lib/goal.js non esporta ${nome}`);
	}

	if (typeof puoDiventareObiettivo === 'function') {
		/** @type {Array<[string, any, any, boolean]>} */
		const casi = [
			['richiesta dell’utente, io sono owner → si può fissare', { kind: 'human', text: 'porta il sito live' }, { isOwner: true }, true],
			['la stessa richiesta, ma non sono owner → niente bottone', { kind: 'human', text: 'porta il sito live' }, { isOwner: false }, false],
			['risposta di un agente → MAI un obiettivo', { kind: 'ai', text: 'ho fatto' }, { isOwner: true }, false],
			['riga di sistema → MAI un obiettivo', { kind: 'system', text: 'obiettivo rimosso' }, { isOwner: true }, false],
			['messaggio arrivato da Telegram: è pur sempre una persona', { kind: 'telegram', text: 'fai X' }, { isOwner: true }, true],
			['bolla vuota: non c’è nessun requisito da fissare', { kind: 'human', text: '   ' }, { isOwner: true }, false],
			['kind assente = messaggio umano (forma legacy)', { text: 'fai X' }, { isOwner: true }, true],
			['nessun messaggio', null, { isOwner: true }, false]
		];
		for (const [nome, m, ctx, atteso] of casi) {
			const avuto = puoDiventareObiettivo(m, ctx);
			const ok = avuto === atteso;
			if (!ok) guasti.push(`${nome}: ${avuto} (atteso ${atteso})`);
			console.log(`${ok ? 'ok  ' : 'KO  '} ${nome} → ${avuto}`);
		}
	}

	if (typeof eObiettivoFissato === 'function') {
		// Il confronto è sull'id, non sul testo: nel meta il testo è una COPIA
		// troncata, e due richieste identiche a distanza di giorni sono due
		// obiettivi diversi.
		const g = { text: 'porta il sito…', message_id: 'm-1' };
		if (!eObiettivoFissato({ id: 'm-1' }, g)) guasti.push('il messaggio pinnato non viene riconosciuto');
		if (eObiettivoFissato({ id: 'm-2' }, g)) guasti.push('un altro messaggio passa per l’obiettivo fissato');
		if (eObiettivoFissato({ id: 'm-1' }, null)) guasti.push('senza obiettivo, nessuna bolla può risultare fissata');
		if (eObiettivoFissato({}, { text: 'x' })) guasti.push('un goal senza message_id non deve marcare bolle a caso');
	}

	if (typeof statoObiettivo === 'function' && typeof attendeOwner === 'function') {
		if (statoObiettivo(null) !== null) guasti.push('nessun obiettivo → nessuna fascia');
		if (statoObiettivo({ text: '  ' }) !== null) guasti.push('un goal senza testo non è un obiettivo');
		const sconosciuto = statoObiettivo({ text: 'x', state: 'boh' });
		if (!sconosciuto || sconosciuto.stato !== 'pinned') {
			guasti.push('uno stato sconosciuto deve degradare a `pinned`, non far sparire la fascia');
		}
		// L'invariante detta a voce alta: la fascia si evidenzia ESATTAMENTE
		// quando la mossa è dell'owner. Un goal fermo su un sì che nessuno sa di
		// dover dare è il modo in cui questa funzione fallisce in silenzio.
		const attesa = { 'strategy-review': true, 'claimed-done': true, pinned: false, 'in-progress': false, done: false };
		for (const [stato, atteso] of Object.entries(attesa)) {
			const avuto = attendeOwner({ text: 'x', state: stato });
			if (avuto !== atteso) guasti.push(`attendeOwner(${stato}) = ${avuto} (atteso ${atteso})`);
		}
	}
}

// ── La pagina usa il modulo e legge il goal dal META ───────────────────────
const PAGINA = 'src/routes/topics/[tier]/[name]/+page.svelte';
const src = leggiSorgente(PAGINA, guasti, 'obiettivo del canale');
if (src !== null) {
	const codice = senzaCommenti(src);
	if (!/puoDiventareObiettivo\s*\(/.test(codice)) {
		guasti.push(
			`${PAGINA}: il bottone 🎯 non passa da puoDiventareObiettivo(): decidere sul posto ` +
				`kind e ruolo è come è nato il problema — la condizione diverge al primo ritocco`
		);
	}
	const decl = codice.match(/\$:\s*goal\s*=([^\n]*)/);
	if (!decl) {
		guasti.push(`${PAGINA}: non trovo la derivazione di \`goal\` — se è stata riscritta, riscrivi anche questa guard`);
	} else if (!/info\?\.meta\?\.goal/.test(decl[1])) {
		guasti.push(
			`${PAGINA}: \`goal\` non viene dal meta del canale (${decl[1].trim()}): ricavarlo dai messaggi ` +
				`lo fa scorrere via con la conversazione, che è ciò che il pin deve impedire`
		);
	}
	// Togliere il pin ferma l'esecuzione: deve restare raggiungibile.
	if (!/togliObiettivo\s*\(/.test(codice)) {
		guasti.push(`${PAGINA}: non c'è più modo di togliere il pin, e l'unpin è ciò che ferma la strategia`);
	}
}

// ── Il client non firma il pin al posto del server ─────────────────────────
const CLIENT = 'src/lib/api/client.ts';
const cli = leggiSorgente(CLIENT, guasti, 'client dell’obiettivo');
if (cli !== null) {
	const codice = senzaCommenti(cli);
	const fn = codice.match(/export async function setTopicGoal[\s\S]*?\n}/);
	if (!fn) {
		guasti.push(`${CLIENT}: manca setTopicGoal(): la pagina non ha una porta per fissare l'obiettivo`);
	} else {
		if (!/\/goal`/.test(fn[0])) guasti.push(`${CLIENT}: setTopicGoal non chiama la rotta .../goal`);
		if (/pinned_by/.test(fn[0])) {
			guasti.push(
				`${CLIENT}: setTopicGoal manda \`pinned_by\`: chi ha fissato l'obiettivo lo scrive il ` +
					`server col principal verificato — un campo che il client riempie da sé non è una firma`
			);
		}
	}
}

if (guasti.length) {
	console.error('obiettivo del canale:');
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log('obiettivo del canale: solo l’owner lo fissa, solo sulle richieste umane, e si legge dal meta ✓');
