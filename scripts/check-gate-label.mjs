#!/usr/bin/env node
/**
 * Un gate si legge per ciò che chiede, e il prefisso della chiave lo dice.
 *
 * `copybrain:<seed>` (clodia-platform#393) presta a uno spawn i verbi di un altro
 * seed fino alla fine dello spawn. Stampato come «vuole usare copybrain:x», chi
 * decide non saprebbe che sta concedendo un intero mestiere, né per quanto.
 * La lettura in chiaro sta in `$lib/gateLabel`; questa guard impedisce che i
 * punti che rendono un gate tornino a riscriverla a mano.
 */
import { leggiSorgente } from './lib/sorgente.mjs';

const guasti = [];
const HELPER = 'src/lib/gateLabel.ts';
const RENDER = ['src/routes/topics/[tier]/[name]/+page.svelte', 'src/lib/components/GateApprovals.svelte'];

const helper = leggiSorgente(HELPER, guasti);
if (helper && !helper.includes("startsWith('copybrain:')")) {
	guasti.push(`${HELPER}: manca la lettura di copybrain:<seed>`);
}
for (const f of RENDER) {
	const src = leggiSorgente(f, guasti);
	if (!src) continue;
	if (!src.includes("from '$lib/gateLabel'")) guasti.push(`${f}: non usa $lib/gateLabel`);
	if (src.includes("g.verb.slice('topic-access:'.length)") || src.includes("q.verb.slice('topic-access:'.length)")) {
		guasti.push(`${f}: riscrive a mano la lettura del gate invece di usare gateLabel`);
	}
}
if (guasti.length) {
	console.error('check-gate-label: ' + guasti.join('\n  '));
	process.exit(1);
}
console.log('check-gate-label: ok');
