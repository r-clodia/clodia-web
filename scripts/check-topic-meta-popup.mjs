#!/usr/bin/env node
/**
 * The «Meta» popup of a topic renders WITHOUT any agent call
 * (clodia-platform#658).
 *
 * The popup is instant and free because its data comes from a plain read
 * route (`GET /api/topics/{tier}/{name}`): no turn, no tokens, nothing sent to
 * an inference provider. The failure this guards against is silent: someone
 * "enriches" the popup with a summary asked to an agent, and every click on
 * the button starts costing a turn.
 *
 * Also checked:
 *   - the deadline has no setter any more: it is derived from the to-do list,
 *     so `setTopicDeadline` must not come back in the client or the page;
 *   - the popup is reachable from the topic page AND from the topic card;
 *   - a 409 on a to-do write reloads the list (never a blind retry);
 *   - the raw meta.json on the topic page is for admins only.
 *
 * DECLARED LIMIT: a check on the TEXT, not on the rendered DOM.
 *
 *     node scripts/check-topic-meta-popup.mjs
 */
import { leggiSorgente, senzaCommenti } from './lib/sorgente.mjs';

const DIALOG = 'src/lib/components/TopicMetaDialog.svelte';
const CLIENT = 'src/lib/api/client.ts';
const PAGE = 'src/routes/topics/[tier]/[name]/+page.svelte';
const LIST = 'src/routes/topics/+page.svelte';

/** Anything that would make the popup start an agent turn. */
const NO_AGENT = [
	'postChannelMessage', 'sendChannelMessage', 'sendMessage', 'askAgent',
	'triggerAgent', '/clodia/chat', '/clodia/channels/', 'apiSSE'
];

const guasti = [];

const dialog = leggiSorgente(DIALOG, guasti, 'the Meta popup');
if (dialog !== null) {
	const code = senzaCommenti(dialog);
	for (const ago of NO_AGENT) {
		if (code.includes(ago)) guasti.push(`${DIALOG}: «${ago}» — the popup must not call an agent`);
	}
	for (const ago of ['getTopicMeta', 'addTopicTodo', 'updateTopicTodo', 'removeTopicTodo']) {
		if (!code.includes(ago)) guasti.push(`${DIALOG}: missing «${ago}»`);
	}
	if (!/status === 409/.test(code) || !/await load\(\)/.test(code)) {
		guasti.push(`${DIALOG}: a 409 on a to-do write must reload the list`);
	}
	if (!code.includes("import Modal from './Modal.svelte'")) {
		guasti.push(`${DIALOG}: the popup reuses Modal.svelte`);
	}
}

const client = leggiSorgente(CLIENT, guasti, 'API client');
if (client !== null) {
	const code = senzaCommenti(client);
	if (code.includes('setTopicDeadline')) guasti.push(`${CLIENT}: setTopicDeadline is back — the deadline is derived`);
	const m = code.match(/export async function getTopicMeta[\s\S]*?\n}/);
	if (!m) guasti.push(`${CLIENT}: getTopicMeta missing`);
	else if (!m[0].includes('apiGet') || !m[0].includes('/api/topics/')) {
		guasti.push(`${CLIENT}: getTopicMeta must be a plain GET on /api/topics/{tier}/{name}`);
	}
}

const page = leggiSorgente(PAGE, guasti, 'topic page');
if (page !== null) {
	const code = senzaCommenti(page);
	if (!code.includes('<TopicMetaDialog')) guasti.push(`${PAGE}: the Meta popup is not on the topic page`);
	if (code.includes('setTopicDeadline') || code.includes('type="date" bind:value={metaDeadlineDraft}')) {
		guasti.push(`${PAGE}: the owner's deadline editor is back — the to-do list replaces it`);
	}
	const raw = code.indexOf('<summary>meta.json</summary>');
	const gate = code.lastIndexOf('{#if $isAdmin}', raw);
	if (raw >= 0 && (gate < 0 || raw - gate > 200)) {
		guasti.push(`${PAGE}: the raw meta.json is for admins only`);
	}
}

const list = leggiSorgente(LIST, guasti, 'topic list');
if (list !== null) {
	const code = senzaCommenti(list);
	if (!code.includes('<TopicMetaDialog')) guasti.push(`${LIST}: the Meta popup is not on the topic card`);
	if (!code.includes('deadlineInfo(t.deadline)')) guasti.push(`${LIST}: the card no longer shows the deadline`);
}

if (guasti.length) {
	console.error('topic Meta popup:');
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log('topic Meta popup: plain read, no agent call, to-do list with 409 reload, deadline derived ✓');
