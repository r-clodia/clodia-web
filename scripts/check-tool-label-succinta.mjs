#!/usr/bin/env node
/**
 * La riga di un tool nel box di ragionamento deve essere un ESTRATTO leggibile,
 * e il payload intero deve restare all'hover (clodia-platform#453).
 *
 * La regressione qui è silenziosa in due modi opposti: si può tornare a
 * stampare il payload grezzo (nessun errore, solo una riga illeggibile), oppure
 * si può accorciare la riga *senza* conservare la versione estesa — e allora
 * l'informazione è persa davvero, non nascosta. Da qui una guard, con tre
 * controlli indipendenti:
 *   1. la funzione VERA (`src/lib/toolLabel.js`) eseguita sui casi che contano,
 *      compreso l'esempio testuale della issue;
 *   2. la pagina deve DERIVARE l'etichetta da lì, invece di comporre a mano la
 *      stringa dell'evento;
 *   3. il componente deve mettere la forma ESTESA nel `title` e la BREVE nel
 *      testo: invertirle è il modo più facile di «chiudere» la issue perdendola.
 *
 *     node scripts/check-tool-label-succinta.mjs
 */
import { leggiSorgente, senzaCommenti } from './lib/sorgente.mjs';

const guasti = [];

let etichettaTool;
try {
	({ etichettaTool } = await import('../src/lib/toolLabel.js'));
} catch (e) {
	guasti.push(`src/lib/toolLabel.js non si importa (${e && e.message})`);
}
if (typeof etichettaTool !== 'function') {
	guasti.push(
		'src/lib/toolLabel.js non esporta etichettaTool: senza, la riga del box torna ' +
			'a essere il payload grezzo dell’evento SSE'
	);
}

if (typeof etichettaTool === 'function') {
	// [nome del caso, tool, input_summary, riga breve attesa]
	const casi = [
		[
			'L’ESEMPIO DELLA ISSUE: prefissi via, due argomenti posizionali, ellissi',
			'mcp__clodia-tools__gdrive_list',
			'{"folder_id": "1fILEzsZFi9rdcuRb9c4ywDMDiCAqCMC5", "limit": 50}',
			'gdrive_list "1fILEzsZFi9rdcuRb9c4ywDMDiCAqCMC5", 50, …'
		],
		[
			'tre argomenti: si fermano a due, il terzo sta nel tooltip',
			'mcp__clodia-tools__topic_files',
			'{"tier": "SEAL-1", "name": "software-house", "path": "local"}',
			'topic_files "SEAL-1", "software-house", …'
		],
		[
			'JSON TAGLIATO dal backend a 120 caratteri: i primi due valori si leggono lo stesso',
			'mcp__clodia-tools__topic_post_message',
			'{"tier": "SEAL-1", "name": "software-house", "text": "ciao a tutti, questo messaggio è stato tagliato a met',
			'topic_post_message "SEAL-1", "software-house", …'
		],
		[
			'repr Python (sessioni codex/opencode): apici singoli, stessa resa',
			'mcp__clodia-tools__gdrive_list',
			"{'folder_id': 'abc123', 'limit': 50}",
			'gdrive_list "abc123", 50, …'
		],
		[
			'riassunto NON strutturato (il backend manda il solo `command`): si mostra intero',
			'Bash',
			'npm run check',
			'Bash "npm run check"'
		],
		['nessun argomento: solo il nome', 'Task', '', 'Task'],
		['payload vuoto: solo il nome', 'mcp__clodia-tools__runtime_agents', '{}', 'runtime_agents'],
		[
			'valori annidati: non si srotolano, la riga resta una riga',
			'mcp__x__scrivi',
			'{"dove": {"tier": "SEAL-1"}, "cosa": [1, 2, 3], "altro": 9}',
			'scrivi {…}, […], …'
		]
	];

	for (const [nome, tool, summary, atteso] of casi) {
		const { breve } = etichettaTool(tool, summary);
		const ok = breve === atteso;
		if (!ok) guasti.push(`${nome}: "${breve}" (atteso "${atteso}")`);
		console.log(`${ok ? 'ok  ' : 'KO  '} ${nome} → ${breve}`);
	}

	// L'invariante, detta a voce alta: accorciare NON è buttare. Qualunque sia il
	// payload, la forma estesa deve contenere per intero il riassunto che il
	// backend ha mandato — è ciò che finisce nel tooltip, ed è la sola copia
	// rimasta.
	for (const [, tool, summary] of casi) {
		if (!summary) continue;
		const { breve, esteso } = etichettaTool(tool, summary);
		if (!esteso.includes(summary)) {
			guasti.push(
				`la forma estesa di ${tool} non contiene il riassunto originale: ` +
					'accorciando si è perso il payload invece di nasconderlo'
			);
		}
		if (breve.length >= esteso.length && summary.length > 24) {
			guasti.push(`la forma breve di ${tool} non è più breve di quella estesa ("${breve}")`);
		}
	}
}

// La pagina deve usare il modulo: comporre a mano `${tool}: ${input_summary}` è
// esattamente il difetto di partenza.
const PAGINA = 'src/routes/topics/[tier]/[name]/+page.svelte';
const srcPagina = leggiSorgente(PAGINA, guasti, 'etichette dei tool nel box');
if (srcPagina !== null) {
	const codice = senzaCommenti(srcPagina);
	if (!/etichettaTool\s*\(/.test(codice)) {
		guasti.push(
			`${PAGINA}: l'evento tool_use non passa da etichettaTool(): la riga del box ` +
				'torna a essere il payload grezzo'
		);
	}
	const ramo = codice.match(/ev\.type === 'tool_use'\)\s*\{([\s\S]{0,400}?)\}\s*else/);
	if (!ramo) {
		guasti.push(`${PAGINA}: non trovo il ramo tool_use — se è stato riscritto, riscrivi anche questa guard`);
	} else if (!/breve[\s\S]*esteso/.test(ramo[1])) {
		guasti.push(
			`${PAGINA}: il passo del tool non porta entrambe le forme {breve, esteso}: ` +
				'senza la estesa il tooltip non ha cosa mostrare'
		);
	}
}

// Il componente: breve nel testo, ESTESA nel title. Invertirle accorcia la riga
// e svuota il tooltip, cioè fa mezza issue e disfa l'altra metà.
const BOX = 'src/lib/components/AgentLiveBox.svelte';
const srcBox = leggiSorgente(BOX, guasti, 'etichette dei tool nel box');
if (srcBox !== null) {
	const codice = senzaCommenti(srcBox);
	const li = codice.match(/<li[^>]*>\{[^}]*\}<\/li>/);
	if (!li) {
		guasti.push(`${BOX}: non trovo la riga <li> dei passi — se è stata riscritta, riscrivi anche questa guard`);
	} else {
		if (!/title=\{t\.esteso\}/.test(li[0])) {
			guasti.push(`${BOX}: il title della riga non è t.esteso (${li[0]}): il payload intero non è più leggibile all'hover`);
		}
		if (!/>\{t\.breve\}</.test(li[0])) {
			guasti.push(`${BOX}: la riga non stampa t.breve (${li[0]}): il box torna a mostrare il payload intero`);
		}
	}
	if (!/tools\[tools\.length - 1\]\.breve/.test(codice)) {
		guasti.push(
			`${BOX}: l'anteprima del box chiuso non usa la forma breve: è la riga che si vede ` +
				'senza espandere, cioè quella che la #453 voleva rendere leggibile'
		);
	}
}

if (guasti.length) {
	console.error('etichette dei tool nel box di ragionamento:');
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log('etichette dei tool: riga succinta, payload intero nel tooltip ✓');
