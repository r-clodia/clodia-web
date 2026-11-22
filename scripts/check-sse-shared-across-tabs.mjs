#!/usr/bin/env node
// clodia-platform#509: recent topics open in a new tab, and the tabs share ONE
// event stream. On a plain-http origin (HTTP/1.1, 6 connections per host) a
// stream per tab would starve every API call from the 7th tab on.
//
// `events-stream.ts` is bundled with esbuild (a stub in place of the API
// client) and loaded twice, as two tabs of one browser: fake Web Locks and
// BroadcastChannel are shared between them, like the real ones.
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const fail = (m) => { console.error('check-sse-shared-across-tabs: ' + m); process.exit(1); };
const tick = () => new Promise((r) => setTimeout(r, 0));

// ── the browser both tabs live in ──────────────────────────────────────────
const opened = [];               // one entry per apiSSE connection: {tab, closed, emit}
const channels = new Map();      // name -> Set<BroadcastChannel>
class FakeBC {
	constructor(name) { this.name = name; this.onmessage = null; (channels.get(name) ?? channels.set(name, new Set()).get(name)).add(this); }
	postMessage(data) {
		const copy = structuredClone(data);
		for (const c of channels.get(this.name)) if (c !== this) setTimeout(() => c.onmessage?.({ data: copy }), 0);
	}
	close() { channels.get(this.name)?.delete(this); }
}
const queue = [];                // pending lock requests
let holder = null;
const locks = {
	request(name, opts, cb) {
		return new Promise((resolve, reject) => {
			const req = { cb, resolve, reject };
			opts?.signal?.addEventListener('abort', () => {
				const i = queue.indexOf(req);
				if (i >= 0) { queue.splice(i, 1); reject(new Error('AbortError')); }
			});
			queue.push(req);
			grant();
		});
	}
};
function grant() {
	if (holder || !queue.length) return;
	holder = queue.shift();
	Promise.resolve(holder.cb()).then((v) => { const h = holder; holder = null; h.resolve(v); grant(); });
}
globalThis.BroadcastChannel = FakeBC;
Object.defineProperty(globalThis, 'navigator', { value: { locks }, configurable: true });
globalThis.window = globalThis;

// ── two tabs: the module bundled once, evaluated twice ─────────────────────
const out = await build({
	entryPoints: ['src/lib/stores/events-stream.ts'],
	bundle: true, write: false, format: 'esm', platform: 'neutral',
	external: ['svelte/store'],
	plugins: [{
		name: 'stub-client',
		setup(b) {
			b.onResolve({ filter: /^\$lib\/api\/client$/ }, () => ({ path: 'client', namespace: 'stub' }));
			b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
				contents: `export function apiSSE(path, onEvent, onError) {
					const c = { tab: globalThis.__tab, closed: false, emit: onEvent, fail: onError };
					globalThis.__opened.push(c);
					return () => { c.closed = true; };
				}`, loader: 'js'
			}));
		}
	}]
});
globalThis.__opened = opened;
const code = out.outputFiles[0].text;
const svelteStore = new URL(import.meta.resolve('svelte/store')).href;
async function tab(name) {
	globalThis.__tab = name;
	const src = code.replaceAll('"svelte/store"', JSON.stringify(svelteStore)) + `\n//${name}`;
	return import('data:text/javascript,' + encodeURIComponent(src));
}
const A = await tab('A');
const B = await tab('B');

const seen = { A: [], B: [] };
A.onEventStream((e) => seen.A.push(e.type));
B.onEventStream((e) => seen.B.push(e.type));

globalThis.__tab = 'A'; const releaseA = A.startEventStream(); await tick();
globalThis.__tab = 'B'; const releaseB = B.startEventStream(); await tick();

const live = () => opened.filter((c) => !c.closed);
if (live().length !== 1) fail(`two tabs opened ${live().length} streams, expected 1`);
const leader = live()[0];
leader.emit({ event: 'message', data: '', json: { type: 'channel_message', payload: { x: 1 } } });
await tick(); await tick();
if (seen.A.join() !== 'channel_message' || seen.B.join() !== 'channel_message') fail(`every tab must get the event once: A=${seen.A} B=${seen.B}`);

// The leader tab closes: the other tab takes over the stream.
releaseA(); await tick(); await tick();
if (!leader.closed) fail('the leaving leader must close its stream');
if (live().length !== 1) fail(`after the leader left, ${live().length} streams are open, expected 1`);
live()[0].emit({ event: 'message', data: '', json: { type: 'agent_activity', payload: {} } });
await tick(); await tick();
if (!seen.B.includes('agent_activity')) fail('the new leader does not deliver to its own tab');

releaseB(); await tick(); await tick();
if (live().length !== 0) fail('with no tab interested, no stream may stay open');

// ── the sidebar link ───────────────────────────────────────────────────────
const side = readFileSync('src/lib/components/Sidebar.svelte', 'utf8');
if (!/target=\{isActive\(topicHref\(t\), \$page\.url\.pathname\) \? undefined : '_blank'\}/.test(side)) fail('a recent topic does not open in a new tab (the active one excepted)');
if (!/rel=\{isActive\(topicHref\(t\), \$page\.url\.pathname\) \? undefined : 'noopener'\}/.test(side)) fail('the new tab must be opened with rel="noopener"');
// The session must survive a noopener tab: it lives in localStorage.
const sess = readFileSync('src/lib/auth/session.ts', 'utf8');
if (!/localStorage\.getItem\(LS_KEY\)/.test(sess)) fail('the session is no longer in localStorage: a noopener tab would come up logged out');

console.log('recent topics in a new tab; one event stream shared by every tab, handed over when the leader leaves ✓');
process.exit(0);
