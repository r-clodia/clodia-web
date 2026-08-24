#!/usr/bin/env node
/**
 * Un job fermo si VEDE dove si guarda lo stato di un job (clodia-platform#287).
 *
 * Il server calcola la freschezza in lettura e allega `stale`/`stale_reason` a
 * ogni riga di `GET /clodia/jobs`. Il 24 ago 2026 quel giudizio era corretto,
 * viaggiava nel payload e **non veniva letto da nessuno**: in `src/` la stringa
 * `stale` aveva zero occorrenze. Nel frattempo due job di backup ISO 27001
 * fermi da 68 e 355 ore si mostravano con `last_status: ok`, che è la stessa
 * affermazione falsa che la #273 doveva chiudere, spostata di un livello.
 *
 * Perché una guard e non un test: il difetto non è una riga sbagliata, è una
 * riga ASSENTE. Nessun compilatore si lamenta di un campo che nessuno legge, e
 * il codice senza la lettura è più corto e sembra pulito. L'unica difesa è
 * qualcosa che pretenda la presenza.
 *
 * Le due regole che questo file protegge:
 *
 *  1. il campo è dichiarato, normalizzato e LETTO in entrambe le pagine dei job;
 *  2. `stale` si affianca allo stato e non lo sostituisce — «l'ultimo esito è
 *     ok» e «l'ultimo esito è di tre giorni fa» sono entrambe vere, e chi
 *     mostrasse solo la seconda rifarebbe lo stesso errore al contrario.
 *
 * Nota di metodo, dalla web#181 e dalla check-typing-one-writer: un controllo
 * che cerca una PAROLA la trova anche nel commento che spiega la regola — e
 * questo file di commenti ne ha. Quindi si spogliano i commenti prima di
 * cercare, e si cerca la FORMA del costrutto. Misurato: con la lettura del
 * campo lasciata solo nel commento, questo script fallisce.
 */
import { readFileSync } from 'node:fs';

const TIPI = 'src/lib/api/types.ts';
const CLIENT = 'src/lib/api/client.ts';
const LISTA = 'src/routes/jobs/+page.svelte';
const DETTAGLIO = 'src/routes/jobs/[id]/+page.svelte';

const guasti = [];

const senzaCommenti = (s) =>
	s
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/(^|[^:])\/\/[^\n]*/g, '$1');

function leggi(p) {
	try {
		return senzaCommenti(readFileSync(p, 'utf8'));
	} catch {
		guasti.push(`${p}: file assente — spostato o rinominato`);
		return '';
	}
}

const tipi = leggi(TIPI);
const client = leggi(CLIENT);
const lista = leggi(LISTA);
const dettaglio = leggi(DETTAGLIO);

// 1. Il tipo dichiara i due campi: senza dichiarazione il compilatore non
//    protegge nessuna delle letture qui sotto.
if (tipi) {
	for (const campo of ['stale', 'stale_reason']) {
		if (!new RegExp(`readonly\\s+${campo}\\??\\s*:`).test(tipi)) {
			guasti.push(`${TIPI}: Job non dichiara più \`${campo}\``);
		}
	}
}

