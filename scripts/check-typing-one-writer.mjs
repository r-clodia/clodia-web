#!/usr/bin/env node
/**
 * Un solo scrittore si conta UNA volta, anche se due sorgenti lo chiamano
 * diversamente (clodia-platform#260).
 *
 * L'indicatore «sta scrivendo…» unisce due flussi che parlano due vocabolari:
 *
 *  - gli eventi SSE `channel_typing` portano il nome dello SPAWN
 *    (`fullstack-dev-71`): il turno parte con `label = _spawn_label(...)`;
 *  - `active_responders`, dal polling del canale, è per contratto DICHIARATO
 *    una lista di SEED (`fullstack-dev`) — sta scritto nel backend, accanto al
 *    campo, come contratto invariato per la UI esistente.
 *
 * Unirli con un `Set` deduplica per stringa, non per identità: le due voci non
 * collidono, un unico scrittore viene contato due volte e la frase passa al
 * plurale. Il difetto è invisibile sugli agenti a spawn singolo, dove
 * `_spawn_label` ripiega sul seed e le due stringhe coincidono — cioè si vede
 * solo dove c'è concorrenza vera, che è dove l'indicatore serve.
 *
 * Perché un controllo e non solo un test: l'unione è UNA riga reattiva, il tipo
 * è `string[]` in entrambi i rami e nessun compilatore ha nulla da ridire. La
 * versione sbagliata è più corta e sembra più pulita di quella giusta.
 *
 * Nota di metodo, dalla web#181: un guard che cerca una PAROLA la trova anche
 * nel commento che spiega la regola — e questo file un commento ce l'ha, proprio
 * sopra il codice controllato. Quindi si spogliano i commenti PRIMA di cercare,
 * e si cerca la FORMA del costrutto, non il vocabolo. Misurato: con `seedName`
 * lasciato solo nel commento e il filtro rimosso, questo script fallisce.
 */
import { readFileSync } from 'node:fs';

const PAGINA = 'src/routes/topics/[tier]/[name]/+page.svelte';
const guasti = [];

const senzaCommenti = (s) =>
	s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

let pagina = '';
try {
	pagina = readFileSync(PAGINA, 'utf8');
} catch {
	guasti.push(`${PAGINA}: file assente — spostato o rinominato`);
}

if (pagina) {
	const nudo = senzaCommenti(pagina);

	// L'unione vive in `activeWorking`. Se sparisce il nome, questo controllo non
	// sa più cosa guardare e lo DEVE dire: un guard che non trova il suo bersaglio
	// e tace è un guard verde su codice mai letto.
	// L'espressione si estrae bilanciando le parentesi, non con un `[\s\S]*?;`:
	// la forma giusta è multiriga e contiene punti e virgola INTERNI, quindi il
	// non-greedy si fermava alla prima riga e il controllo giudicava mezza
	// espressione — verde o rosso a caso, secondo dove cadeva il taglio. Misurato
	// sul file corretto: segnalava `workingResponders` mancante mentre c'era.
	const espressione = (src) => {
		const i = src.search(/\$:\s*activeWorking\s*=/);
		if (i < 0) return null;
		let prof = 0;
		for (let k = src.indexOf('=', i) + 1; k < src.length; k++) {
			const c = src[k];
			if ('([{'.includes(c)) prof++;
			else if (')]}'.includes(c)) prof--;
			else if (c === ';' && prof === 0) return src.slice(i, k + 1);
		}
		return null;
	};

	const espr = espressione(nudo);
	if (!espr) {
		guasti.push(
			`${PAGINA}: non trovo l'assegnazione reattiva di activeWorking — se è ` +
				`stata riscritta o rinominata, riscrivi anche questo controllo`
		);
	} else {
		const corpo = espr;
		// Le due liste devono entrambe entrare nel calcolo: se una sparisce,
		// l'indicatore perde o il caso live o il re-mount a metà turno.
		for (const fonte of ['typing', 'workingResponders']) {
			if (!new RegExp(`\\b${fonte}\\b`).test(corpo)) {
				guasti.push(`${PAGINA}: activeWorking non considera più \`${fonte}\``);
			}
		}
		// Il taglio alla cieca è la scorciatoia che sembra giusta: `fullstack-dev-71`
		// → `fullstack-dev` funziona, finché non esistono insieme un seed `worker` e
		// un seed `worker-2`. Quel caso lo sa distinguere solo seedName, che consulta
		// i seed noti (stessa ragione di `_is_known_seed` nel backend). Va prima
		// dell'altro controllo, altrimenti un taglio a mano viene riportato come
		// «manca seedName» — vero, ma non è la cosa che chi legge deve sapere.
		if (/\.replace\(\s*\/[^/]*-\\d\+\$/.test(corpo)) {
			guasti.push(
				`${PAGINA}: il seed viene ricavato tagliando \`-N\` a mano invece di ` +
					`chiedere a seedName: con un seed \`worker\` e un seed \`worker-2\` ` +
					`il taglio fonde due agenti distinti`
			);
		}
		// Il cuore: i due vocabolari vanno riconciliati prima di unire. `seedName`
		// è l'UNICO modo sicuro di farlo — taglia `-N` solo per i seed noti.
		// Si cerca il NOME, non la chiamata: `typing.map(seedName)` la passa per
		// riferimento, senza parentesi, ed è una forma legittima — pretendere
		// `seedName(` bocciava codice corretto.
		else if (!/\bseedName\b/.test(corpo)) {
			guasti.push(
				`${PAGINA}: activeWorking unisce typing (nomi di SPAWN) e ` +
					`workingResponders (nomi di SEED) senza riconciliarli con seedName(): ` +
					`un solo scrittore comparirebbe due volte, al plurale`
			);
		}
		// Riconciliare significa TOGLIERE il doppione, non solo chiamare la
		// funzione: senza un filtro il seed resta nell'unione accanto al suo spawn.
		if (!/\.filter\s*\(/.test(corpo)) {
			guasti.push(
				`${PAGINA}: activeWorking non filtra i seed già coperti da uno spawn ` +
					`in typing: chiamare seedName senza scartare nulla non toglie il doppione`
			);
		}
	}

}

if (guasti.length) {
	console.error('«sta scrivendo…»: un solo scrittore, contato una volta sola:');
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log('«sta scrivendo…»: spawn e seed riconciliati, nessun doppione ✓');
