#!/usr/bin/env node
/**
 * Nessun `<img src>` può puntare a un endpoint che richiede autenticazione.
 *
 * La webui autentica con l'header `Authorization: Bearer ckt1…`. Un `<img>` non
 * lo porta: il browser emette una richiesta anonima, il server risponde 401, e
 * l'immagine resta rotta **in silenzio** — la pagina non segnala nulla, si vede
 * solo che l'immagine non c'è, e sembra un problema di caricamento invece che di
 * identità.
 *
 * È già successo, col logo dei topic: il gateway leggeva i byte, la rotta
 * rispondeva 200, e la pagina mostrava il segnaposto. La catena era provata
 * ovunque tranne dove sta il browser.
 *
 * **Questo controllo risolve le variabili**, e non è un dettaglio: la prima
 * versione guardava solo il testo dentro `src={…}`, e il codice difettoso
 * scriveva `<img src={src}>` con l'URL costruito venti righe sopra. Passava
 * verde su esattamente il difetto che doveva trovare — cioè era peggio
 * dell'assenza di un controllo, perché chiudeva la questione.
 *
 * Limite dichiarato: risolve un livello di indirezione (un identificatore
 * assegnato nello stesso file). Un URL costruito da una funzione o passato come
 * prop non lo vede. Meglio dirlo che lasciar credere che copra tutto.
 *
 * Endpoint aperti per una ragione dichiarata — e quindi legittimi in un `<img>`:
 * - `/profile/logo`: il marchio di chi ospita, deve comparire sulla schermata di
 *   accesso, cioè prima che una sessione esista;
 * - `/api/agents/<n>/pfp`: gli avatar non stanno in un compartimento (misurato:
 *   200 senza header).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const RADICE = new URL('../src', import.meta.url).pathname;
const APERTI = [/\/profile\/logo/, /\/api\/agents\/[^`'"]*\/pfp/];

function sorgenti(dir) {
	const out = [];
	for (const e of readdirSync(dir)) {
		const p = join(dir, e);
		if (statSync(p).isDirectory()) out.push(...sorgenti(p));
		else if (/\.svelte$/.test(e)) out.push(p);
	}
	return out;
}

/** Valore assegnato a `nome` nel file, se è una stringa/template letterale. */
function assegnazioni(testo) {
	const m = new Map();
	// `let x = …`, `const x = …`, `$: x = …` — fino a fine riga logica.
	const re = /(?:\$:\s*|(?:let|const|var)\s+)([A-Za-z_$][\w$]*)\s*=\s*([^\n;]+)/g;
	for (const a of testo.matchAll(re)) {
		const [, nome, valore] = a;
		m.set(nome, (m.get(nome) ?? '') + ' ' + valore);
	}
	return m;
}

const colpe = [];
for (const f of sorgenti(RADICE)) {
	const testo = readFileSync(f, 'utf8');
	const asg = assegnazioni(testo);
	for (const m of testo.matchAll(/<img\b[^>]*\bsrc\s*=\s*(\{[^}]*\}|"[^"]*")/g)) {
		const grezzo = m[1];
		// Il valore da esaminare: quello scritto lì, più — se è un semplice
		// identificatore — ciò che gli viene assegnato altrove nel file.
		let valore = grezzo;
		const ident = grezzo.match(/^\{\s*([A-Za-z_$][\w$]*)\s*\}$/);
		if (ident && asg.has(ident[1])) valore += ' ' + asg.get(ident[1]);
		if (!/API_BASE_URL|\/api\//.test(valore)) continue;
		if (APERTI.some((r) => r.test(valore))) continue;
		const riga = testo.slice(0, m.index).split('\n').length;
		colpe.push(`${f.replace(RADICE, 'src')}:${riga}  ${grezzo.slice(0, 60)}`);
	}
}

if (colpe.length) {
	console.error(
		"Un <img src> punta a un endpoint autenticato: il browser non manda l'header,\n" +
			"la richiesta prende 401 e l'immagine resta rotta senza segnalare nulla.\n" +
			'Scaricala con fetch + authHeaders() e passa un blob: (vedi src/lib/topicLogo.ts).\n'
	);
	for (const c of colpe) console.error('  ' + c);
	process.exit(1);
}
console.log('nessun <img> verso endpoint autenticati ✓');
