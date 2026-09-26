#!/usr/bin/env node
/**
 * Gate combinato (clodia-platform#396): il blocco è fatto di RICHIESTE, e un
 * rifiuto su una non decide le altre.
 *
 * Esegue le funzioni vere di `$lib/gateCard`:
 *  1. due card con la stessa tripla sono UNA voce, che ricorda entrambe;
 *  2. una card già decisa, una chiusa, o una che chi guarda non ha titolo a
 *     decidere non entrano nel blocco;
 *  3. si decidono solo le voci scelte, e un rifiuto a metà non ferma le altre.
 */
import { decideBatch, gateBatch } from '../src/lib/gateCard.js';

const guasti = [];
const T0 = Date.parse('2026-09-26T12:00:00Z');
const msg = (id, s) => ({ id, ts: new Date(T0 + s * 1000).toISOString() });
const g = (agent, verb, instance = '-') => ({ id: `${agent}|${instance}|${verb}`, agent, instance, verb });

const A = g('sysadmin', 'egress.allow');
const B = g('clodia', 'copybrain:commercialista', 'clodia-3');
const C = g('clodia', 'web.post');
const D = g('avvocato', 'topic.add_participant');
const stato = {
	decisi: { m5: 'approvato' },
	aperti: new Set([A.id, B.id, C.id, D.id]),
	listaTs: T0 + 60_000
};
const voci = [
	{ msg: msg('m1', 0), gate: A },
	{ msg: msg('m2', 10), gate: A },       // stessa tripla di m1
	{ msg: msg('m3', 20), gate: B },
	{ msg: msg('m4', 30), gate: D },       // chi guarda non ha titolo
	{ msg: msg('m5', 40), gate: C },       // già decisa in pagina
	{ msg: msg('m6', 50), gate: g('x', 'y') } // non più in coda, lista più recente → chiusa
];
const blocco = gateBatch(stato, voci, (gate) => gate.id !== D.id);
const ids = blocco.map((v) => v.id).sort();
if (JSON.stringify(ids) !== JSON.stringify([A.id, B.id].sort())) {
	guasti.push(`voci del blocco attese [A, B], trovate ${JSON.stringify(ids)}`);
}
const vA = blocco.find((v) => v.id === A.id);
if (!vA || JSON.stringify(vA.msgIds) !== JSON.stringify(['m1', 'm2'])) {
	guasti.push(`la voce A deve ricordare entrambe le card (m1, m2): ${JSON.stringify(vA?.msgIds)}`);
}

const chiamate = [];
const esito = await decideBatch(
	[...blocco, { ...C, msgIds: ['m5'] }],
	new Set([A.id, B.id]),
	async (v) => {
		chiamate.push(v.id);
		if (v.id === A.id) throw new Error('403 fuori titolo');
	}
);
if (chiamate.includes(C.id)) guasti.push('decisa una voce NON scelta');
if (!chiamate.includes(B.id)) guasti.push('un rifiuto su A ha fermato B');
if (esito.ok.length !== 1 || esito.falliti.length !== 1 || !esito.falliti[0].errore.includes('403')) {
	guasti.push(`esito atteso 1 ok e 1 fallita col motivo: ${JSON.stringify(esito)}`);
}

if (guasti.length) {
	console.error('check-gate-batch:\n  ' + guasti.join('\n  '));
	process.exit(1);
}
console.log('check-gate-batch: ok');
