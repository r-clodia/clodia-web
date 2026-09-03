#!/usr/bin/env node
/**
 * Il polling del topic non gira a intervallo fisso, e non gira in background.
 *
 * Misurato il 3 set 2026 con tre topic aperti: **594 richieste in tre minuti**,
 * ~200 al minuto. Il server le regge (25 ms per chiamata, gateway all'11% di
 * CPU); a pagarle era il BROWSER — la sola scheda di un canale con 397 messaggi
 * riscaricava 368.546 caratteri dodici volte al minuto, ~5,4 MB/min di JSON da
 * parsare più il markdown di 200 messaggi da ri-renderizzare. Due di quelle tre
 * schede nessuno le stava guardando.
 *
 * Perché una guard: `setInterval(refreshLive, 5000)` è una riga innocua, che
 * torna facilissima da riscrivere — e la regressione non rompe niente. Nessun
 * errore, nessun test rosso: solo una pagina che ridiventa pesante, su una
 * macchina che magari regge. Si nota mesi dopo, e solo se qualcuno conta le
 * richieste.
 *
 * Esegue le funzioni VERE (`src/lib/polling.js`), non una copia.
 *
 *     node scripts/check-polling-adattivo.mjs
 */
import { leggiSorgente, senzaCommenti } from './lib/sorgente.mjs';

const guasti = [];

let pollDelay, artifactDelay, POLL_ATTIVO_MS, POLL_QUIETE_MS, POLL_LUNGA_MS;
try {
	({ pollDelay, artifactDelay, POLL_ATTIVO_MS, POLL_QUIETE_MS, POLL_LUNGA_MS } =
		await import('../src/lib/polling.js'));
} catch (e) {
	guasti.push(`src/lib/polling.js non si importa (${e && e.message})`);
}
for (const [nome, fn] of [['pollDelay', pollDelay], ['artifactDelay', artifactDelay]]) {
	if (typeof fn !== 'function') guasti.push(`src/lib/polling.js non esporta ${nome}`);
}

if (typeof pollDelay === 'function') {
	const M = 60_000;
	const casi = [
		['IL CASO MISURATO: scheda in background → non si polla',
			{ visibile: false, turnoAttivo: false, msDaUltimoSegno: 0 }, null],
		['background anche con un turno attivo: nessuno sta guardando',
			{ visibile: false, turnoAttivo: true, msDaUltimoSegno: 0 }, null],
		['turno attivo e scheda in primo piano → ciclo pieno',
			{ visibile: true, turnoAttivo: true, msDaUltimoSegno: 30 * M }, POLL_ATTIVO_MS],
		['appena parlato → ancora reattivo',
			{ visibile: true, turnoAttivo: false, msDaUltimoSegno: 10_000 }, POLL_ATTIVO_MS],
		['ferma da 5 minuti → si allenta',
			{ visibile: true, turnoAttivo: false, msDaUltimoSegno: 5 * M }, POLL_QUIETE_MS],
		['ferma da mezz’ora → giro lungo',
			{ visibile: true, turnoAttivo: false, msDaUltimoSegno: 30 * M }, POLL_LUNGA_MS],
		['nessun segno di vita registrato → si parte reattivi',
			{ visibile: true }, POLL_ATTIVO_MS]
	];
	for (const [nome, stato, atteso] of casi) {
		const avuto = pollDelay(stato);
		const ok = avuto === atteso;
		if (!ok) guasti.push(`${nome}: ${avuto} (atteso ${atteso})`);
		console.log(`${ok ? 'ok  ' : 'KO  '} ${nome} → ${avuto}`);
	}
	// Le soglie devono restare in un ordine sensato, o il "risparmio" è casuale.
	if (!(POLL_ATTIVO_MS < POLL_QUIETE_MS && POLL_QUIETE_MS < POLL_LUNGA_MS)) {
		guasti.push(`soglie non ordinate: ${POLL_ATTIVO_MS} / ${POLL_QUIETE_MS} / ${POLL_LUNGA_MS}`);
	}
	if (POLL_ATTIVO_MS !== 5_000) {
		guasti.push(`il ciclo attivo non è più 5 s (${POLL_ATTIVO_MS}): con un turno in ` +
			`corso la reattività non va sacrificata al risparmio`);
	}
}

if (typeof artifactDelay === 'function') {
	const casi = [
		['artefatto assente → si rallenta (erano 30 richieste/min di 404)',
			{ visibile: true, esiste: false }, 20_000],
		['artefatto presente → due secondi, si guarda cambiare',
			{ visibile: true, esiste: true }, 2_000],
		['scheda in background → niente', { visibile: false, esiste: true }, null]
	];
	for (const [nome, stato, atteso] of casi) {
		const avuto = artifactDelay(stato);
		const ok = avuto === atteso;
		if (!ok) guasti.push(`${nome}: ${avuto} (atteso ${atteso})`);
		console.log(`${ok ? 'ok  ' : 'KO  '} ${nome} → ${avuto}`);
	}
}

// --- e il codice deve USARLE, invece di tornare all'intervallo fisso --------
const PAGINA = 'src/routes/topics/[tier]/[name]/+page.svelte';
const src = leggiSorgente(PAGINA, guasti, 'polling del topic');
if (src !== null) {
	const codice = senzaCommenti(src);
	if (/setInterval\s*\(\s*refreshLive/.test(codice)) {
		guasti.push(`${PAGINA}: refreshLive è tornato su setInterval a intervallo fisso — ` +
			`un intervallo fisso non può cambiare passo né fermarsi in background`);
	}
	if (!/pollDelay\s*\(/.test(codice)) {
		guasti.push(`${PAGINA}: non chiama pollDelay: la cadenza non è adattiva`);
	}
	if (!/visibilitychange/.test(codice)) {
		guasti.push(`${PAGINA}: nessun listener su visibilitychange — una scheda in ` +
			`background continuerebbe a scaricare per nessuno`);
	}
	if (!/removeEventListener\(\s*['"]visibilitychange/.test(codice)) {
		guasti.push(`${PAGINA}: il listener visibilitychange non viene rimosso in onDestroy ` +
			`(si accumula a ogni cambio di topic)`);
	}
}

const CANVAS = 'src/lib/components/ArtifactCanvas.svelte';
const csrc = leggiSorgente(CANVAS, guasti, 'polling del canvas');
if (csrc !== null) {
	const codice = senzaCommenti(csrc);
	if (/setInterval\s*\(/.test(codice)) {
		guasti.push(`${CANVAS}: setInterval fisso — su un canale senza artefatto sono ` +
			`30 richieste al minuto che rispondono 404`);
	}
	if (!/artifactDelay\s*\(/.test(codice)) {
		guasti.push(`${CANVAS}: non chiama artifactDelay`);
	}
}

if (guasti.length) {
	console.error('polling adattivo:');
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log('polling adattivo: fermo in background, lento a stanza quieta, pieno sul turno ✓');
