// #511 — the live stream never carries the session token in its URL.
// EventSource cannot send headers, so it put `?token=` in the URL and every
// access log kept it in clear. The stream is a fetch reader with
// `Authorization: Bearer`, and nothing builds a `token=` query string.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const fail = (m) => { console.error('check-sse-token-header: ' + m); process.exit(1); };
const files = [];
const walk = (d) => {
	for (const n of readdirSync(d)) {
		const p = join(d, n);
		if (statSync(p).isDirectory()) walk(p);
		else if (/\.(ts|js|svelte)$/.test(n)) files.push(p);
	}
};
walk('src');
for (const f of files) {
	const s = readFileSync(f, 'utf8');
	if (/new\s+EventSource\s*\(/.test(s)) fail(`${f}: EventSource cannot send headers — use apiSSE`);
	if (/[?&]token=/.test(s)) fail(`${f}: a token in a query string ends up in access logs`);
}
const client = readFileSync('src/lib/api/client.ts', 'utf8');
const sse = client.slice(client.indexOf('export function apiSSE'));
if (!/Authorization\s*=\s*`Bearer \$\{tok\}`/.test(sse)) fail('apiSSE does not send Authorization');
console.log('sse: token in the Authorization header, never in a URL ✓');
