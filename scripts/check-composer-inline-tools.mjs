#!/usr/bin/env node
// clodia-platform#714: «attach» and «expand» sit inside the text field,
// small, bottom left; the typed text never runs under them.
import { readFileSync } from 'node:fs';

const fail = (m) => { console.error('check-composer-inline-tools: ' + m); process.exit(1); };
const page = readFileSync('src/routes/topics/[tier]/[name]/+page.svelte', 'utf8');

const box = page.match(/<div class="input-box">([\s\S]*?)<\/div>\s*<\/div>/);
if (!box) fail('no .input-box around the composer textarea');
const inner = box[1];
const ta = inner.indexOf('<textarea bind:this={composer}');
const tools = inner.indexOf('<div class="input-tools">');
if (ta < 0 || tools < 0 || tools < ta) fail('the textarea and, BELOW it, the tools row must both be inside .input-box');
if (!/class="clip"[\s\S]*class="expand-input"/.test(inner.slice(tools))) fail('attach and expand must be in the tools row, attach first');
if (!/aria-label="Allega file"/.test(inner)) fail('the attach button needs an aria-label');

const css = (sel) => (page.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}')) || [])[1] || '';
if (!/flex-direction: column/.test(css('.input-box'))) fail('.input-box must stack the textarea and the tools (no overlap)');
if (!/border:/.test(css('.input-box')) || !/border: none/.test(css('.composer .input-box textarea'))) fail('the frame belongs to .input-box, not to the textarea');
if (!/height: 22px/.test(css('.input-tools .clip, .input-tools .expand-input'))) fail('the buttons must be small (22px)');
if (/position: absolute/.test(css('.input-tools'))) fail('no absolute positioning: text would run under the buttons');

console.log('composer: attach and expand inside the field, small, bottom left, no overlap ✓');
