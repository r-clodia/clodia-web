#!/usr/bin/env node
// clodia-platform#476: the goal's full text is never reachable ONLY through a
// `title` (which does not open on touch). The caption has a ↗ button, for
// every participant, that opens a Modal with the text, the state and its note,
// the strategy file and who pinned it; in strategy review the line itself
// links the strategy, so the owner approves knowing where it is.
import { readFileSync } from 'node:fs';

const fail = (m) => { console.error('check-goal-full-text: ' + m); process.exit(1); };
const page = readFileSync('src/routes/topics/[tier]/[name]/+page.svelte', 'utf8');

const cap = page.match(/<div class="goal-cap"[\s\S]*?\n\t\t\t\t<\/div>/);
if (!cap) fail('no goal caption');
const c = cap[0];
const trigger = c.indexOf('on:click={() => (goalAperto = true)}');
if (trigger < 0) fail('the caption has no button that opens the full text');
const owner = c.indexOf('{#if isOwner}');
if (owner >= 0 && owner < trigger && c.indexOf('{/if}', owner) > trigger) fail('the ↗ button must be outside {#if isOwner}: reading the goal is every participant\'s');
if (!/goal\.state === 'strategy-review' && goal\.strategy_path[\s\S]*?openSignedFile\(tier, name, goal\.strategy_path\)/.test(c)) fail('in strategy review the line must link the strategy file');

const modal = page.match(/<Modal open=\{goalAperto && !!goal\}[\s\S]*?<\/Modal>/);
if (!modal) fail('no Modal bound to goalAperto');
const m = modal[0];
for (const [needle, what] of [['{goal.text}', 'the full text'], ['goalStato.nota', 'the state note'],
	['goal.strategy_path', 'the strategy path'], ['goal.pinned_by', 'who pinned it'], ['#m-${goal.message_id}', 'the original message when truncated']]) {
	if (!m.includes(needle)) fail(`the popup does not show ${what}`);
}
if (!/\.goal-full \{[^}]*white-space: pre-wrap/.test(page)) fail('the full text must keep its line breaks (pre-wrap)');

console.log('goal: ↗ opens the full text for everyone; strategy linked in review; truncation points to the original ✓');
