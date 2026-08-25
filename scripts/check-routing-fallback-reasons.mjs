#!/usr/bin/env node
/**
 * Le reason di RIPIEGO del router si leggono, e contano come ripiego
 * (clodia-platform#293, residuo della #188).
 *
 * Il difetto misurato su `main` dopo il deploy di clodia-logic#357: la pagina
 * del topic decideva «è un ripiego?» confrontando `lastRouting.reason` con la
 * stringa letterale `'fallback-rank'`, in tre punti. Da R10 quella stringa non
 * la emette più nessuno — il ripiego è il coordinatore DICHIARATO — e i tre
 * comportamenti si sono spenti in silenzio: etichetta in lingua del backend,
 * pannello non evidenziato, invito a correggere il routing mai mostrato.
 *
 * Questo guard sorveglia il punto in cui il difetto è nato, cioè il CONTRATTO
 * IMPLICITO fra i due repo: sotto ci sono le reason **letterali** che
 * `server/api/channels.py` e `server/agents/coordinator.py` producono oggi. Se
 * il backend ne cambia forma, o se qualcuno restringe di nuovo il predicato a
 * un'uguaglianza, qui diventa rosso invece di lasciarlo scoprire a chi guarda
 * una chat.
 *
 * Perché non è tautologico: la prima metà non cerca parole nel sorgente della
 * pagina, IMPORTA `$lib/routingReason` e lo esegue sulle reason del router. La
 * seconda metà guarda la pagina, ma cerca la FORMA della condizione (chiamata
 * al predicato condiviso, e assenza dell'uguaglianza che sostituisce), a
 * commenti già spogliati — perché la regola qui sopra è scritta in un commento
 * dentro il file controllato, e un guard che cercasse il vocabolo la troverebbe
 * lì (web#181).
 */
import { leggiSorgente, senzaCommenti } from './lib/sorgente.mjs';
import {
	routingReasonLabel,
	isFallbackReason,
	coordinatorHint
} from '../src/lib/routingReason.js';

const PAGE = 'src/routes/topics/[tier]/[name]/+page.svelte';
const guasti = [];

/**
 * Le reason che il router emette, copiate dal backend:
 *   - `fallback-{reason}` con reason da `coordinator.pick` → «coordinatore dichiarato (nome)»
 *   - `fallback-rank-senza-coordinatore` → ultima rete, nessun coordinatore idoneo
 *   - `fallback-rank` → il ripiego di prima della #357, vivo nello storico
 * `ripiego: false` = decisione piena, non deve accendere l'evidenziazione.
 */
const REASON = [
	['fallback-coordinatore dichiarato (clodia)', true],
	['fallback-coordinatore dichiarato (segretario)', true],
	['fallback-rank-senza-coordinatore', true],
	['fallback-rank', true],
	['tagged', false],
	['relevance', false],
	['rank', false],
	// Contiene la parola «fallback» ed è l'esito OPPOSTO: più specialisti
	// pertinenti insieme. Un predicato scritto con `includes` la prenderebbe.
	['multi-match fallback', false],
	['router overruled by human', false],
	['routing ambiguity resolved by human', false]
];

for (const [reason, ripiego] of REASON) {
	if (isFallbackReason(reason) !== ripiego) {
		guasti.push(
			`isFallbackReason(${JSON.stringify(reason)}) = ${!ripiego}: ` +
				(ripiego
					? `un ripiego che non si evidenzia e non invita a correggere il routing`
					: `una decisione piena mostrata come ripiego`)
		);
	}
	const label = routingReasonLabel(reason);
	if (!label || label === reason) {
		guasti.push(
			`routingReasonLabel(${JSON.stringify(reason)}) non traduce: ` +
				`a schermo finisce la stringa interna del backend`
		);
	}
}

// I due ripieghi di R10 dicono cose DIVERSE, e l'etichetta deve distinguerli:
// «l'ha preso il coordinatore» non è «non c'era nessun coordinatore».
const conCoord = routingReasonLabel('fallback-coordinatore dichiarato (clodia)');
const senzaCoord = routingReasonLabel('fallback-rank-senza-coordinatore');
if (conCoord === senzaCoord) {
	guasti.push('le due reason di R10 hanno la stessa etichetta: i due casi non si distinguono');
}
if (!conCoord.includes('clodia')) {
	guasti.push(
		`l'etichetta del coordinatore non nomina chi ha preso il turno: ${JSON.stringify(conCoord)}`
	);
}
// La reason è parametrica: un nome mai visto prima deve restare leggibile.
const altro = routingReasonLabel('fallback-coordinatore dichiarato (aitiero)');
if (altro === 'fallback-coordinatore dichiarato (aitiero)' || !altro.includes('aitiero')) {
	guasti.push('un coordinatore con un nome nuovo non viene tradotto: la forma è riconosciuta a mano?');
}
// Il suggerimento di configurazione appartiene al solo caso che ne ha uno.
if (!coordinatorHint('fallback-rank-senza-coordinatore')) {
	guasti.push('nessun suggerimento di configurazione per la stanza senza coordinatore');
}
for (const reason of ['fallback-coordinatore dichiarato (clodia)', 'relevance', 'fallback-rank']) {
	if (coordinatorHint(reason)) {
		guasti.push(`coordinatorHint(${JSON.stringify(reason)}) suggerisce una configurazione che non serve`);
	}
}

// --- La pagina usa il predicato condiviso, nei due punti che decidono -------
const page = leggiSorgente(PAGE, guasti, 'barra di routing');
if (page !== null) {
	const src = senzaCommenti(page);
	if (/reason\s*===\s*'fallback-rank'/.test(src)) {
		guasti.push(
			`${PAGE}: confronto con la stringa letterale 'fallback-rank' — è la forma ` +
				`che la #357 ha spento; usa isFallbackReason()`
		);
	}
	const usi = (src.match(/isFallbackReason\(/g) || []).length;
	if (usi < 2) {
		guasti.push(
			`${PAGE}: isFallbackReason() usata ${usi} volta/e invece di 2 ` +
				`(evidenziazione del pannello + invito a correggere il routing)`
		);
	}
	if (!/class:fallback=\{isFallbackReason\(/.test(src)) {
		guasti.push(`${PAGE}: l'evidenziazione del pannello non passa dal predicato condiviso`);
	}
	if (!/routingReasonLabel\(/.test(src)) {
		guasti.push(`${PAGE}: l'etichetta non passa da routingReasonLabel()`);
	}
	// Le etichette stanno in un posto solo: una seconda mappa nella pagina
	// tornerebbe a divergere dal backend, che è come si è arrivati alla #293.
	if (/const routingReason\s*:/.test(src)) {
		guasti.push(`${PAGE}: seconda mappa delle reason nella pagina — la fonte deve restare una`);
	}
}

if (guasti.length) {
	console.error('reason di ripiego del router:');
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log(
	`reason di ripiego del router: ${REASON.length} reason del backend tradotte e ` +
		`classificate, predicato condiviso nei due punti ✓`
);
