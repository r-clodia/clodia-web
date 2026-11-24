#!/usr/bin/env node
// clodia-platform#724: the topic's Participants are a right-edge tab like
// «Aiuto», not a sidebar section; same content and actions; the two tabs do
// not overlap.
import { readFileSync } from 'node:fs';

const fail = (m) => { console.error('check-participants-tab: ' + m); process.exit(1); };
const page = readFileSync('src/routes/topics/[tier]/[name]/+page.svelte', 'utf8');
const tab = readFileSync('src/lib/components/EdgeTabPanel.svelte', 'utf8');
const help = readFileSync('src/lib/components/ChatWidget.svelte', 'utf8');

if (/<summary>\s*<span>Partecipanti<\/span>/.test(page)) fail('the sidebar still has a «Partecipanti» section');
const use = page.match(/<EdgeTabPanel label="Partecipanti"[^>]*>([\s\S]*?)<\/EdgeTabPanel>/);
if (!use) fail('no Partecipanti tab');
if (!/\{@render corpo_participants\(\)\}/.test(use[1])) fail('the tab must show the same content as the former section');
const pos = page.match(/<EdgeTabPanel label="Partecipanti"[^>]*top="(\d+)%"/);
const helpTop = help.match(/\.cw-tab \{[^}]*top: (\d+)%/);
if (!pos || !helpTop) fail('tab positions not found');
// Both tabs are centred on their `top` and ~110px tall at most: 20% of a
// 600px viewport (120px) keeps them apart.
if (Math.abs(Number(pos[1]) - Number(helpTop[1])) < 20) fail('the Partecipanti tab overlaps «Aiuto»');
if (!/position: fixed; right: 0;/.test(tab) || !/\.etp-panel \{[\s\S]*position: fixed; right: 12px;/.test(tab)) fail('the tab must have the same shape as «Aiuto»');
if (!/on:click=\{\(\) => \(open = false\)\}/.test(tab) || !/e\.key === 'Escape'/.test(tab)) fail('the panel must close (× and Escape)');

// #729: the files the same way, and the three tabs apart from each other.
if (/<summary>\s*<span>File<\/span>/.test(page)) fail('the sidebar still has a «File» section');
const files = page.match(/<EdgeTabPanel label="File"[^>]*top="(\d+)%"[^>]*>([\s\S]*?)<\/EdgeTabPanel>/);
if (!files) fail('no File tab');
if (!/\{@render corpo_file\(\)\}/.test(files[2]) || !/downloadZip/.test(files[2])) fail('the File tab must hold the file browser and the zip export');
const tops = [Number(pos[1]), Number(helpTop[1]), Number(files[1])].sort((a, b) => a - b);
if (tops[1] - tops[0] < 20 || tops[2] - tops[1] < 20) fail(`the edge tabs overlap (${tops.join('%, ')}%)`);

console.log('edge tabs: Partecipanti and File like «Aiuto», same content, no overlap, closable ✓');
