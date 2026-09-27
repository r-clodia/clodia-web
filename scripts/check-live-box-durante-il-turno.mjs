#!/usr/bin/env node
/**
 * Il box di ragionamento deve restare visibile per TUTTO il turno
 * (clodia-platform#417).
 *
 * La regressione è muta: compila, passa i tipi, non logga niente. Si vede solo
 * guardando dal vivo un turno lungo — e «a volte», perché serve che i tre
 * buffer si trovino vuoti insieme nel momento in cui la pagina ricalcola. Da
 * qui una guard, e non un commento.
 *
 * Due controlli, indipendenti fra loro:
 *   1. la funzione VERA (`src/lib/liveBox.js`) eseguita sui casi che contano;
 *   2. la pagina deve DERIVARE da lì la lista dei box, invece di rifiltrare i
 *      buffer a mano — la funzione giusta importata e non usata è esattamente
 *      il difetto di partenza.
 *
 *     node scripts/check-live-box-durante-il-turno.mjs
 */
import { leggiSorgente, senzaCommenti } from './lib/sorgente.mjs';

const guasti = [];

let liveBoxEntries;
try {
	({ liveBoxEntries } = await import('../src/lib/liveBox.js'));
} catch (e) {
	guasti.push(`src/lib/liveBox.js non si importa (${e && e.message})`);
}
if (typeof liveBoxEntries !== 'function') {
	guasti.push(
		'src/lib/liveBox.js non esporta liveBoxEntries: senza, la visibilità del box ' +
			'torna a dipendere dai byte nei buffer e il box sparisce a metà turno'
	);
}

// Stessa regola di `seedName` (taglia `-N` solo per i seed noti) su un registro
// finto: qui si controlla la SELEZIONE dei box, non il taglio del nome.
const SEEDS = new Set(['avvocato', 'fullstack-dev', 'clodia']);
const seedOf = (n) => {
	const m = String(n || '').match(/^(.+)-\d+$/);
	return m && SEEDS.has(m[1]) ? m[1] : String(n || '');
};
const vuoto = () => ({ think: '', reply: '', tools: [] });
const con = (p) => ({ ...vuoto(), ...p });

