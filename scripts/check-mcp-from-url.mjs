#!/usr/bin/env node
// clodia-platform#632: «Add MCP server» takes a bare URL as well as an
// mcp.json; the gateway turns the URL (and an mcp-remote wrapper) into an
// http backend. The derivations are EXECUTED; the page is checked by text.
import { readFileSync } from 'node:fs';
import { eUrlMcp, nomeDaUrl, corpoDaInput } from '../src/lib/mcpPack.js';

const fail = (m) => { console.error('check-mcp-from-url: ' + m); process.exit(1); };
const page = readFileSync('src/routes/tools/+page.svelte', 'utf8');
const client = readFileSync('src/lib/api/client.ts', 'utf8');

const URL_ = 'https://mcp.clickup.com/mcp';
if (!eUrlMcp(`  ${URL_} `) || eUrlMcp('{"mcpServers": {}}')) fail('a URL is not told apart from an mcp.json');
for (const [u, n] of [[URL_, 'clickup'], ['https://mcp.lovable.dev/', 'lovable'], ['https://api.example.org/x', 'example']]) {
	if (nomeDaUrl(u) !== n) fail(`the name of ${u} should be ${n}, got ${nomeDaUrl(u)}`);
}
const daUrl = corpoDaInput(URL_, '', 'some-pack');
if (daUrl.body?.config !== URL_ || daUrl.body?.name !== 'clickup' || 'pack' in daUrl.body) fail('a URL must go as {config: url, name} without a pack');
if (corpoDaInput(URL_, 'tasks', '').body?.name !== 'tasks') fail('a given name must win over the host');
const wrapped = JSON.stringify({ mcpServers: { clickup: { command: 'npx', args: ['-y', 'mcp-remote', URL_] } } });
if (!corpoDaInput(wrapped, '', '').body?.config?.mcpServers?.clickup) fail('an mcp-remote mcp.json must go to the gateway as is');
if (!corpoDaInput('nonsense', '', '').errore) fail('garbage must give an error');
for (const b of [daUrl.body, corpoDaInput(wrapped, '', 'p').body]) {
	if (b && 'secrets' in b) fail('no secret is ever asked at mount: they go through «Connetti»');
}
if (!corpoDaInput('{"x": 1}', '', '').errore) fail('an mcp.json without mcpServers must give an error');

if (!/name\?: string/.test(client) || !/notes\?: string\[\]/.test(client)) fail('registerMcp does not type `name` and `notes`');
if (!/Nome del server/.test(page) || !/bind:value=\{mcpNome\}/.test(page)) fail('no name field for a URL');
if (!/res\.notes/.test(page)) fail('the translation notes are not shown');
if (!/mcp-remote/.test(page) || !/URL o mcp\.json/.test(page)) fail('the dialog does not say a URL is accepted');

console.log('mcp from URL: URL told apart, name from host, mcp-remote passed through, notes shown ✓');