// 2. Il client li normalizza esplicitamente. Lo spread `{...r}` li porterebbe
//    comunque a runtime, ed è precisamente il motivo per cui la loro assenza
//    passerebbe inosservata: nessun errore, solo un campo che non c'è più.
if (client) {
	if (!/\bconst\s+stale\s*=/.test(client)) {
		guasti.push(
			`${CLIENT}: \`stale\` non è più normalizzato — affidarsi allo spread ` +
				`\`{...r}\` significa che il giorno in cui il server smette di mandarlo ` +
				`nessuno se ne accorge`
		);
	}
	if (!/typeof\s+r\.stale\s*===\s*'boolean'/.test(client)) {
		guasti.push(
			`${CLIENT}: \`stale\` non è più controllato come booleano: una stringa ` +
				`"false" dalla rete è truthy nel template`
		);
	}
	// Il campo normalizzato deve anche USCIRE dalla funzione.
	const ritorno = client.slice(client.search(/return\s*{\s*\.\.\.r,/));
	if (ritorno && !/\bstale\b/.test(ritorno.slice(0, 400))) {
		guasti.push(`${CLIENT}: \`stale\` è normalizzato ma non compare nell'oggetto restituito`);
	}
}

// 3. Entrambe le pagine leggono il campo e lo rendono.
for (const [pagina, src] of [
	[LISTA, lista],
	[DETTAGLIO, dettaglio]
]) {
	if (!src) continue;
	if (!/\bstale\b/.test(src)) {
		guasti.push(
			`${pagina}: non legge \`stale\` — un job fermo da giorni si presenta ` +
				`come il suo ultimo esito, che è il guasto della #287`
		);
		continue;
	}
	// Reso, non solo letto: serve il badge nel markup.
	if (!/class="stale-badge"/.test(src)) {
		guasti.push(
			`${pagina}: legge \`stale\` ma non lo mostra (manca \`stale-badge\` nel markup)`
		);
	}
	// Il confronto stretto, su OGNI occorrenza e non su almeno una.
	//
	// La prima versione di questo controllo chiedeva che nel file esistesse
	// «almeno un» `stale === true`, e un sabotaggio l'ha attraversata: in una
	// pagina con tre test stretti, allentarne UNO lasciava gli altri due a
	// soddisfare la condizione. Un guard che si accontenta di un esempio
	// corretto non protegge le altre occorrenze — misurato, non supposto.
	const testNonStretti = [...src.matchAll(/\{#if\s+([^}]*\bstale\b[^}]*)\}/g)]
		.map((m) => m[1].trim())
		.filter((cond) => !/===\s*true/.test(cond) && !/\bstaleOf\s*\(/.test(cond));
	for (const cond of testNonStretti) {
		guasti.push(
			`${pagina}: \`{#if ${cond}}\` testa la freschezza per verità javascript ` +
				`invece che con \`=== true\` (o attraverso staleOf): un \`stale: "false"\` ` +
				`dalla rete marcherebbe come fermo un job sano`
		);
	}
	// E almeno un modo stretto deve esserci: se non ne resta nessuno, la pagina
	// nomina il campo senza deciderne nulla.
	if (!/stale\s*===\s*true/.test(src) && !/\bstaleOf\s*\(/.test(src)) {
		guasti.push(
			`${pagina}: nomina \`stale\` ma non lo confronta mai in modo stretto ` +
				`(\`=== true\` o staleOf)`
		);
	}
	// Affiancato, non sostitutivo: lo StatusDot deve restare.
	if (!/<StatusDot/.test(src)) {
		guasti.push(
			`${pagina}: è sparito StatusDot — la freschezza si affianca allo stato, ` +
				`non lo sostituisce: sono due affermazioni diverse ed entrambe vere`
		);
	}
	// Il motivo va offerto: «fermo» da solo non distingue dieci minuti da due
	// settimane. Nel dettaglio per esteso, nella lista almeno come `title`.
	if (!/stale_reason/.test(src)) {
		guasti.push(
			`${pagina}: mostra «fermo» senza mai usare \`stale_reason\`: manca il ` +
				`«da quanto», che è l'unica parte azionabile`
		);
	}
}

// 4. Il colore. Un job fermo è un'assenza, non un fallimento: `--warn` come lo
//    stato `missed`, per la stessa ragione già fissata nella check-job-exit-states.
for (const [pagina, src] of [
	[LISTA, lista],
	[DETTAGLIO, dettaglio]
]) {
	if (!src) continue;
	const i = src.indexOf('.stale-badge');
	if (i < 0) continue;
	const fine = src.indexOf('}', i);
	const blocco = fine > i ? src.slice(i, fine + 1) : '';
	if (/--danger/.test(blocco)) {
		guasti.push(
			`${pagina}: \`.stale-badge\` usa \`--danger\`: un job che non gira non è ` +
				`un run fallito — il vocabolario del colore va tenuto separato (come \`missed\`)`
		);
	}
}

if (guasti.length) {
	console.error('freschezza dei job: un job fermo deve vedersi:');
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log('freschezza dei job: `stale` dichiarato, normalizzato, letto e mostrato ✓');
