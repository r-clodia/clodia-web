#!/usr/bin/env node
/**
 * Ogni guard in `scripts/` è eseguita da `npm run check`.
 *
 * Motivo (issue clodia-platform#263): in questo repo le guard sono l'unica
 * suite che esista, e l'unica cosa che le esegue è la stringa `scripts.check`
 * del `package.json`. Una guard scritta, committata e mai aggiunta a quella
 * stringa non protegge niente e nessuno se ne accorge: non fallisce, non gira.
 * Misurato il 23 ago 2026 su `main`: 18 file `check-*.mjs`, 17 nella stringa.
 * L'orfana era `check-artifact-fit.mjs`, ferma dal 19 ago (commit bcdd0e9).
 *
 * Il controllo va nei due versi, perché i modi di sganciare una guard sono due:
 *   - guard sul disco e non nella stringa  → esiste e non viene eseguita;
 *   - guard nella stringa e non sul disco  → `npm run check` si spacca (ENOENT)
 *     e il rumore porta a togliere la riga invece di rimettere il file.
 *
 * Perché non è tautologico (la trappola di clodia-web#178 e #181): non cerca
 * una parola dentro il proprio testo. Confronta due fonti indipendenti — la
 * directory `scripts/` letta dal filesystem e la stringa `check` letta dal
 * `package.json` — e nessuna delle due è questo file.
 *
 * LIMITE DICHIARATO: vede le guard che seguono la convenzione di nome
 * `check-*.mjs` invocate come `node scripts/<nome>`. Una guard chiamata
 * diversamente, o eseguita da un altro script npm, resta fuori dal suo campo.
 */
import { readFileSync, readdirSync } from 'node:fs';

const PKG = 'package.json';

/** Le due fonti, lette separatamente: il disco e il comando. */
let comando;
try {
	comando = JSON.parse(readFileSync(PKG, 'utf8')).scripts?.check;
} catch {
	console.error(`guard agganciate: ${PKG} illeggibile o non è JSON`);
	process.exit(1);
}
if (!comando) {
	// Senza `npm run check` non esiste il posto in cui una guard è agganciata:
	// è il guasto peggiore, non l'assenza del guasto.
	console.error(`guard agganciate: ${PKG} non ha più lo script «check»`);
	process.exit(1);
}

const sulDisco = readdirSync('scripts')
	.filter((f) => f.startsWith('check-') && f.endsWith('.mjs'))
	.sort();
const citate = [...comando.matchAll(/scripts\/([\w.-]+\.mjs)/g)].map((m) => m[1]);

const guasti = [];
for (const f of sulDisco) {
	if (!citate.includes(f)) guasti.push(`«${f}» è sul disco e non in «npm run check»: nessuno la esegue`);
}
for (const f of new Set(citate)) {
	if (!sulDisco.includes(f)) guasti.push(`«${f}» è in «npm run check» e non sul disco: il comando si spacca`);
}

// Agganciata non basta: una guard può essere verde perché non ha guardato
// niente. Sette di queste passavano su un file di zero byte, perché il `catch`
// copriva il file assente e il `if (src) { …controlli… }` che seguiva saltava
// tutto in silenzio (clodia-platform#290). Il rimedio è `leggiSorgente`, che
// tratta vuoto e assente come lo stesso esito negativo; questo controllo esiste
// perché la forma difettosa non rientri dal prossimo guard scritto copiandone
// uno vecchio — che è esattamente come si era propagata.
//
// Si cerca la FORMA, non il vocabolo: un `readFileSync` dentro un `try` seguito
// da un cancello `if (<variabile>)` sulla variabile che ha letto. Un guard che
// legge con `leggiSorgente` è a posto per costruzione e non viene esaminato.
for (const f of sulDisco) {
	let src = '';
	try {
		src = readFileSync(`scripts/${f}`, 'utf8');
	} catch {
		guasti.push(`«${f}» è nell'elenco ma non si legge`);
		continue;
	}
	if (!/\breadFileSync\s*\(/.test(src)) continue; // non legge file: niente da dire
	if (/\bleggiSorgente\s*\(/.test(src)) continue; // usa l'helper: a posto
	// Le variabili assegnate da un readFileSync dentro un try, o da una
	// funzione locale `leggi(...)` che lo incapsula.
	const lette = new Set([
		...[...src.matchAll(/(?:const|let)\s+(\w+)\s*=\s*readFileSync\s*\(/g)].map((m) => m[1]),
		...[...src.matchAll(/(\w+)\s*=\s*readFileSync\s*\(/g)].map((m) => m[1]),
		...[...src.matchAll(/(?:const|let)\s+(\w+)\s*=\s*leggi\s*\(/g)].map((m) => m[1])
	]);
	for (const v of lette) {
		// Il cancello difettoso: `if (v) {` o `if (v !== null)` va bene solo se
		// il vuoto è già stato dichiarato un guasto da qualche parte nel file.
		const cancelloDebole = new RegExp(`if\\s*\\(\\s*${v}\\s*\\)\\s*\\{`).test(src);
		const guardaIlVuoto =
			/\.trim\(\)\s*===\s*''/.test(src) || /VUOTO/.test(src) || /length\s*===\s*0/.test(src);
		if (cancelloDebole && !guardaIlVuoto) {
			guasti.push(
				`«${f}»: \`if (${v})\` salta i controlli quando il file è VUOTO — ` +
					`una stringa di zero byte è falsy, quindi la guard esce verde senza ` +
					`aver guardato niente. Usa \`leggiSorgente\` da scripts/lib/sorgente.mjs`
			);
		}
	}
}

if (guasti.length) {
	console.error('guard agganciate:');
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log(`guard agganciate: ${sulDisco.length} file check-*.mjs, ${sulDisco.length} eseguite da npm run check ✓`);
