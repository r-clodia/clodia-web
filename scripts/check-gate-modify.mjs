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
 * Checked on the TEXT of the page.
 */
import { leggiSorgente } from './lib/sorgente.mjs';

const guasti = [];
const p = leggiSorgente('src/routes/topics/[tier]/[name]/+page.svelte', guasti);
if (p) {
	if (!p.includes('...(approve && corrections ? { arguments: corrections } : {})')) {
		guasti.push('decideGate: le correzioni vanno inviate come `arguments`, solo approvando');
	}
	if (!/if \(v !== was\)/.test(p)) {
		guasti.push('gateCorrections: vanno inviati solo i campi cambiati');
	}
	if (!p.includes("{#if !isDestinationGate(g.verb) && gateInfo[g.id]?.editable}")) {
		guasti.push('card: «Correggi» solo sui gate di verbo con campi modificabili');
	}
	if (!p.includes("decideGate(m.id, g, true, 'once', gateCorrections(g.id))")) {
		guasti.push("card: una correzione vale solo per stavolta (remember 'once')");
	}
}
if (guasti.length) {
	console.error('check-gate-modify:\n  ' + guasti.join('\n  '));
	process.exit(1);
}
console.log('check-gate-modify: ok');
