#!/usr/bin/env node
/**
 * La cintura che spegne le bolle orfane deve confrontare per SEED, non a stringa.
 *
 * `active_responders` è per contratto una lista di SEED (`avvocato`); le chiavi
 * della mappa live sono SPAWN (`avvocato-42`, da `spawn_label`). Finché la
 * cintura filtrava con `!workingResponders.includes(chiave)`, ogni bolla di un
 * turno VIVO risultava orfana a ogni poll: alla seconda assenza consecutiva
 * veniva cancellata, e il delta successivo la ricreava. Con il poll a 5 s la
 * risposta spariva ogni ~10 s per poi ricominciare — il box che «cresce, sparisce
 * e ricomincia» segnalato da Davide il 2 set 2026.
 *
 * È lo stesso mismatch di vocabolari della #294, sull'altro lato della pagina:
 * là nella sottrazione (`resolveLiveKey`), qui nella cintura. La #294 non lo
 * chiudeva perché la cintura non passa da `resetLiveReply`.
 *
 * Perché una guard e non un commento: la regressione è MUTA. Compila, passa i
 * tipi (spawn e seed sono entrambi `string`), non logga niente — cancella solo
 * del testo che nessuno ristreamerà, e si vede unicamente guardando dal vivo un
 * turno lungo di un agente con uno spawn materializzato.
 *
 * Esegue la funzione VERA (`src/lib/liveReply.js`), non una copia.
 *
 *     node scripts/check-live-belt-seed-vs-spawn.mjs
 */
import { leggiSorgente, senzaCommenti } from './lib/sorgente.mjs';

const guasti = [];

let idleLiveKeys;
try {
	({ idleLiveKeys } = await import('../src/lib/liveReply.js'));
} catch (e) {
	guasti.push(`src/lib/liveReply.js non si importa (${e && e.message})`);
}
if (typeof idleLiveKeys !== 'function') {
	guasti.push(
		"src/lib/liveReply.js non esporta idleLiveKeys: senza il confronto per seed la " +
			'cintura dichiara orfana ogni bolla di un turno vivo'
	);
}

// Stessa regola di `seedName` (taglia `-N` solo per i seed noti) su un registro
// finto: qui si controlla il CONFRONTO, non il taglio del nome.
const SEEDS = new Set(['avvocato', 'fullstack-dev', 'clodia']);
const seedOf = (n) => {
	const m = String(n || '').match(/^(.+)-\d+$/);
	return m && SEEDS.has(m[1]) ? m[1] : String(n || '');
};

if (typeof idleLiveKeys === 'function') {
	/** @type {Array<[string, string[], string[], string[]]>} */
	const casi = [
		[
			'IL CASO SEGNALATO: bolla sullo spawn, active_responders col seed → NON è orfana',
			['avvocato-42'],
			['avvocato'],
			[]
		],
		[
			'turno finito davvero: nessun responder attivo → la bolla è orfana',
			['avvocato-42'],
			[],
			['avvocato-42']
		],
		[
			'un altro seed sta lavorando: la bolla di questo è orfana',
			['avvocato-42'],
			['clodia'],
			['avvocato-42']
		],
		[
			'stesso vocabolario (spawn_label non ancora arrivato) → riconosciuto',
			['avvocato'],
			['avvocato'],
			[]
		],
		[
			'backend che manda lo SPAWN invece del seed → riconosciuto comunque',
			['avvocato-42'],
			['avvocato-42'],
			[]
		],
		[
			'multi_spawn: il seed è grossolano di proposito, entrambe restano',
			['fullstack-dev-71', 'fullstack-dev-72'],
			['fullstack-dev'],
			[]
		],
		[
			'più bolle, un solo seed al lavoro → orfana solo l’altra',
			['avvocato-42', 'clodia-81'],
			['avvocato'],
			['clodia-81']
		],
		['nessuna bolla → niente da spegnere', [], ['avvocato'], []]
	];

	for (const [nome, chiavi, attivi, atteso] of casi) {
		const avuto = idleLiveKeys(chiavi, attivi, seedOf);
		const ok = JSON.stringify(avuto) === JSON.stringify(atteso);
		if (!ok) guasti.push(`${nome}: orfane ${JSON.stringify(avuto)} (attese ${JSON.stringify(atteso)})`);
		console.log(`${ok ? 'ok  ' : 'KO  '} ${nome} → ${JSON.stringify(avuto)}`);
	}
}

// E la pagina deve USARE il confronto per seed dentro la cintura. La funzione
// giusta importata e non chiamata è esattamente il difetto di partenza.
const FILE = 'src/routes/topics/[tier]/[name]/+page.svelte';
const src = leggiSorgente(FILE, guasti, 'cintura di fine turno');
if (src !== null) {
	const codice = senzaCommenti(src);
	const corpo = codice.match(/async function refreshInfo\s*\([^)]*\)\s*\{[\s\S]*?\n\t\}/);
	if (!corpo) {
		guasti.push(`${FILE}: non trovo refreshInfo — se è stata riscritta, riscrivi anche questa guard`);
	} else {
		if (!/idleLiveKeys\s*\(/.test(corpo[0])) {
			guasti.push(
				`${FILE}: la cintura in refreshInfo non usa idleLiveKeys: confrontare chiavi ` +
					`SPAWN con active_responders (SEED) cancella le bolle dei turni vivi`
			);
		}
		if (/workingResponders\s*\.\s*includes\s*\(/.test(corpo[0])) {
			guasti.push(
				`${FILE}: la cintura confronta ancora a stringa con workingResponders.includes(): ` +
					`seed e spawn sono vocabolari diversi, il confronto fallisce muto`
			);
		}
	}
}

if (guasti.length) {
	console.error('cintura di fine turno (seed vs spawn):');
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log('cintura di fine turno: confronto per seed, le bolle vive sopravvivono ✓');
