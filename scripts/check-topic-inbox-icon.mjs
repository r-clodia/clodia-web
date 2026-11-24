#!/usr/bin/env node
// clodia-platform#726: the /topics card has a 📧 that copies the room's inbox
// address; hover shows it; no icon for a room without an inbox.
import { readFileSync } from 'node:fs';

const fail = (m) => { console.error('check-topic-inbox-icon: ' + m); process.exit(1); };
const page = readFileSync('src/routes/topics/+page.svelte', 'utf8');
const types = readFileSync('src/lib/api/types.ts', 'utf8');

if (!/readonly inbox\?: string \| null;/.test(types)) fail('Topic does not type `inbox`');
const btn = page.match(/\{#if t\.inbox\}([\s\S]*?)\{\/if\}/);
if (!btn) fail('the 📧 must be shown only when the topic has an inbox');
if (!/title=\{t\.inbox\}/.test(btn[1])) fail('hover must show the address');
if (!/copyInbox\(t\.inbox \?\? ''\)/.test(btn[1]) || !/📧/.test(btn[1])) fail('the click must copy the same address');
if (!/navigator\.clipboard\.writeText\(addr\)/.test(page) || !/toastSuccess\('Copiato', addr\)/.test(page)) fail('copy with a «Copiato» feedback');

console.log('topic inbox: 📧 only with an inbox, tooltip = copied address, «Copiato» ✓');
