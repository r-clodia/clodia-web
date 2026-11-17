#!/usr/bin/env node
/**
 * The gate approval matrix (clodia-platform#693): WHO (this spawn · this seed ·
 * every agent) × WHERE (this room · the instance).
 *
 * - Both the inline channel card and the popup use `GateMatrix`.
 * - The cells a gate has come from the gateway (`remember`), not a second copy
 *   of the rule here; the instance column needs an admin, the room column a room.
 * - «tutti gli agenti · globale» asks a second confirmation.
 * - The approval sends `who`/`where`; a correction stays `{ who: 'spawn' }`.
 * Checked on the TEXT of the sources.
 */
import { leggiSorgente } from './lib/sorgente.mjs';

const guasti = [];
const m = leggiSorgente('src/lib/components/GateMatrix.svelte', guasti);
if (m) {
	if (!m.includes("c[`${who}:${where}`]")) guasti.push('GateMatrix: le caselle vanno lette da `remember` del gateway');
	if (!m.includes("where === 'global' && !isAdmin")) guasti.push('GateMatrix: la colonna globale è di un admin');
	if (!m.includes("where === 'chat' && !hasRoom")) guasti.push('GateMatrix: la colonna «questa chat» richiede una stanza');
	if (!m.includes("who === 'all' && where === 'global' && !confirmAll")) {
		guasti.push('GateMatrix: «tutti gli agenti · globale» deve chiedere una seconda conferma');
	}
	if (!m.includes('span2')) guasti.push('GateMatrix: la riga dello spawn è una casella sola');
}
const pagina = leggiSorgente('src/routes/topics/[tier]/[name]/+page.svelte', guasti);
if (pagina) {
	if (!pagina.includes('<GateMatrix')) guasti.push('card di canale: non usa GateMatrix');
	if (!pagina.includes('remember: q.remember')) guasti.push('card di canale: le caselle del gateway non arrivano alla card');
	if (!pagina.includes('who: cell.who')) guasti.push('decideGate: deve inviare who/where');
}
const popup = leggiSorgente('src/lib/components/GateApprovals.svelte', guasti);
if (popup) {
	if (!popup.includes('<GateMatrix')) guasti.push('popup: non usa GateMatrix');
	if (!popup.includes('who: cell.who')) guasti.push('popup: deve inviare who/where');
}
if (guasti.length) {
	console.error('check-gate-matrix:\n  ' + guasti.join('\n  '));
	process.exit(1);
}
console.log('check-gate-matrix: ok');
