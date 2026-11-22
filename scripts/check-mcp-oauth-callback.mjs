#!/usr/bin/env node
/**
 * The MCP OAuth consent returns to the webui, and only the consent this tab
 * started is forwarded (clodia-platform#534).
 *
 * Before #534 the consent landed on a loopback URL nobody listened on and the
 * owner had to copy the address back into the card. Now the authorization
 * server sends the browser to `/tools/oauth/callback`, which forwards `code`
 * and `state` to the gateway. That page is the place where three mistakes
 * would cost the consent:
 *   - forwarding a `state` this tab never started (a link carrying someone
 *     else's `code` and `state`, CSRF on the consent);
 *   - forwarding the same one twice (a reload of the callback);
 *   - going back to an address read from the URL (an open redirect).
 *
 * The heart of this guard RUNS the module that decides (`src/lib/mcpOAuthReturn.js`)
 * against hostile inputs; it is not a search for words in this file. The text
 * checks on the page and on the client only make sure the module is the one
 * actually used.
 *
 * DECLARED LIMIT: the page checks read the TEXT of the files, not the rendered
 * DOM; the module checks are executed.
 */
import { leggiSorgente, senzaCommenti } from './lib/sorgente.mjs';
import {
	safeReturnPath,
	rememberPending,
	takePending,
	DEFAULT_RETURN,
	PENDING_TTL_MS
} from '../src/lib/mcpOAuthReturn.js';

const MODULE = 'src/lib/mcpOAuthReturn.js';
const CALLBACK = 'src/routes/tools/oauth/callback/+page.svelte';
const TOOLS = 'src/routes/tools/+page.svelte';
const CLIENT = 'src/lib/api/client.ts';

const guasti = [];

// ── 1. No open redirect: only a path of this webui ──────────────────────────
for (const ok of ['/tools', '/tools?tab=mcp', '/topics/P1/leads', '/packs/it-pack']) {
	if (safeReturnPath(ok) !== ok) guasti.push(`${MODULE}: «${ok}» is a legitimate return and was refused`);
}
for (const bad of [
	'https://evil.example/tools',
	'//evil.example/tools',
	'/\\evil.example',
	'\\\\evil.example',
	'javascript:alert(1)',
	'/tools\n/x',
	'/\tevil',
	'/tools/oauth/callback?code=x',
	'/toolsevil',
	'/admin',
	'/tools/../x',
	'http:/evil.example',
	'',
	null,
	42,
	'/' + 'a'.repeat(600)
]) {
	if (safeReturnPath(bad) !== DEFAULT_RETURN) {
		guasti.push(`${MODULE}: return target ${JSON.stringify(bad)} accepted — open redirect`);
	}
}

// ── 2. The state is bound to the tab, single use, with an expiry ────────────
function memoria() {
	const m = new Map();
	return {
		getItem: (k) => (m.has(k) ? m.get(k) : null),
		setItem: (k, v) => m.set(k, String(v)),
		removeItem: (k) => m.delete(k),
		size: () => m.size
	};
}
{
	const s = memoria();
	rememberPending(s, { state: 'S1', server: 'leads-mcp', returnTo: '/tools' }, 1000);
	if (takePending(s, 'FORGED', 1000) !== null) guasti.push(`${MODULE}: a state this tab never started is forwarded`);
	const first = takePending(s, 'S1', 1000);
	if (!first || first.server !== 'leads-mcp') guasti.push(`${MODULE}: the consent this tab started is not recognised`);
	if (takePending(s, 'S1', 1000) !== null) guasti.push(`${MODULE}: the same state is forwarded twice (replay)`);
	rememberPending(s, { state: 'S2', server: 'x', returnTo: '/tools' }, 1000);
	if (takePending(s, 'S2', 1000 + PENDING_TTL_MS + 1) !== null) guasti.push(`${MODULE}: an expired consent is forwarded`);
	if (s.size() !== 0) guasti.push(`${MODULE}: a refused or expired entry is left behind`);
	rememberPending(s, { state: 'S3', server: 'x', returnTo: 'https://evil.example' }, 1000);
	const third = takePending(s, 'S3', 1000);
	if (third?.returnTo !== DEFAULT_RETURN) guasti.push(`${MODULE}: a stored hostile return target survives`);
	if (takePending(null, 'S1') !== null) guasti.push(`${MODULE}: no storage must mean nothing forwarded`);
}

// ── 3. The page uses the module, and nothing else, to decide ─────────────────
const pagina = leggiSorgente(CALLBACK, guasti, 'the consent return page');
if (pagina !== null) {
	const c = senzaCommenti(pagina);
	for (const [ago, cosa] of [
		['takePending(', 'the state must be one this tab started, consumed before use'],
		['completeMcpOAuth(', 'the page forwards to the gateway'],
		['replaceState(', 'code and state leave the address bar'],
		['safeReturnPath(', 'the way back passes the allowlist'],
		['isAdmin', 'an admin session is required']
	]) {
		if (!c.includes(ago)) guasti.push(`${CALLBACK}: missing «${ago}» — ${cosa}`);
	}
	if (c.indexOf('takePending(') > c.indexOf('completeMcpOAuth(')) {
		guasti.push(`${CALLBACK}: the gateway is called before the tab binding is checked`);
	}
	if (/access_token|refresh_token/.test(c)) guasti.push(`${CALLBACK}: names a token — tokens live in the gateway vault`);
	if (/location\.(assign|replace)\(|location\.href\s*=/.test(c)) {
		guasti.push(`${CALLBACK}: navigates with window.location — the way back must go through goto(safeReturnPath(…))`);
	}
}

const tools = leggiSorgente(TOOLS, guasti, 'the Tools page');
if (tools !== null) {
	const c = senzaCommenti(tools);
	if (!c.includes('origin: window.location.origin')) guasti.push(`${TOOLS}: «Connetti» does not send its origin to oauth/start`);
	const r = c.indexOf('rememberPending(');
	const a = c.indexOf('window.location.assign(res.auth_url)');
	if (r < 0 || a < 0 || r > a) guasti.push(`${TOOLS}: the consent must be bound to the tab (rememberPending) before leaving`);
	if (!c.includes('openMcpOAuth(oauthServer, true)')) guasti.push(`${TOOLS}: the paste fallback disappeared`);
}

const client = leggiSorgente(CLIENT, guasti, 'the API client');
if (client !== null) {
	const c = senzaCommenti(client);
	const i = c.indexOf('export async function startMcpOAuth');
	const corpo = i < 0 ? '' : c.slice(i, c.indexOf('\n}\n', i) + 1);
	if (!/origin\?: string/.test(corpo) || !/oauth\/start`, body/.test(corpo)) {
		guasti.push(`${CLIENT}: startMcpOAuth does not forward origin/return_to to the gateway`);
	}
}

if (guasti.length) {
	console.error('MCP OAuth consent return:');
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log('MCP OAuth consent return: tab-bound single-use state, no open redirect, token never in the browser ✓');
