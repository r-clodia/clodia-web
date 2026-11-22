#!/usr/bin/env node
/**
 * The Strumenti panel shows the Email card (clodia-platform#697).
 *
 * Since #683 agents have no `email.*` verbs. The gateway (clodia-tools 2.185.0)
 * lists Email in `mcp_catalogue` again, as a room CAPABILITY:
 * `agent_verbs: false`, no verbs, no schemes. Authorising it only lets the
 * courier deliver the linked mailboxes' mail into the room. The webui must:
 *
 * - keep every catalogue entry: no filter on `verbs.length` or `agent_verbs`
 *   in the panel's `authorised`, the picker's list or the Connetti rows.
 *   An MCP with zero verbs is exactly the Email card;
 * - say what the card does instead of «0 verbi»: `mcpVerbsLabel` /
 *   `isCapabilityOnly` from the client, and the panel's courier hint;
 * - offer no resource rules on it (the gateway refuses rows on Email):
 *   «Regole avanzate» sits under `{#if !isCapabilityOnly(m)}`;
 * - keep the Email lists (Mittenti, Destinatari) in the card.
 *
 * Checked on the TEXT of the files.
 */
import { leggiSorgente } from './lib/sorgente.mjs';

const guasti = [];
const client = leggiSorgente('src/lib/api/client.ts', guasti);
const panel = leggiSorgente('src/lib/components/TopicToolsPanel.svelte', guasti, 'Strumenti');
const picker = leggiSorgente('src/lib/components/McpPicker.svelte', guasti, 'Autorizza MCP');
const connect = leggiSorgente('src/lib/components/ConnectPopup.svelte', guasti, 'Connetti');

if (client) {
	const i = client.indexOf('export interface McpInfo');
	const body = i >= 0 ? client.slice(i, client.indexOf('\n}', i)) : '';
	if (!/agent_verbs\?:\s*boolean/.test(body)) guasti.push('client.McpInfo: manca `agent_verbs?: boolean`');
	if (!/isCapabilityOnly\s*=\s*\(m: McpInfo\)\s*=>\s*m\.agent_verbs === false/.test(client))
		guasti.push('client: `isCapabilityOnly` deve valere `m.agent_verbs === false` (assente = verbi agli agenti)');
	if (!client.includes("'nessun verbo agli agenti'"))
		guasti.push('client.mcpVerbsLabel: una capacità senza verbi deve dirlo, non «0 verbi»');
}

const noFilter = (src, where) => {
	if (/\.filter\([^)]*(verbs\.length|agent_verbs|isCapabilityOnly)/.test(src))
		guasti.push(`${where}: il catalogo non va filtrato per verbi o agent_verbs — Email ne ha zero`);
};

if (panel) {
	if (!/\$:\s*authorised\s*=\s*Object\.keys\(box\?\.mcp \?\? \{\}\)\s*\.filter\(\(id\) => catalogue\[id\]\)/.test(panel))
		guasti.push('TopicToolsPanel: `authorised` deve tenere ogni MCP del catalogo autorizzato nella stanza');
	const authorisedDecl = panel.slice(panel.indexOf('$: authorised ='), panel.indexOf('$: authorised =') + 200);
	noFilter(authorisedDecl, 'TopicToolsPanel.authorised');
	if (!panel.includes('{mcpVerbsLabel(m)}')) guasti.push('TopicToolsPanel: la card deve usare mcpVerbsLabel');
	if (!panel.includes('Autorizza il corriere a consegnare in questo canale la posta'))
		guasti.push('TopicToolsPanel: la card Email deve dire che autorizza il corriere, non gli agenti');
	if (!/\{#if !isCapabilityOnly\(m\)\}\s*<details class="advanced">\s*<summary>Regole avanzate/.test(panel))
		guasti.push('TopicToolsPanel: «Regole avanzate» non va offerto su una capacità senza verbi');
	if (!/email:\s*\[[\s\S]*?title: 'Mittenti'[\s\S]*?title: 'Destinatari'/.test(panel))
		guasti.push('TopicToolsPanel: la card Email deve tenere le liste Mittenti e Destinatari');
}
if (picker) {
	noFilter(picker, 'McpPicker');
	if (!picker.includes('mcpVerbsLabel(m)')) guasti.push('McpPicker: deve usare mcpVerbsLabel');
}
if (connect) {
	noFilter(connect, 'ConnectPopup');
	if (!connect.includes('detail: mcpVerbsLabel(m)')) guasti.push('ConnectPopup: deve usare mcpVerbsLabel');
}

if (guasti.length) {
	console.error('check-email-capability-card: ' + guasti.length + ' guasti\n  - ' + guasti.join('\n  - '));
	process.exit(1);
}
console.log('check-email-capability-card: ok');
