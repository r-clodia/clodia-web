#!/usr/bin/env node
// clodia-platform#641: «Add MCP server» can mount the servers FOR an installed
// pack (`POST /tools/mcp` with `pack`), so a zip-imported pack's pending
// servers become usable by its connector.
//
// The derivations in `$lib/mcpPack.js` are EXECUTED on fixtures; the client
// and the page are checked by text.
import { readFileSync } from 'node:fs';
import { nomiServerMcp, packPerServer, corpoRegistrazione } from '../src/lib/mcpPack.js';

const fail = (m) => { console.error('check-mcp-mount-for-pack: ' + m); process.exit(1); };
const page = readFileSync('src/routes/tools/+page.svelte', 'utf8');
const client = readFileSync('src/lib/api/client.ts', 'utf8');

// ── 1. derivations ─────────────────────────────────────────────────────────
const json = JSON.stringify({ mcpServers: { wa: { url: 'http://x' }, wa2: { command: 'y' } } });
if (nomiServerMcp(json).join(',') !== 'wa,wa2') fail('server names are not read from mcp.json');
if (nomiServerMcp('{not json').length !== 0) fail('an unparsable mcp.json must give no names');

const pk = (name, servers, extra = {}) => ({ name, plugins: [{ name: name + '-p', mcp_servers: servers.map((n) => ({ name: n })) }], ...extra });
const packs = [pk('whatsapp-pack', ['wa', 'wa2']), pk('half-pack', ['wa']), pk('other-pack', ['zz']), pk('off-pack', ['wa', 'wa2'], { disabled: true })];

const s = packPerServer(packs, ['wa', 'wa2']);
if (s.preselezione !== 'whatsapp-pack') fail('the pack declaring every server must be preselected');
if (s.opzioni.map((o) => o.name).sort().join(',') !== 'half-pack,whatsapp-pack') fail('only packs declaring at least one name are offered (disabled ones excluded)');

const ambiguo = packPerServer([pk('a', ['wa']), pk('b', ['wa'])], ['wa']);
if (ambiguo.preselezione !== '') fail('no preselection when two packs declare every server');

const nessuno = packPerServer(packs, ['unknown']);
if (nessuno.preselezione !== '' || nessuno.opzioni.length !== 3) fail('with no declaring pack, every enabled pack is offered and none preselected');

if ('pack' in corpoRegistrazione({}, '')) fail('`pack` must not be sent when not chosen');
if (corpoRegistrazione({}, 'whatsapp-pack').pack !== 'whatsapp-pack') fail('`pack` is not sent when chosen');

// ── 2. client ──────────────────────────────────────────────────────────────
if (!/registerMcp\(\s*body: \{[^}]*pack\?: string \}/.test(client)) fail('registerMcp does not type `pack`');

// ── 3. page ────────────────────────────────────────────────────────────────
if (!/registerMcp\(corpoRegistrazione\(parsed, mcpPack\)\)/.test(page)) fail('submitMcp does not send the chosen pack');
if (!/listPacks\(\)/.test(page)) fail('the dialog does not load the installed packs');
if (!/Appartiene al pack/.test(page) || !/<select bind:value=\{mcpPack\}/.test(page)) fail('no «Appartiene al pack» select');
if (!/<option value="">— nessuno —<\/option>/.test(page)) fail('the pack must be optional');
if (!/if \(!mcpPackTouched\) mcpPack = mcpScelta\.preselezione/.test(page)) fail('no automatic preselection');
if (!/err\.status === 409 && mcpPack/.test(page)) fail('a 409 does not suggest removing the server first');

console.log('mcp mount for pack: optional pack select, preselection, `pack` only when chosen, 409 hint ✓');
