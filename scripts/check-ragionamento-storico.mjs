#!/usr/bin/env node
/**
 * Il ragionamento di un turno concluso si riapre dalla sua bolla
 * (clodia-platform#484).
 *
 * Prima `thinking_chunk` era solo un evento SSE: chi non era connesso durante
 * il turno non aveva più niente da riaprire. Ora il server lo conserva e lo
 * lega al messaggio comparso nel canale; da qui in poi il modo di rompere la
 * cosa è muto e tutto client-side — mostrare il 💭 dove non c'è nulla da
 * mostrare, o non mostrarlo dove c'è.
 *
 * Tre controlli indipendenti:
 *   1. la funzione VERA (`src/lib/reasoning.js`) sui casi che contano;
 *   2. la pagina deve derivare da lì l'insieme delle bolle col bottone, e
 *      rileggere l'indice quando arrivano messaggi nuovi — altrimenti la
 *      bolla appena prodotta resta senza, che è il difetto di partenza visto
 *      da vicino;
 *   3. il client deve esporre ENTRAMBE le rotte: l'indice, piccolo e letto
 *      sempre, e il testo, grosso e letto su richiesta.
 *
 *     node scripts/check-ragionamento-storico.mjs
 */
import { leggiSorgente, senzaCommenti } from './lib/sorgente.mjs';

const guasti = [];

let bolleConRagionamento, indiceRagionamento, statoRagionamento, ragionamentoDaRichiedere, passiRagionamento;
try {
	({ bolleConRagionamento, indiceRagionamento, statoRagionamento, ragionamentoDaRichiedere, passiRagionamento } =
		await import('../src/lib/reasoning.js'));
} catch (e) {
	guasti.push(`src/lib/reasoning.js non si importa (${e && e.message})`);
}
if (typeof bolleConRagionamento !== 'function' || typeof indiceRagionamento !== 'function') {
	guasti.push(
		'src/lib/reasoning.js non esporta bolleConRagionamento/indiceRagionamento: senza, ' +
			'la regola del 💭 torna a essere una condizione sparsa nella pagina'
	);
}

if (typeof bolleConRagionamento === 'function') {
	const ai = (id) => ({ id, kind: 'ai' });
	/** @type {Array<[string, Array<any>, string[], string[]]>} */
	const casi = [
		['la bolla del turno ha il suo ragionamento salvato → bottone', [ai('m1')], ['m1'], ['m1']],
		[
			'NIENTE BOLLE FANTASMA: nessun ragionamento salvato per quel turno → nessun bottone',
			[ai('m1')],
			[],
			[]
		],
		[
			'un turno su due ha lasciato qualcosa: il bottone sta solo dove c’è',
			[ai('m1'), ai('m2'), ai('m3')],
			['m2'],
			['m2']
		],
		[
			'id nell’indice ma bolla fuori dalla finestra dei messaggi → niente, non c’è dove metterlo',
			[ai('m9')],
			['m1', 'm9'],
			['m9']
		],
		[
			'MAI sulla bolla di una persona: sarebbe un ragionamento attribuito a chi non lo ha fatto',
			[{ id: 'm1', kind: 'human' }],
			['m1'],
			[]
		],
		[
			'l’annuncio di un turno fallito è `system` e il suo ragionamento si apre: è il caso che serve di più',
			[{ id: 'm1', kind: 'system' }],
			['m1'],
			['m1']
		],
		['messaggio senza id → nessun bottone, mai una chiave vuota', [{ kind: 'ai' }], [''], []],
		['canale muto → niente', [], [], []]
	];

	for (const [nome, messaggi, indice, atteso] of casi) {
		const avuto = [...bolleConRagionamento(messaggi, indice)];
		const ok = JSON.stringify(avuto) === JSON.stringify(atteso);
		if (!ok) guasti.push(`${nome}: ${JSON.stringify(avuto)} (atteso ${JSON.stringify(atteso)})`);
		console.log(`${ok ? 'ok  ' : 'KO  '} ${nome} → ${JSON.stringify(avuto)}`);
	}

	// L'invariante, detta a voce alta: il bottone non può comparire su una
	// bolla che lo store non nomina. È la frase per cui questa guard esiste.
	const senzaIndice = bolleConRagionamento([ai('a'), ai('b'), ai('c')], []);
	if (senzaIndice.size !== 0) {
		guasti.push(
			`con l'indice vuoto compaiono ${senzaIndice.size} bottoni: ognuno aprirebbe il vuoto`
		);
	}
	// E un Set va bene quanto un array: la pagina tiene l'indice come Set.
	const daSet = [...bolleConRagionamento([ai('m1')], new Set(['m1']))];
	if (daSet.length !== 1) guasti.push('un Set come indice non viene letto');
}

