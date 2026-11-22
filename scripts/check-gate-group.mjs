#!/usr/bin/env node
/**
 * Consecutive gate cards are ONE card (clodia-platform#489).
 *
 * Runs the real functions of `$lib/gateCard`:
 *  1. consecutive gate messages → one group, rendered on the last row; a
 *     non-gate message splits; a lone request stays a single card; a gate
 *     message whose card is hidden is not a row and does not split;
 *  2. a decision on the group touches the triples of the ticked rows, writes
 *     the outcome on every message of each triple, and leaves out rows the
 *     viewer cannot decide; approve-all applies to each request, one by one,
 *     and a refusal on one does not stop the others.
 * Then reads the sources:
 *  3. the `GateBatchBar` is gone (it duplicated the cards), and the topic page,
 *     the helpdesk widget and the global popup render `GateGroupCard`;
 *  4. the group card asks for confirmation on «approve all», never lets a
 *     non-decidable row be ticked, and keeps the per-request card reachable.
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { decideBatch, gateBatch, gateBatchScelte, gateGroups } from '../src/lib/gateCard.js';
import { leggiSorgente, senzaCommenti } from './lib/sorgente.mjs';

const guasti = [];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── 1. grouping ─────────────────────────────────────────────────────────────
const G = (card = true) => ({ gate: true, card });
const T = { gate: false, card: false };
{
	const r = gateGroups([T, G(), G(), G(), T, G(), T, G(), G(false), G(), G(false)]);
	const ruoli = r.map((x) => x.ruolo);
	const atteso = [null, 'membro', 'membro', 'gruppo', null, 'singola', null, 'membro', null, 'gruppo', null];
	if (!eq(ruoli, atteso)) guasti.push(`ruoli attesi ${JSON.stringify(atteso)}, trovati ${JSON.stringify(ruoli)}`);
	if (!eq(r[3].righe, [1, 2, 3])) guasti.push(`il gruppo 1..3 deve avere le righe [1,2,3]: ${JSON.stringify(r[3].righe)}`);
	if (!eq(r[1].righe, r[3].righe)) guasti.push('i membri devono conoscere le righe del loro gruppo');
	// A hidden gate card between two visible ones does not split the run.
	if (!eq(r[9].righe, [7, 9])) guasti.push(`gate nascosto in mezzo: righe attese [7,9], trovate ${JSON.stringify(r[9].righe)}`);
	if (!eq(r[5].righe, [5])) guasti.push('una richiesta isolata resta una card singola');
}
if (gateGroups([G(false), G(false)]).some((x) => x.ruolo !== null)) {
	guasti.push('nessuna card visibile → nessuna card, neppure di gruppo');
}
if (gateGroups([G(false), G(), G(false)]).map((x) => x.ruolo).join() !== ',singola,') {
	guasti.push('una sola card visibile in una sequenza resta singola');
}

// ── 2. deciding a group ─────────────────────────────────────────────────────
const T0 = Date.parse('2026-11-21T12:00:00Z');
const msg = (id, s) => ({ id, ts: new Date(T0 + s * 1000).toISOString() });
const g = (agent, verb) => ({ id: `${agent}|-|${verb}`, agent, instance: '-', verb });
const A = g('sysadmin', 'egress:web:https://a.example');
const B = g('sysadmin', 'topic.put');
const C = g('sysadmin', 'web.post');      // the viewer may not decide this one
const stato = { decisi: {}, aperti: new Set([A.id, B.id, C.id]), listaTs: T0 - 1000 };
const righe = [
	{ msg: msg('m1', 0), gate: A },
	{ msg: msg('m2', 1), gate: B },
	{ msg: msg('m3', 2), gate: A },       // same triple as m1
	{ msg: msg('m4', 3), gate: C }
];
const blocco = gateBatch(stato, righe, (x) => x.id !== C.id);
{
	const scelte = gateBatchScelte(blocco, ['m3']);
	if (scelte.length !== 1 || scelte[0].id !== A.id) guasti.push(`ticking m3 decides triple A: ${JSON.stringify(scelte)}`);
	else if (!eq(scelte[0].msgIds, ['m1', 'm3'])) guasti.push('the outcome of triple A must be written on m1 and m3');
	if (gateBatchScelte(blocco, ['m4']).length) guasti.push('a row the viewer cannot decide must not be decided');
}
{
	const tutte = gateBatchScelte(blocco, ['m1', 'm2', 'm3', 'm4']);
	const chiamate = [];
	const esito = await decideBatch(tutte, new Set(tutte.map((v) => v.id)), async (v) => {
		chiamate.push(v.id);
		if (v.id === A.id) throw new Error('403 fuori titolo');
	});
	if (!eq(chiamate, [A.id, B.id])) guasti.push(`approve-all: one call per triple, in order — ${JSON.stringify(chiamate)}`);
	if (esito.ok.length !== 1 || esito.falliti.length !== 1) guasti.push('approve-all: a refusal on one must not stop the others');
}

// ── 3. sources: no batch bar, grouped card everywhere ───────────────────────
function walk(dir) {
	const out = [];
	for (const f of readdirSync(dir)) {
		const p = join(dir, f);
		if (statSync(p).isDirectory()) out.push(...walk(p));
		else if (/\.(svelte|ts|js)$/.test(f)) out.push(p);
	}
	return out;
}
for (const f of walk('src')) {
	if (f.endsWith('GateBatchBar.svelte')) guasti.push(`${f}: the batch bar must be gone (#489)`);
	const code = senzaCommenti(leggiSorgente(f, [], '') ?? '');
	if (/<GateBatchBar|from '[^']*GateBatchBar/.test(code)) guasti.push(`${f}: still renders the GateBatchBar`);
}
const HOSTS = {
	'src/routes/topics/[tier]/[name]/+page.svelte': true,
	'src/lib/components/ChatWidget.svelte': true,
	'src/lib/components/GateApprovals.svelte': false
};
for (const [f, stream] of Object.entries(HOSTS)) {
	const src = leggiSorgente(f, guasti);
	if (!src) continue;
	const code = senzaCommenti(src);
	if (!code.includes('<GateGroupCard')) guasti.push(`${f}: consecutive requests must render GateGroupCard`);
	if (!code.includes('slot="detail"')) guasti.push(`${f}: the per-request decision must stay reachable in the group`);
	if (stream) {
		if (!code.includes('gateGroups(')) guasti.push(`${f}: the grouping must come from gateGroups, not be rewritten`);
		if (!code.includes('gateBatchScelte(')) guasti.push(`${f}: a group decision must go through gateBatchScelte`);
		if (!code.includes("gGruppo.ruolo !== 'membro'")) guasti.push(`${f}: a grouped row must not ALSO render its own card`);
	}
}

// ── 4. the group card ───────────────────────────────────────────────────────
const card = leggiSorgente('src/lib/components/GateGroupCard.svelte', guasti, 'grouped gate card');
if (card) {
	const code = senzaCommenti(card);
	if (!code.includes("from '$lib/gateLabel'")) guasti.push('GateGroupCard: rows must be labelled with gateLabel');
	if (!/disabled=\{busy \|\| !sel\}/.test(code)) guasti.push('GateGroupCard: a row the viewer cannot decide must not be selectable');
	if (!/on:click=\{\(\) => \(conferma = true\)\}/.test(code) || !code.includes('decidi(true, decidibili)')) {
		guasti.push('GateGroupCard: «approve all» must ask for confirmation first');
	}
	if (!code.includes('<slot name="detail"')) guasti.push('GateGroupCard: the per-row detail slot is gone');
	if (code.includes('/api/gate/')) guasti.push('GateGroupCard: the card must not call the gateway; the host decides');
}

if (guasti.length) {
	console.error('check-gate-group:\n  ' + guasti.join('\n  '));
	process.exit(1);
}
console.log('check-gate-group: ok');
