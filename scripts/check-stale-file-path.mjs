#!/usr/bin/env node
// clodia-platform#598: a folder deleted while open must not strand the browser.
import { readFileSync } from 'node:fs';

const fail = (message) => {
	console.error(`check-stale-file-path: ${message}`);
	process.exit(1);
};
const page = readFileSync('src/routes/topics/[tier]/[name]/+page.svelte', 'utf8');

if (!/const requestedPath = filePath/.test(page))
	fail('loadFiles does not snapshot the requested path');
if (!/requestedPath && filePath === requestedPath/.test(page))
	fail('a stale response can overwrite later navigation');
if (!/filePath = ''[\s\S]*getChannelFiles\(tier, name\)/.test(page))
	fail('an invalid folder does not return to and reload the root');

console.log('check-stale-file-path: ok');