if (typeof indiceRagionamento === 'function') {
	const risposte = [
		[{ messages: ['m1', 'm2'] }, 2],
		[{ messages: [] }, 0],
		[{}, 0],
		[null, 0],
		[{ messages: ['m1', null, 7, ''] }, 1]
	];
	for (const [payload, atteso] of risposte) {
		const n = indiceRagionamento(payload).length;
		if (n !== atteso) {
			guasti.push(`indiceRagionamento(${JSON.stringify(payload)}) → ${n} id (attesi ${atteso})`);
		}
	}
}

// 1c. Tool actions are part of the stored box (#484 reopened, 2 Oct 2026): the
// runtimes in use emit no thinking text, so a box that shows only `text` is
// empty for every real turn.
if (typeof passiRagionamento !== 'function') {
	guasti.push('src/lib/reasoning.js does not export passiRagionamento: stored tool actions would never show');
} else {
	const passi = passiRagionamento({
		text: '',
		tools: [{ tool: 'Bash', input_summary: 'ls' }, { tool: '' }, null, { tool: 'x', input_summary: 5 }]
	});
	const ok = JSON.stringify(passi) === JSON.stringify([
		{ tool: 'Bash', input_summary: 'ls' },
		{ tool: 'x', input_summary: '' }
	]);
	if (!ok) guasti.push(`passiRagionamento: ${JSON.stringify(passi)}`);
	if (passiRagionamento({ text: 'x' }).length !== 0) guasti.push('passiRagionamento without tools must be []');
	console.log(`${ok ? 'ok  ' : 'KO  '} stored tool actions are read`);
}
{
	const pag = senzaCommenti(leggiSorgente('src/routes/topics/[tier]/[name]/+page.svelte'));
	if (!/passiRagionamento\(v\)/.test(pag)) guasti.push('the page does not keep the stored tool actions');
	if (!/think-steps[\s\S]*etichettaTool\(t\.tool, t\.input_summary\)/.test(pag)) {
		guasti.push('the stored box does not render tool actions with etichettaTool, as the live box does');
	}
	if (/<pre>\{rag\.text\}<\/pre>/.test(pag) && !/\{#if rag\.text\}\s*<pre>\{rag\.text\}<\/pre>/.test(pag)) {
		guasti.push('an empty <pre> is rendered when the turn has no thinking text');
	}
}

// 1b. A failed fetch is an ERROR state with a retry, not an endless
// "loading…" (review of clodia-web#239): `null` alone used to mean both
// "in flight" and "failed", so a failure never showed and was never retried.
if (typeof statoRagionamento !== 'function' || typeof ragionamentoDaRichiedere !== 'function') {
	guasti.push(
		'src/lib/reasoning.js does not export statoRagionamento/ragionamentoDaRichiedere: ' +
			'a failed fetch would again look like a fetch in progress'
	);
} else {
	/** @type {Array<[string, unknown, string, boolean]>} */
	const stati = [
		['never requested → idle, fetch', undefined, 'idle', true],
		['in flight → loading, do NOT fetch twice', null, 'loading', false],
		['failed → error, fetch again (retry)', { error: 'HTTP 502' }, 'error', true],
		['failed with empty message → still error', { error: '' }, 'error', true],
		['loaded → ready, never fetch again', { text: 'ok', truncated: false }, 'ready', false],
		['loaded empty text → ready', { text: '', truncated: false }, 'ready', false],
		['garbage → error, so it can be retried', { foo: 1 }, 'error', true]
	];
	for (const [nome, entry, stato, fetch] of stati) {
		const s1 = statoRagionamento(entry);
		const f1 = ragionamentoDaRichiedere(entry);
		const ok = s1 === stato && f1 === fetch;
		if (!ok) guasti.push(`${nome}: state ${s1}, fetch ${f1} (expected ${stato}, ${fetch})`);
		console.log(`${ok ? 'ok  ' : 'KO  '} ${nome} → ${s1}/${f1}`);
	}
}

// 2. La pagina usa il modulo e tiene l'indice aggiornato.
const PAGINA = 'src/routes/topics/[tier]/[name]/+page.svelte';
const pag = leggiSorgente(PAGINA, guasti, 'ragionamento storico in chat');
if (pag !== null) {
	const codice = senzaCommenti(pag);
	if (!/bolleConRagionamento\s*\(/.test(codice)) {
		guasti.push(
			`${PAGINA}: l'insieme delle bolle col 💭 non passa da bolleConRagionamento(): ` +
				`una condizione scritta sul posto torna a indovinare chi ha ragionato`
		);
	}
	if (!/getChannelReasoningIndex\s*\(/.test(codice)) {
		guasti.push(
			`${PAGINA}: l'indice non viene mai letto — senza, nessuna bolla avrebbe il bottone`
		);
	}
	if (!/getChannelReasoning\s*\(/.test(codice)) {
		guasti.push(`${PAGINA}: il testo del ragionamento non viene mai richiesto`);
	}
	// The box must tell a failure from a fetch in progress, and offer a retry.
	if (!/statoRagionamento\s*\(/.test(codice)) {
		guasti.push(
			`${PAGINA}: the reasoning box does not derive its state from statoRagionamento(): ` +
				`a failed fetch would read "loading…" forever`
		);
	}
	if (/ragCaricato\[[^\]]+\]\s*==\s*null/.test(codice)) {
		guasti.push(
			`${PAGINA}: \`ragCaricato[id] == null\` is used as "loading": it also matches a ` +
				`missing entry and hides failures`
		);
	}
	if (!/ragionamentoDaRichiedere\s*\(/.test(codice)) {
		guasti.push(
			`${PAGINA}: the fetch is not gated by ragionamentoDaRichiedere(): a failed fetch ` +
				`would never be asked again`
		);
	}
	const errBlock = codice.match(/ragStato === 'error'[\s\S]{0,800}?\{:else/);
	if (!errBlock || !/on:click=\{\(\) => caricaRagionamento\(/.test(errBlock[0])) {
		guasti.push(`${PAGINA}: the error state of the reasoning box has no retry button`);
	}
	// Il refresh dell'indice deve stare dove arrivano i messaggi nuovi: il
	// turno appena finito è proprio quello che si vuole riaprire.
	const refresh = codice.match(/async function refreshMessages[\s\S]{0,4000}?\n\t\}/);
	if (!refresh) {
		guasti.push(`${PAGINA}: non trovo refreshMessages — se è stata rinominata, riscrivi questa guard`);
	} else if (!/aggiornaIndiceRagionamento\s*\(/.test(refresh[0])) {
		guasti.push(
			`${PAGINA}: l'indice non si rilegge quando arrivano messaggi nuovi: la bolla del ` +
				`turno appena concluso resterebbe senza 💭 fino a un ricaricamento della pagina`
		);
	}
}

// 3. Il client espone le due rotte.
const CLIENT = 'src/lib/api/client.ts';
const cli = leggiSorgente(CLIENT, guasti, 'rotte del ragionamento');
if (cli !== null) {
	const codice = senzaCommenti(cli);
	for (const [nome, atteso] of [
		['getChannelReasoningIndex', '/reasoning`'],
		['getChannelReasoning', '/reasoning/${encodeURIComponent(messageId)}`']
	]) {
		if (!codice.includes(`export async function ${nome}`)) {
			guasti.push(`${CLIENT}: manca ${nome}`);
		} else if (!codice.includes(atteso)) {
			guasti.push(`${CLIENT}: ${nome} non chiama la rotta attesa (${atteso})`);
		}
	}
}

if (guasti.length) {
	console.error('ragionamento storico:');
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log('ragionamento storico: il 💭 compare solo dove lo store ne ha uno ✓');
