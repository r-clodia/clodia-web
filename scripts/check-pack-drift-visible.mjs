#!/usr/bin/env node
/**
 * Il drift fra seed installato e pack si VEDE nella vista Packs
 * (issue clodia-platform#266, punto 4 della #211).
 *
 * Il difetto che la issue descrive è per costruzione invisibile: un campo
 * cancellato dal seed installato non lascia un commento, non produce un errore
 * di parse, e il file continua a caricare. L'unico modo di accorgersene era
 * confrontare a mano due file, uno dei quali sull'istanza non c'è nemmeno più.
 * Il backend ora risponde alla domanda (`POST /clodia/packs/{name}/drift`) — e
 * un dato che arriva nel payload e muore nel client è esattamente il guasto di
 * `check-stale-visible.mjs`: la pagina si costruisce, i tipi tornano, e a
 * schermo non compare niente.
 *
 * Per questo il controllo sta qui e non nella `svelte-check`: non c'è tipo che
 * si accorga di un campo mai letto.
 *
 * Si pretendono TRE parti, perché ognuna può sparire senza rompere le altre:
 *
 *   1. il modo di CHIEDERE — la pagina chiama `checkPackDrift`;
 *   2. il modo di SAPERLO  — l'esito (`drifted`) si legge e si mostra;
 *   3. il modo di CAPIRLO  — i campi divergenti arrivano a schermo. Un badge
 *      «3 seed divergono» che non dice QUALI campi rimanda a confrontare due
 *      file a mano, cioè al punto di partenza.
 *
 * E una quarta, che è la ragione per cui la issue esiste: `unavailable` va
 * trattato. Un pack senza riferimento non è un pack pulito, e mostrarlo come
 * «✓ nessuna divergenza» rimetterebbe a schermo la stessa affermazione falsa da
 * cui si parte.
 *
 * LIMITE DICHIARATO: verifica la superficie ELENCATA, non ne scopre di nuove.
 * Una seconda pagina che domani mostri i pack senza il drift passa verde — chi
 * la aggiunge aggiunge la riga. Stesso prezzo (e stessa scelta) di
 * `check-stale-visible.mjs`.
 */
import { leggiSorgente, senzaCommenti } from './lib/sorgente.mjs';

const SUPERFICIE = 'src/routes/packs/+page.svelte';
const CLIENT = 'src/lib/api/client.ts';

const guasti = [];

const client = leggiSorgente(CLIENT, guasti, 'la chiamata al backend');
if (client && !senzaCommenti(client).includes('/drift')) {
	guasti.push(
		`${CLIENT}: nessuna chiamata a POST /clodia/packs/{name}/drift — la vista non ha modo di chiedere il drift`
	);
}

const pagina = leggiSorgente(SUPERFICIE, guasti, 'la vista Packs');
if (pagina) {
	// Senza commenti: la parola che si cerca sta anche nella prosa che spiega la
	// regola, e un guard che trova se stesso non protegge niente (web#181).
	const codice = senzaCommenti(pagina);
	const richiesto = [
		['checkPackDrift', 'la pagina non chiede il drift'],
		['drifted', "l'esito non viene letto: il numero di seed divergenti resta nel payload"],
		// `missing` da solo lo si troverebbe in `missing_plugins`, che è un'altra
		// cosa: il punto fermo finale distingue l'accesso al campo del drift
		// (`.missing.join`) dal prefisso omonimo (`.missing_plugins`).
		['.missing.', 'i campi spariti dal seed non arrivano a schermo'],
		['.changed', 'i campi col valore cambiato non arrivano a schermo'],
		[
			'unavailable',
			"un pack senza riferimento verrebbe mostrato come pulito: è l'affermazione falsa da cui parte la #266"
		]
	];
	for (const [ago, perche] of richiesto) {
		if (!codice.includes(ago)) guasti.push(`${SUPERFICIE}: manca \`${ago}\` — ${perche}`);
	}
}

if (guasti.length) {
	console.error('drift dei seed non visibile nella vista Packs (clodia-platform#266):');
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log('ok: il drift seed ↔ pack si vede nella vista Packs');
