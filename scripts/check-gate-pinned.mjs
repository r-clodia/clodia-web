#!/usr/bin/env node
// clodia-platform#736: a courier send waits on an ASYNC gate with three answers
// (deny, authorise in this channel, authorise in all channels — the last for an
// admin), and every undecided gate of the room stays pinned at the top of the
// chat (owner, 25 Nov 2026). The helpers are EXECUTED; the page by text.
import { readFileSync } from 'node:fs';
import { pinnedGates, asyncChoices } from '../src/lib/gatePinned.js';

const fail = (m) => { console.error('check-gate-pinned: ' + m); process.exit(1); };
const reqs = [
	{ agent: 'clodia', instance: 'SEAL-1/acme', verb: 'egress:email:mailto:b@x.it', chat: 'chan:SEAL-1:acme:clodia', mode: 'async', at: 20 },
	{ agent: 'officer', instance: '-', verb: 'web.fetch', chat: 'chan:SEAL-1:acme:officer', at: 10 },
	{ agent: 'clodia', instance: '-', verb: 'x', chat: 'chan:SEAL-1:altro:clodia', at: 5 },
	{ agent: 'clodia', instance: '-', verb: 'y', chat: null, at: 1 },
	{ agent: 'clodia', instance: '-', verb: 'z', chat: 'chan:SEAL-1:acme-bis:clodia', at: 2 }
];
const p = pinnedGates(reqs, 'SEAL-1', 'acme');
if (p.map((g) => g.verb).join() !== 'web.fetch,egress:email:mailto:b@x.it') fail('only this room, oldest first (not a room with a longer name)');
if (p[1].id !== 'clodia|SEAL-1/acme|egress:email:mailto:b@x.it' || p[1].mode !== 'async') fail('the card id and the mode');
if (asyncChoices(false).map((c) => c.cell.where).join() !== 'chat') fail('a non-admin authorises in this channel only');
if (asyncChoices(true).map((c) => c.cell.where).join() !== 'chat,global') fail('an admin also in all channels');

const card = readFileSync('src/lib/components/GateCard.svelte', 'utf8');
if (!/info\?\.mode === 'async'/.test(card) || !/asyncChoices\(isAdmin\)/.test(card)) fail('the async card has its own answers');
if (!/dispatch\('decide', \{ approve: false \}\)/.test(card)) fail('Nega stays');
const page = readFileSync('src/routes/topics/[tier]/[name]/+page.svelte', 'utf8');
const pin = page.indexOf('class="gate-pinned"'), stream = page.indexOf('<div class="stream" bind:this={stream}');
if (!(pin > 0 && stream > pin)) fail('the pinned gates sit above the stream, outside its scroll');
if (!/\.timeline \{[^}]*flex-direction: column/.test(page)) fail('the timeline stacks pinned bar and stream');
if (!/void refreshGateInfo\(\);/.test(page)) fail('a decision refreshes the queue, so the pin leaves');

console.log('gates: undecided ones pinned at the top, courier sends with three answers ✓');
