#!/usr/bin/env node
/**
 * Datastore structures and instances in the WebUI (clodia-platform#688,
 * epic #684): a pack declares STRUCTURES, never databases; every structure is
 * multi-instance (`<pack>/<structure>:<name>`) and an instance exists only
 * once somebody creates it with "Crea db".
 *
 * Runs the REAL helpers (`src/lib/databases.js`): the instance name rule (same
 * as the server: `^[a-z0-9][a-z0-9-]{0,40}$`), the tiers offered (≤ the
 * person's clearance, legacy P0–P3 mapped, unknown clearance → none), the
 * parsing of instance ids, the `<structure> · <name>` label, the origin pack
 * when the backend does not fill `pack`, and the filter by structure.
 *
 * Then reads the source of the pack page, the dialog, the catalogue and the
 * import picker:
 *   - the pack page lists "Strutture dati" and shows "Crea db" to admins only;
 *   - the dialog validates the name live, requires a tier among the allowed
 *     ones, calls `create_instance` and links to the new instance;
 *   - an older backend (404 on the structures route) hides the section
 *     instead of failing the page;
 *   - the catalogue labels instances and filters by structure;
 *   - the import picker shows an instance's structure.
 *
 * DECLARED LIMIT: the second half reads source TEXT, not the rendered DOM.
 */
import { leggiSorgente, senzaCommenti } from './lib/sorgente.mjs';

const failures = [];
let mod;
try {
	mod = await import('../src/lib/databases.js');
} catch (e) {
	failures.push(`src/lib/databases.js does not import (${e && e.message})`);
}

if (mod) {
	const E = (o) => ({ imported_by_scopes: [], ...o });
	const entries = [
		E({ kind: 'datastore', name: 'assetti-contabili/contabilita:tomato', pack: 'assetti-contabili', tier: 'SEAL-2' }),
		E({ kind: 'datastore', name: 'assetti-contabili/contabilita:uncommon', pack: null, tier: 'SEAL-2' }),
		E({ kind: 'datastore', name: 'assetti-contabili/fornitori:tomato', pack: 'assetti-contabili', tier: 'SEAL-1' }),
		E({ kind: 'datastore', name: 'platform/note', pack: null, tier: 'SEAL-1' }),
		E({ kind: 'rag', name: 'manuali', pack: 'tomato-pack', tier: 'SEAL-2' })
	];
	const names = (xs) => xs.map((e) => e.name).join(',');
	const cases = [
		['instance name ok', mod.validInstanceName('uncommon'), true],
		['instance name with dash', mod.validInstanceName('studio-2'), true],
		['instance name 41 chars', mod.validInstanceName('a'.repeat(41)), true],
		['instance name 42 chars refused', mod.validInstanceName('a'.repeat(42)), false],
		['instance name no underscore', mod.validInstanceName('a_b'), false],
		['instance name no uppercase', mod.validInstanceName('Tomato'), false],
		['instance name no leading dash', mod.validInstanceName('-x'), false],
		['instance name no colon or slash', mod.validInstanceName('a:b') || mod.validInstanceName('a/b'), false],
		['problem: empty', mod.instanceNameProblem(''), 'nome obbligatorio'],
		['problem: taken', mod.instanceNameProblem('tomato', ['tomato']).startsWith('esiste già'), true],
		['problem: none', mod.instanceNameProblem('uncommon', ['tomato']), ''],
		['tiers up to SEAL-2', mod.tiersUpTo('SEAL-2').join(','), 'SEAL-0,SEAL-1,SEAL-2'],
		['tiers up to legacy P1', mod.tiersUpTo('P1').join(','), 'SEAL-0,SEAL-1'],
		['tiers up to SEAL-4', mod.tiersUpTo('SEAL-4').length, 5],
		['unknown clearance offers nothing', mod.tiersUpTo(null).length, 0],
		['garbage clearance offers nothing', mod.tiersUpTo('SEAL-9').length, 0],
		['parse instance id', JSON.stringify(mod.parseInstanceId('assetti-contabili/contabilita:tomato')),
			JSON.stringify({ pack: 'assetti-contabili', structure: 'contabilita', name: 'tomato', structureId: 'assetti-contabili/contabilita' })],
		['legacy pack datastore is not an instance', mod.parseInstanceId('tomato-pack/clienti'), null],
		['label of an instance', mod.instanceLabel(entries[0]), 'contabilita · tomato'],
		['label of a platform datastore', mod.instanceLabel(entries[3]), 'platform/note'],
		['label of a collection', mod.instanceLabel(entries[4]), 'manuali'],
		['origin from the id when pack is missing', mod.originLabel(entries[1]), 'assetti-contabili'],
		['platform origin unchanged', mod.originLabel(entries[3]), 'piattaforma'],
		['structures of the catalogue', mod.structuresOf(entries).join(','),
			'assetti-contabili/contabilita,assetti-contabili/fornitori'],
		['filter by structure', names(mod.filterEntries(entries, { structure: 'assetti-contabili/contabilita' })),
			'assetti-contabili/contabilita:tomato,assetti-contabili/contabilita:uncommon'],
		['filter by pack sees instances without pack', names(mod.filterEntries(entries, { pack: 'assetti-contabili' })),
			'assetti-contabili/contabilita:tomato,assetti-contabili/contabilita:uncommon,assetti-contabili/fornitori:tomato'],
		['platform filter excludes instances', names(mod.filterEntries(entries, { pack: '@platform' })), 'platform/note'],
		['instance href', mod.datastoreHref('assetti-contabili/contabilita:tomato'),
			'/databases/datastore/assetti-contabili/contabilita%3Atomato'],
		['structures of a pack', mod.structuresOfPack([{ pack: 'a', id: 'a/x' }, { pack: 'b', id: 'b/y' }], 'a').length, 1]
	];
	for (const [name, got, want] of cases) {
		const ok = got === want;
		if (!ok) failures.push(`${name}: ${JSON.stringify(got)} (expected ${JSON.stringify(want)})`);
		console.log(`${ok ? 'ok  ' : 'KO  '} ${name}`);
	}
}

