#!/usr/bin/env node
// clodia-platform#510: one owner for document.title. The Sidebar sets the
// brand, a page its part (`<PageTitle part=…>`), the mention blink an
// override that, cleared, shows the CURRENT page title.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { composeTitle, blinkTitle } from '../src/lib/pageTitle.js';

const fail = (m) => { console.error('check-page-title-owner: ' + m); process.exit(1); };

if (composeTitle('Corso Confindustria', 'Clodia') !== 'Corso Confindustria · Clodia') fail('title is not «part · brand»');
if (composeTitle('', 'Acme') !== 'Acme') fail('without a part the title is the brand');
if (composeTitle('  x ', '') !== 'x · Clodia') fail('the brand defaults to Clodia and parts are trimmed');
if (blinkTitle('Acme') !== '● Mention — Acme') fail('the blink frame names the brand');

function walk(dir, out = []) {
	for (const f of readdirSync(dir)) {
		const p = join(dir, f);
		if (statSync(p).isDirectory()) walk(p, out);
		else if (/\.(svelte|ts|js)$/.test(f)) out.push(p);
	}
	return out;
}
const writers = [];
for (const p of walk('src')) {
	const t = readFileSync(p, 'utf8');
	if (/document\.title\s*=/.test(t) && !p.endsWith(join('stores', 'pageTitle.ts'))) writers.push(p);
	if (/<svelte:head>[\s\S]*?<title>/.test(t)) writers.push(p + ' (<svelte:head><title>)');
}
if (writers.length) fail('document.title has other writers: ' + writers.join(', '));

const topic = readFileSync('src/routes/topics/[tier]/[name]/+page.svelte', 'utf8');
if (!/<PageTitle part=\{info\?\.meta\?\.title \|\| name\} \/>/.test(topic)) fail('the topic page does not put its title in the tab');
const side = readFileSync('src/lib/components/Sidebar.svelte', 'utf8');
if (!/\$: setBrand\(prof\.branding\.name\);/.test(side)) fail('the Sidebar must set only the brand');
const blink = readFileSync('src/lib/stores/mentionNotifications.ts', 'utf8');
if (/blinkBaseTitle/.test(blink) || !/setTitleOverride\(null\)/.test(blink)) fail('the blink must restore from the store, not from a saved document.title');

console.log('page title: one owner, «part · brand», topic pages titled, blink restores the current title ✓');
