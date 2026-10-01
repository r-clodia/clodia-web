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

let bolleConRagionamento, indiceRagionamento;
try {
	({ bolleConRagionamento, indiceRagionamento } = await import('../src/lib/reasoning.js'));
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
