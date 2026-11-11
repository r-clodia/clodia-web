#!/usr/bin/env node
/**
 * The Databases pages (clodia-platform#672): what they must show, and what
 * they must never show again.
 *
 * Runs the REAL helpers (`src/lib/databases.js`): a topic's own index
 * (`topic-*`) never reaches the catalogue even if a server sent it, the
 * filters, the hrefs (a non-admin carries their scope), the upload formats
 * (PDF, DOCX, PPTX, MD, TXT — the server checks the same list) and limits.
 *
 * Then reads the source of the three pages and the delete dialog:
 *   - the catalogue reuses ViewToggle (#656) with the view read at init, and
 *     both renderers share one actions snippet;
 *   - the seed lists, the legacy/topic switch and the migration table are
 *     gone (#669: access comes only from scope imports);
 *   - deleting a container needs the typed name, the dialog says the data
 *     leaves the platform and where the pre-delete export goes;
 *   - the collection page offers drag & drop upload with progress.
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
		E({ kind: 'rag', name: 'topic-ab12', pack: null, tier: 'SEAL-2' }),
		E({ kind: 'rag', name: 'manuali', pack: 'tomato-pack', tier: 'SEAL-2', imported_by_scopes: ['SEAL-2/commerciale'] }),
		E({ kind: 'datastore', name: 'platform/note', pack: null, tier: 'SEAL-1' }),
		E({ kind: 'datastore', name: 'tomato-pack/clienti', pack: 'tomato-pack', tier: 'SEAL-2', purpose: 'CRM' })
	];
	const names = (xs) => xs.map((e) => e.name).join(',');
	const cases = [
		['topic indexes never listed', names(mod.visibleEntries(entries)), 'manuali,platform/note,tomato-pack/clienti'],
		['filter by kind', names(mod.filterEntries(entries, { kind: 'datastore' })), 'platform/note,tomato-pack/clienti'],
		['filter platform origin', names(mod.filterEntries(entries, { pack: '@platform' })), 'platform/note'],
		['filter by pack', names(mod.filterEntries(entries, { pack: 'tomato-pack' })), 'manuali,tomato-pack/clienti'],
		['filter by tier', names(mod.filterEntries(entries, { tier: 'SEAL-1' })), 'platform/note'],
		['search name or purpose', names(mod.filterEntries(entries, { q: 'crm' })), 'tomato-pack/clienti'],
		['topic index not reachable by a filter', names(mod.filterEntries(entries, { q: 'topic' })), ''],
		['packs of the catalogue', mod.packsOf(entries).join(','), 'tomato-pack'],
		['origin label', mod.originLabel(entries[2]), 'piattaforma'],
		['datastore href', mod.datastoreHref('tomato-pack/clienti'), '/databases/datastore/tomato-pack/clienti'],
		['collection href with scope', mod.collectionHref('manuali', 'SEAL-2/commerciale'), '/databases/collection/manuali?scope=SEAL-2%2Fcommerciale'],
		['admin href carries no scope', mod.entryHref(entries[1], true), '/databases/collection/manuali'],
		['non-admin href carries the first scope', mod.entryHref(entries[1], false), '/databases/collection/manuali?scope=SEAL-2%2Fcommerciale'],
		['upload formats', mod.UPLOAD_FORMATS.join(','), '.pdf,.docx,.pptx,.md,.txt'],
		['pptx accepted', mod.uploadProblem({ name: 'Deck.PPTX', size: 10 }, 100), ''],
		['xlsx refused', mod.uploadProblem({ name: 'a.xlsx', size: 10 }, 100).startsWith('formato'), true],
		['too big refused', mod.uploadProblem({ name: 'a.pdf', size: 101 }, 100).startsWith('file troppo grande'), true],
		['empty refused', mod.uploadProblem({ name: 'a.md', size: 0 }, 100), 'file vuoto'],
		['topic scope href', mod.scopeHref('SEAL-2/commerciale'), '/topics/SEAL-2/commerciale'],
		['job scope href', mod.scopeHref('job:7'), '/jobs/7'],
		['valid name', mod.validName('procedure-interne'), true],
		['invalid name', mod.validName('Procedure/../x'), false]
	];
	for (const [name, got, want] of cases) {
		const ok = got === want;
		if (!ok) failures.push(`${name}: ${JSON.stringify(got)} (expected ${JSON.stringify(want)})`);
		console.log(`${ok ? 'ok  ' : 'KO  '} ${name}`);
	}
}

const CAT = 'src/routes/databases/+page.svelte';
const DS = 'src/routes/databases/datastore/[pack]/[name]/+page.svelte';
const COL = 'src/routes/databases/collection/[name]/+page.svelte';
const DLG = 'src/lib/components/DeleteResourceDialog.svelte';

const cat = leggiSorgente(CAT, failures, 'catalogue');
if (cat !== null) {
	const src = senzaCommenti(cat);
	const script = src.slice(0, src.indexOf('</script>'));
	if (!/^\tlet view = readView\('databases'\);/m.test(script)) failures.push(`${CAT}: view not read with readView('databases') at init`);
	if (!/<ViewToggle page="databases" bind:view \/>/.test(src)) failures.push(`${CAT}: no <ViewToggle page="databases" bind:view />`);
	if ((src.match(/\{@render actions\(/g) ?? []).length < 2) failures.push(`${CAT}: cards and table do not share the actions snippet`);
	if (!/filterEntries\(/.test(src)) failures.push(`${CAT}: the catalogue is not passed through filterEntries (topic indexes would show)`);
	for (const gone of ['seeds_read', 'seeds_write', 'seeds_bypass', 'setDataAccessMode', 'getDataMigrationPlan', 'applyDataMigration']) {
		if (src.includes(gone)) failures.push(`${CAT}: still uses ${gone} — seed lists, mode switch and migration are gone (#669)`);
	}
	if (!/DeleteResourceDialog/.test(src)) failures.push(`${CAT}: containers are not deleted through DeleteResourceDialog`);
}

for (const [file, kind] of [[DS, 'datastore'], [COL, 'collection']]) {
	const raw = leggiSorgente(file, failures, `${kind} page`);
	if (raw === null) continue;
	const src = senzaCommenti(raw);
	if (!/DeleteResourceDialog/.test(src)) failures.push(`${file}: no DeleteResourceDialog for the admin delete`);
	if (!/scope: scope \|\| null|scope \|\| null/.test(src)) failures.push(`${file}: content calls do not carry the scope`);
}

const col = leggiSorgente(COL, failures, 'collection page');
if (col !== null) {
	const src = senzaCommenti(col);
	if (!/on:drop=/.test(src) || !/type="file"/.test(src)) failures.push(`${COL}: no drag & drop and file input for the upload`);
	if (!/uploadToCollection\(/.test(src) || !/progress/.test(src)) failures.push(`${COL}: upload without progress`);
	if (!/getCollectionChunks\(/.test(src)) failures.push(`${COL}: the chunks of a document are not listed`);
}

const dlg = leggiSorgente(DLG, failures, 'delete dialog');
if (dlg !== null) {
	const src = senzaCommenti(dlg);
	if (!/disabled=\{!matches \|\| loading\}/.test(src)) failures.push(`${DLG}: confirm is not disabled until the typed name matches`);
	if (!/typed === name/.test(src)) failures.push(`${DLG}: the typed name is not compared exactly`);
	if (!/deleted\//.test(src) || !/export/.test(src)) failures.push(`${DLG}: the dialog does not say where the pre-delete export goes`);
	if (!/rimossi dalla piattaforma/.test(src)) failures.push(`${DLG}: the dialog does not say the data leaves the platform`);
}

if (failures.length) {
	console.error('Databases pages:');
	for (const f of failures) console.error(`  - ${f}`);
	process.exit(1);
}
console.log('Databases pages: uniform catalogue without topic indexes, scoped content, upload, typed-name delete ✓');
