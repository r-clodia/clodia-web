#!/usr/bin/env node
/**
 * Un messaggio persistito con autore=SEED deve trovare il box live dello SPAWN
 * (clodia-platform#294).
 *
 * La mappa del live è indicizzata per spawn (`fullstack-dev-71`, dall'evento
 * `spawn_label`); l'autore di un messaggio pubblicato via tool gateway è il
 * seed (`fullstack-dev`). Finché `resetLiveReply` cercava l'autore grezzo in
 * quella mappa, per quei messaggi non trovava nulla e non sottraeva nulla: il
 * buffer live restava col testo già persistito dentro, e ogni giro di poll
 * rimetteva in scena lo unmount/remount della bolla — il lampeggio di #250, che
 * la PR clodia-web#172 aveva chiuso solo per l'altra metà del difetto.
 *
 * Perché una guard e non un commento: la regressione è MUTA due volte. Non solo
 * compila e passa i tipi (le due chiavi sono entrambe `string`), ma il ramo
 * difettoso è un `return` anticipato — nessun errore, nessun log, solo una
 * sottrazione che non avviene. Si vede solo guardando una chat dal vivo di un
 * agente che posta via tool.
 *
 * Esegue la funzione VERA (`src/lib/liveReply.js`), non una copia.
 *
 *     node scripts/check-live-key-seed-vs-spawn.mjs
 */
import { leggiSorgente, senzaCommenti } from './lib/sorgente.mjs';

const guasti = [];

let resolveLiveKey;
try {
	({ resolveLiveKey } = await import('../src/lib/liveReply.js'));
} catch (e) {
	guasti.push(`src/lib/liveReply.js non si importa (${e && e.message})`);
}
if (typeof resolveLiveKey !== 'function') {
	guasti.push(
		"src/lib/liveReply.js non esporta resolveLiveKey: senza la traduzione seed→spawn " +
			'i messaggi postati via tool non svuotano mai la bolla live'
	);
}

// `seedName` vero taglia `-N` solo per i seed noti; qui basta la stessa regola
// su un registro finto, perché ciò che si sta controllando è la RISOLUZIONE,
// non il taglio del nome (che ha già i suoi controlli in $lib/agents).
const SEEDS = new Set(['fullstack-dev', 'clodia', 'sysadmin']);
const seedOf = (n) => {
	const m = String(n || '').match(/^(.+)-\d+$/);
	return m && SEEDS.has(m[1]) ? m[1] : String(n || '');
};
const box = (reply) => ({ think: '', reply, tools: [] });

if (typeof resolveLiveKey === 'function') {
	/** @type {Array<[string, Record<string, {reply: string}>, string, string[], string|null]>} */
	const casi = [
		[
			'IL CASO DELLA #294: autore=seed, box live indicizzato allo spawn',
			{ 'fullstack-dev-71': box('Ecco il piano.\n\nOra guardo il') },
			'fullstack-dev',
			['Ecco il piano.'],
			'fullstack-dev-71'
		],
		[
			'autore=spawn (stream diretto) → la chiave esatta vince, niente traduzione',
			{ 'fullstack-dev-71': box('Ecco il piano.') },
			'fullstack-dev-71',
			['Ecco il piano.'],
			'fullstack-dev-71'
		],
		[
			'seed nudo anche nella mappa (spawn_label non ancora arrivato) → sé stesso',
			{ 'fullstack-dev': box('Ecco il piano.') },
			'fullstack-dev',
			['Ecco il piano.'],
			'fullstack-dev'
		],
		[
			'un altro agente sta streammando: non è affar suo',
			{ 'clodia-81': box('Sto valutando') },
			'fullstack-dev',
			['Ecco il piano.'],
			null
		],
		[
			'multi_spawn: due spawn dello stesso seed → decide il TESTO, non il nome',
			{
				'fullstack-dev-71': box('Ecco il piano.\n\nOra guardo il'),
				'fullstack-dev-72': box('Sto clonando il repo')
			},
			'fullstack-dev',
			['Ecco il piano.'],
			'fullstack-dev-71'
		],
		[
			'multi_spawn senza testo che disambigui → nessuno, mai il buffer di un altro',
			{ 'fullstack-dev-71': box('Alfa'), 'fullstack-dev-72': box('Beta') },
			'fullstack-dev',
			['Gamma, da un post via tool'],
			null
		],
		['mappa live vuota → niente da aggiornare', {}, 'fullstack-dev', ['Ecco il piano.'], null]
	];

	for (const [nome, live, autore, persistiti, atteso] of casi) {
		const avuto = resolveLiveKey(live, autore, seedOf, persistiti);
		const ok = avuto === atteso;
		if (!ok) guasti.push(`${nome}: chiave ${JSON.stringify(avuto)} (attesa ${JSON.stringify(atteso)})`);
		console.log(`${ok ? 'ok  ' : 'KO  '} ${nome} → ${JSON.stringify(avuto)}`);
	}
}

// E la pagina deve USARE la traduzione. La funzione giusta importata e non
// chiamata è esattamente il difetto di partenza, con un import in più.
const FILE = 'src/routes/topics/[tier]/[name]/+page.svelte';
const src = leggiSorgente(FILE, guasti, 'reset del live per autore');
if (src !== null) {
	const codice = senzaCommenti(src);
	const corpo = codice.match(/function resetLiveReply\s*\([^)]*\)\s*\{[\s\S]*?\n\t\}/);
	if (!corpo) {
		guasti.push(`${FILE}: non trovo resetLiveReply — se è stata riscritta, riscrivi anche questa guard`);
	} else {
		if (!/resolveLiveKey\s*\(/.test(corpo[0])) {
			guasti.push(
				`${FILE}: resetLiveReply non risolve la chiave con resolveLiveKey: ` +
					`un autore=seed non troverà mai il box live indicizzato allo spawn (#294)`
			);
		}
		if (/liveAgents\[\s*agent\s*\]/.test(corpo[0])) {
			guasti.push(
				`${FILE}: resetLiveReply indicizza ancora liveAgents con l'autore grezzo: ` +
					`seed e spawn sono vocabolari diversi, il confronto per stringa fallisce muto`
			);
		}
	}
}

if (guasti.length) {
	console.error('chiave del live (seed vs spawn):');
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log('chiave del live: autore=seed → box dello spawn giusto ✓');
