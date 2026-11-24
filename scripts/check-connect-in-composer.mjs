#!/usr/bin/env node
// Owner, 24 Nov 2026: the 🔌 sits in the chat input's button row next to
// «espandi», and what it connected (authorised MCPs, imported RAG/databases)
// shows there as chips. The derivation is EXECUTED; the page by text.
import { readFileSync } from 'node:fs';
import { connectedChips, shortDataName } from '../src/lib/connectedChips.js';

const fail = (m) => { console.error('check-connect-in-composer: ' + m); process.exit(1); };
const page = readFileSync('src/routes/topics/[tier]/[name]/+page.svelte', 'utf8');

const chips = connectedChips(
	{ mcp: { github: {}, buffer: {} }, mcp_catalogue: { github: { label: 'GitHub' }, buffer: { label: 'Buffer' } } },
	[{ kind: 'datastore', name: 'assetti-contabili/contabilita:studio-davidecarboni' }, { kind: 'rag', name: 'eu-normativa' }]);
if (chips.map((c) => `${c.kind}:${c.label}`).join(',') !== 'mcp:Buffer,mcp:GitHub,rag:eu-normativa,datastore:studio-davidecarboni')
	fail('chips: MCPs by id with their label, then the imports by readable name: ' + JSON.stringify(chips));
if (!chips[3].title.includes('assetti-contabili/contabilita:studio-davidecarboni')) fail('the full name stays in the tooltip');
if (connectedChips(null, null).length !== 0) fail('nothing connected → no chips');
// A topic's RAG index reads as the topic's code name, never `topic-…`.
const cat = [{ name: 'topic-fee7cb30', topic: 'SEAL-1/moneyviz-2026' }];
const rag = connectedChips(null, [{ kind: 'rag', name: 'topic-fee7cb30' }, { kind: 'rag', name: 'topic-aaaa1111' }],
	cat, 'topic-aaaa1111', 'questo-topic');
if (rag.map((c) => c.label).join(',') !== 'moneyviz-2026,questo-topic')
	fail('RAG index chips must show the topic code name: ' + rag.map((c) => c.label).join(','));
if (!rag[0].title.includes('topic-fee7cb30')) fail('the technical id stays in the tooltip');
if (!/connectedChips\(roomBox, info\?\.meta\?\.data \?\? \[\], dataCatalog,/.test(page)) fail('the page must pass the data catalog to the chips');
if (shortDataName('tomato-pack/clienti') !== 'clienti') fail('short name of a datastore');

const tools = page.match(/<div class="input-tools">([\s\S]*?)<\/div>/);
if (!tools) fail('no input-tools row');
const t = tools[1];
const exp = t.indexOf('class="expand-input"'), conn = t.indexOf('class="connect-input"');
if (exp < 0 || conn < 0 || conn < exp) fail('the 🔌 must sit in the row, right after «espandi»');
if (!/\{#each chips as c/.test(t) || !/apriComando\('connect'\)/.test(t)) fail('the chips must be in the row and open the popup');
if (/class="connect-btn"/.test(page)) fail('the 🔌 must not stay in the header too');
if (!/on:changed=\{\(\) => \{ void refreshInfo\(\); void loadConnectedMcp\(\); \}\}/.test(page)) fail('a change in the popup must refresh the chips');

console.log('connect in composer: 🔌 next to «espandi», chips for MCPs and data, refreshed on change ✓');