const PACKS = 'src/routes/packs/+page.svelte';
const PD = 'src/lib/components/PackDatastores.svelte';
const DLG = 'src/lib/components/CreateInstanceDialog.svelte';
const CAT = 'src/routes/databases/+page.svelte';
const PICK = 'src/lib/components/DataPicker.svelte';
const CLIENT = 'src/lib/api/client.ts';

const packs = leggiSorgente(PACKS, failures, 'pack page');
if (packs !== null) {
	const src = senzaCommenti(packs);
	if (!/<PackDatastores\b[^>]*admin=\{\$isAdmin\}/.test(src)) failures.push(`${PACKS}: PackDatastores not rendered with admin={$isAdmin}`);
	if (!/<CreateInstanceDialog\b/.test(src)) failures.push(`${PACKS}: no CreateInstanceDialog`);
	if (!/getDatastoreStructures\(/.test(src)) failures.push(`${PACKS}: structures not loaded`);
	if (!/clearance/.test(src)) failures.push(`${PACKS}: the person's clearance is not passed to the dialog`);
}

const pd = leggiSorgente(PD, failures, 'pack data structures');
if (pd !== null) {
	const src = senzaCommenti(pd);
	if (!/Strutture dati/.test(src)) failures.push(`${PD}: no «Strutture dati» section`);
	if (!/\{#if admin\}[\s\S]*?Crea db/.test(src)) failures.push(`${PD}: «Crea db» is not admin-only`);
	if (!/datastoreHref\(i\.id\)/.test(src)) failures.push(`${PD}: instances do not link to their Databases page`);
	if (!/imported_by_scopes/.test(src) || !/i\.tier/.test(src)) failures.push(`${PD}: instances without tier or importing scopes`);
}

const dlg = leggiSorgente(DLG, failures, 'Crea db dialog');
if (dlg !== null) {
	const src = senzaCommenti(dlg);
	if (!/instanceNameProblem\(/.test(src)) failures.push(`${DLG}: the name is not validated live`);
	if (!/tiersUpTo\(clearance\)/.test(src)) failures.push(`${DLG}: tiers not limited to the clearance`);
	if (!/!!tier && allowed\.includes\(tier\)/.test(src)) failures.push(`${DLG}: submit not gated on a required, allowed tier`);
	if (!/createDatastoreInstance\(/.test(src)) failures.push(`${DLG}: does not call createDatastoreInstance`);
	if (!/datastoreHref\(createdId\)/.test(src)) failures.push(`${DLG}: no link to the created instance`);
	if (!/<Modal\b/.test(src)) failures.push(`${DLG}: not built on Modal`);
}

const client = leggiSorgente(CLIENT, failures, 'API client');
if (client !== null) {
	const src = senzaCommenti(client);
	if (!/action: 'create_instance'/.test(src)) failures.push(`${CLIENT}: create_instance action missing`);
	if (!/'\/clodia\/databases\/structures'/.test(src)) failures.push(`${CLIENT}: structures route missing`);
	if (!/e\.status === 404/.test(src)) failures.push(`${CLIENT}: an older backend (404) is not tolerated`);
}

const cat = leggiSorgente(CAT, failures, 'catalogue');
if (cat !== null) {
	const src = senzaCommenti(cat);
	if (!/instanceLabel\(e\)/.test(src)) failures.push(`${CAT}: instances not labelled <structure> · <name>`);
	if (!/structure: fStructure/.test(src) || !/Tutte le strutture/.test(src)) failures.push(`${CAT}: no filter by structure`);
}

const pick = leggiSorgente(PICK, failures, 'import picker');
if (pick !== null) {
	const src = senzaCommenti(pick);
	if (!/structureLabel\(e\)/.test(src)) failures.push(`${PICK}: instances listed without their structure`);
}

if (failures.length) {
	console.error('Datastore instances:');
	for (const f of failures) console.error(`  - ${f}`);
	process.exit(1);
}
console.log('Datastore instances: Strutture dati + admin-only Crea db, clearance-bound tier, labelled and filterable instances ✓');