if (typeof liveBoxEntries === 'function') {
	/** @type {Array<[string, Record<string, any>, string[], string[]]>} */
	const casi = [
		[
			'IL CASO SEGNALATO: blocco appena persistito, buffer svuotati, turno VIVO → il box resta',
			{ 'avvocato-42': vuoto() },
			['avvocato'],
			['avvocato-42']
		],
		[
			'ragionamento in corso: box presente, come prima',
			{ 'avvocato-42': con({ think: 'sto leggendo il contratto' }) },
			['avvocato'],
			['avvocato-42']
		],
		[
			'messaggio estraneo allo stream (post via tool) svuota la reply: il turno continua, il box resta',
			{ 'avvocato-42': vuoto() },
			['avvocato-42'],
			['avvocato-42']
		],
		[
			'stanza riaperta a metà turno: nessun delta ricevuto, il backend dichiara il turno → box comunque',
			{},
			['avvocato'],
			['avvocato']
		],
		[
			'turno finito e buffer vuoti → nessun box (il ghost non deve restare a schermo)',
			{ 'avvocato-42': vuoto() },
			[],
			[]
		],
		[
			'turno finito ma testo ancora da riconciliare → il box col contenuto resta finché la cintura non lo spegne',
			{ 'avvocato-42': con({ reply: 'coda non ancora persistita' }) },
			[],
			['avvocato-42']
		],
		[
			'un solo box per istanza: lo spawn copre il suo seed, niente doppione',
			{ 'avvocato-42': con({ think: 'ragiono' }) },
			['avvocato'],
			['avvocato-42']
		],
		[
			'multi_spawn: due istanze dello stesso seed al lavoro, due box, nessun terzo',
			{ 'fullstack-dev-71': con({ think: 'a' }), 'fullstack-dev-72': vuoto() },
			['fullstack-dev'],
			['fullstack-dev-71', 'fullstack-dev-72']
		],
		[
			'due agenti in parallelo, uno solo ha già streammato → due box',
			{ 'avvocato-42': con({ tools: ['🔧 topic.files'] }) },
			['avvocato', 'clodia'],
			['avvocato-42', 'clodia']
		],
		['niente di niente → nessun box', {}, [], []]
	];

	for (const [nome, live, attivi, atteso] of casi) {
		const chiavi = liveBoxEntries(live, attivi, seedOf).map(([k]) => k);
		const ok = JSON.stringify(chiavi) === JSON.stringify(atteso);
		if (!ok) guasti.push(`${nome}: box ${JSON.stringify(chiavi)} (attesi ${JSON.stringify(atteso)})`);
		console.log(`${ok ? 'ok  ' : 'KO  '} ${nome} → ${JSON.stringify(chiavi)}`);
	}

	// L'invariante, detta a voce alta: finché il backend dichiara il turno, il
	// numero di box NON dipende da quanti byte sono arrivati. È la frase che la
	// #417 chiede di rendere vera.
	const pieno = liveBoxEntries({ 'avvocato-42': con({ think: 'x' }) }, ['avvocato'], seedOf).length;
	const svuotato = liveBoxEntries({ 'avvocato-42': vuoto() }, ['avvocato'], seedOf).length;
	if (pieno !== svuotato) {
		guasti.push(
			'svuotare i buffer di un turno vivo cambia il numero di box ' +
				`(${pieno} → ${svuotato}): è lo smontaggio che si vede come «il box sparisce»`
		);
	}

	// E il box vuoto deve essere USABILE dal componente così com'è: `tools` è
	// iterato e misurato in AgentLiveBox, un `undefined` lì è una pagina bianca.
	const [, stato] = liveBoxEntries({}, ['clodia'], seedOf)[0] ?? [null, null];
	if (!stato || typeof stato.think !== 'string' || !Array.isArray(stato.tools)) {
		guasti.push('il box vuoto non ha la forma {think, reply, tools[]} che AgentLiveBox si aspetta');
	}
}

// La pagina deve usare il modulo, e la cintura deve restare l'unica a spegnere.
const FILE = 'src/routes/topics/[tier]/[name]/+page.svelte';
const src = leggiSorgente(FILE, guasti, 'box live del turno');
if (src !== null) {
	const codice = senzaCommenti(src);
	if (!/liveBoxEntries\s*\(/.test(codice)) {
		guasti.push(
			`${FILE}: liveEntries non passa da liveBoxEntries(): filtrare i buffer a mano ` +
				`smonta il box ogni volta che si svuotano, cioè a metà turno`
		);
	}
	const decl = codice.match(/\$:\s*liveEntries\s*=([^\n]*)/);
	if (!decl) {
		guasti.push(`${FILE}: non trovo la derivazione di liveEntries — se è stata riscritta, riscrivi anche questa guard`);
	} else if (/\.filter\s*\(/.test(decl[1])) {
		guasti.push(
			`${FILE}: liveEntries filtra ancora sul posto (${decl[1].trim()}): la selezione dei box ` +
				`vive in src/lib/liveBox.js, dove è eseguibile e ha i suoi casi`
		);
	}
	// Il turno dichiarato dal backend è la sorgente: senza, il modulo non può
	// sapere che l'agente sta lavorando.
	if (decl && !/workingResponders/.test(decl[1])) {
		guasti.push(
			`${FILE}: liveEntries non legge workingResponders: senza active_responders il box ` +
				`non sopravvive ai buchi fra i delta, che è tutto il difetto della #417`
		);
	}
	if (!/for \(const a of idleNow\) if \(_idleLastPoll\.includes\(a\)\) resetLive\(a\)/.test(codice)) {
		guasti.push(
			`${FILE}: la cintura delle due assenze consecutive non c'è più: se il box non si ` +
				`spegne da solo a fine turno, tenerlo acceso più a lungo diventa un ghost permanente`
		);
	}
}

if (guasti.length) {
	console.error('box live durante il turno:');
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log('box live: resta visibile per tutto il turno dichiarato dal backend ✓');
