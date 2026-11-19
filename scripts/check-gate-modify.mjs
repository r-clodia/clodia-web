#!/usr/bin/env node
/**
 * Approve with corrections (clodia-platform#448), in the topic page.
 *
 * - The corrections travel as `arguments` on /api/gate/approve, and only when
 *   approving: a denial carries nothing to correct.
 * - Only CHANGED fields are sent (`gateCorrections`): the gateway re-judges the
 *   corrected call, and an unchanged field is not a correction.
 * - «Correggi» is offered only on a VERB gate: on a destination gate the
 *   destination is the question, and editing it answers a different one.
 * - A correction is «per stavolta»: it is sent with remember 'once'.
 * Checked on the TEXT of the page and of GateCard, where the card's markup and
 * its draft live since #702 (shared with the helpdesk widget).
 */
import { leggiSorgente } from './lib/sorgente.mjs';

const guasti = [];
const p = leggiSorgente('src/routes/topics/[tier]/[name]/+page.svelte', guasti);
if (p) {
	if (!p.includes('...(approve && corrections ? { arguments: corrections } : {})')) {
		guasti.push('decideGate: le correzioni vanno inviate come `arguments`, solo approvando');
	}
	// The card hands the corrections and its cell over: the page forwards both.
	if (!p.includes('decideGate(m.id, g, true, e.detail.cell, e.detail.corrections)')) {
		guasti.push('pagina: la decisione della card deve portare cella e correzioni a decideGate');
	}
}
const c = leggiSorgente('src/lib/components/GateCard.svelte', guasti);
if (c) {
	if (!/if \(v !== was\)/.test(c)) {
		guasti.push('gateCorrections: vanno inviati solo i campi cambiati');
	}
	if (!c.includes("{#if !isDestinationGate(g.verb) && info?.editable}")) {
		guasti.push('card: «Correggi» solo sui gate di verbo con campi modificabili');
	}
	// Since #693 «only this time» is the matrix cell `{ who: 'spawn' }`.
	if (!c.includes("dispatch('decide', { approve: true, cell: { who: 'spawn' }, corrections: gateCorrections() })")) {
		guasti.push("card: una correzione vale solo per stavolta (who 'spawn')");
	}
}
if (guasti.length) {
	console.error('check-gate-modify:\n  ' + guasti.join('\n  '));
	process.exit(1);
}
console.log('check-gate-modify: ok');
