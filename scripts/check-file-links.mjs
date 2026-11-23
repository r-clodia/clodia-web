#!/usr/bin/env node
// clodia-platform#725: file names printed by agents are links — only for
// files that exist for the reader (the listing the gateway serves already
// applies participation and clearance), spaces and special characters
// included. The derivations are EXECUTED; the page is checked by text.
import { readFileSync } from 'node:fs';
import { fileRefs, citedDirs, linkifyFileRefs, FILE_ROOTS } from '../src/lib/fileLinks.js';
import { build } from 'esbuild';

// The real renderer: the link must survive the markdown the page uses.
const out = await build({ entryPoints: ['src/lib/markdown.ts'], bundle: true, write: false,
	format: 'esm', platform: 'neutral', logLevel: 'silent' });
const { renderMarkdown } = await import('data:text/javascript,' + encodeURIComponent(out.outputFiles[0].text));

const fail = (m) => { console.error('check-file-links: ' + m); process.exit(1); };
const url = (p) => '/api/topics/SEAL-1/t/download?path=' + encodeURIComponent(p);
const pv = (p) => '/preview/SEAL-1/t?path=' + encodeURIComponent(p);
const ex = ['local/report finale.pdf', 'shared/fattura-2026.xml', 'local/sub/àccènto.md', 'files/a(1).csv'];
const has = new Set(ex);
const link = (t) => linkifyFileRefs(t, (p) => has.has(p), url, pv, FILE_ROOTS, ex);

if (!FILE_ROOTS.includes('local') || !FILE_ROOTS.includes('shared')) fail('local/ and shared/ must be roots');
for (const [txt, path] of [
	['ho scritto shared/fattura-2026.xml.', 'shared/fattura-2026.xml'],
	['vedi `local/report finale.pdf`', 'local/report finale.pdf'],
	['vedi local/report finale.pdf ora', 'local/report finale.pdf'],
	['in local/sub/àccènto.md trovi', 'local/sub/àccènto.md'],
	['tabella files/a(1).csv', 'files/a(1).csv'],
]) {
	const html = renderMarkdown(link(txt));
	const m = html.match(/href="([^"]*download\?path=[^"]*)"/);
	if (!m) fail(`no download link for «${txt}»: ${html}`);
	if (decodeURIComponent(m[1].split('path=')[1]) !== path) fail(`«${txt}» links the wrong file: ${m[1]}`);
}
if (/href/.test(renderMarkdown(link('manca: local/manca.pdf')))) fail('a path that does not exist must stay text');
if (/download/.test(link('```\ncat local/report finale.pdf\n```'))) fail('code blocks must stay code');
if (!/🔎/.test(link('local/sub/àccènto.md'))) fail('a previewable file keeps its preview lens');
if (!citedDirs('salvato in local/report finale.pdf').includes('local')) fail('the folder of a spaced name must be indexed');
if (fileRefs('nulla qui').length) fail('no references in plain text');

const page = readFileSync('src/routes/topics/[tier]/[name]/+page.svelte', 'utf8');
if (!/getChannelFiles\(tier, name, d\)/.test(page)) fail('existence must come from the gateway listing of each cited folder');
if (!/linkifyFiles\(stripChoices\(splitQuote\(m\.text\)\.body\), fileIndex\)/.test(page)) fail('messages are not linkified against the file index');
if (!/linkifyFiles\(stripChoices\(live\.reply\), fileIndex\)/.test(page)) fail('the live reply is not linkified');

console.log('file links: existing files only, spaces and accents, code untouched, gateway listing ✓');
