#!/usr/bin/env node
/**
 * Uno stato che il backend produce e la UI non conosce si legge «unknown»
 * (clodia-platform#206).
 *
 * Dal 22 ago 2026 un run agentico ha quattro esiti terminali, e tre di essi non
 * sono sinonimi:
 *
 *     success   il lavoro è stato fatto
 *     error     è stato fatto, ma la QUALITÀ può esserne compromessa
 *     fatal     il turno è finito e il lavoro NON è stato fatto
 *     failed    il turno è morto
 *
 * `StatusDot` normalizza a `unknown` qualunque stringa fuori da `KNOWN`. È un
 * fallback giusto — non si rompe niente, il testo grezzo resta a schermo — ed è
 * per questo che il difetto sarebbe passato: nessun errore, nessun tipo rotto,
 * solo un pallino grigio con scritto «fatal» al posto di un allarme. La stessa
 * forma per cui era stata aperta la questione del `kind` ignoto in #248.
 *
 * Nota di metodo, dalla web#181: un guard che cerca una PAROLA la trova anche nel
 * commento che spiega la regola — e questo file, come il componente che
 * controlla, di commenti ne ha. Quindi si spogliano prima di cercare.
 */
import { readFileSync } from 'node:fs';

const DOT = 'src/lib/components/StatusDot.svelte';
const TYPES = 'src/lib/api/types.ts';

/** Gli stati terminali che il backend può scrivere in `runs[].stato`. */
const TERMINALI = ['success', 'error', 'fatal', 'failed'];

/**
 * `missed` sta a parte, e non per pedanteria: NON è un esito terminale. I quattro
 * sopra descrivono un run che è PARTITO — `complete_run` li accetta e solo quelli.
 * `missed` è il fire che non è mai avvenuto: nessuna durata, nessuna chat, nessun
 * agente che possa dichiararne l'esito (clodia-platform#273). Metterlo fra i
 * terminali qui sarebbe scrivere nel guard una categoria che il backend non ha, e
 * il prossimo lettore la crederebbe vera.
 *
 * Per la UI vale però la stessa regola dei terminali: se non è in `KNOWN` diventa
 * `unknown` e si legge come «boh» esattamente dove serve un allarme.
 */
const NON_TERMINALI_VISIBILI = ['missed'];

/** Tutti gli stati che devono essere RICONOSCIUTI e DISTINGUIBILI a schermo. */
const VISIBILI = [...TERMINALI, ...NON_TERMINALI_VISIBILI];

const senzaCommenti = (s) =>
	s
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const guasti = [];

const leggi = (f) => {
	try {
		return readFileSync(f, 'utf8');
	} catch {
		guasti.push(`${f}: file assente — spostato o rinominato`);
		return '';
	}
};

const dot = leggi(DOT);
if (dot !== null) {
	const nudo = senzaCommenti(dot);

	// L'elenco KNOWN è ciò che decide fra «pallino colorato» e «unknown».
	const known = nudo.match(/const KNOWN[^=]*=\s*\[[\s\S]*?\]/);
	if (!known) {
		guasti.push(`${DOT}: non trovo l'elenco KNOWN — se è stato riscritto, riscrivi anche questo controllo`);
	} else {
		for (const s of VISIBILI) {
			if (!known[0].includes(`'${s}'`)) {
				guasti.push(
					`${DOT}: '${s}' non è in KNOWN: un run con questo esito si mostrerebbe ` +
						`come «unknown», cioè come se non sapessimo com'è andata`
				);
			}
		}
	}

	// Un pallino senza una regola di colore resta grigio come `unknown`: sta in
	// KNOWN, quindi il guard sopra è verde, e a schermo non si distingue.
	for (const s of VISIBILI) {
		if (!new RegExp(`\\.pill\\.${s}\\b`).test(nudo)) {
			guasti.push(
				`${DOT}: manca la regola di stile .pill.${s}: lo stato è riconosciuto ` +
					`ma resta grigio, indistinguibile da «unknown» a colpo d'occhio`
			);
		}
	}

	// `fatal` è il caso in cui non c'è nulla da consegnare: deve allarmare come
	// `failed`, non essere un colore tenue in mezzo agli altri.
	//
	// Il colore si cerca DENTRO il blocco `.pill.fatal { … }`, estratto fino alla
	// sua graffa di chiusura. Con una finestra di caratteri il controllo abbracciava
	// anche `.pill.fatal .dot`, che ha un `--danger` suo: misurato sostituendo il
	// solo `color:` del pill con `--fg-muted`, questo script restava verde perché
	// leggeva il rosso della regola accanto. Un guard che trova la parola giusta
	// nel posto sbagliato è verde su codice che non ha guardato.
		// `missed` non deve prendere il rosso: un run mai partito e un run fallito sono
	// due cose diverse, e il colore è l'unica differenza che si vede scorrendo una
	// lista. Se qualcuno lo uniforma a `failed`, la distinzione muore a schermo
	// mentre il backend continua a farla.
	const bloccoMissed = nudo.match(/\.pill\.missed\s*\{[^}]*\}/);
	if (!bloccoMissed) {
		guasti.push(`${DOT}: non trovo il blocco .pill.missed`);
	} else if (/--danger/.test(bloccoMissed[0])) {
		guasti.push(
			`${DOT}: .pill.missed usa --danger: un fire mai avvenuto non è un ` +
				`fallimento, e a colpo d'occhio deve distinguersi da failed`
		);
	}

	const bloccoFatal = nudo.match(/\.pill\.fatal\s*\{[^}]*\}/);
	if (!bloccoFatal) {
		guasti.push(`${DOT}: non trovo il blocco .pill.fatal`);
	} else if (!/--danger/.test(bloccoFatal[0])) {
		guasti.push(
			`${DOT}: .pill.fatal non usa --danger: «il lavoro non è stato fatto» ` +
				`deve leggersi come un fallimento`
		);
	}
}

const types = leggi(TYPES);
if (types !== null) {
	const nudo = senzaCommenti(types);
	const jobStatus = nudo.match(/export type JobStatus\s*=[^;]*;/);
	if (!jobStatus) {
		guasti.push(`${TYPES}: non trovo il tipo JobStatus`);
	} else {
		for (const s of VISIBILI) {
			if (!jobStatus[0].includes(`'${s}'`)) {
				guasti.push(
					`${TYPES}: JobStatus non elenca '${s}': il tipo dice che quell'esito ` +
						`non esiste, mentre il backend lo scrive`
				);
			}
		}
	}
}

if (guasti.length) {
	console.error('esiti di un run: quattro stati, tutti leggibili:');
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log('esiti di un run: success/error/fatal/failed + missed riconosciuti e distinguibili ✓');
