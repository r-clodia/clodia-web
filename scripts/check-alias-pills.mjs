#!/usr/bin/env node
/**
 * Alias pills in the chat input (clodia-platform#723).
 *
 * Promises checked:
 *  1. The pills come from the person's aliases: one per alias, labelled with
 *     the name (no `$`), none when there are no aliases. RUNS `$lib/aliasPills`.
 *  2. A click inserts the alias TEXT (never `$name`) at the caret, or appends
 *     when the input had no focus, and the caret ends after the text. RUNS it.
 *  3. A click never sends: the component calls no channel API, dispatches no
 *     send, and its buttons are `type="button"` (no form submit).
 *  4. Every chat input mounts it: the topic/DM composer (inside the field,
 *     above the textarea), the expanded editor and the helpdesk widget; the
 *     settings section feeds the shared store, so edits refresh the pills.
 *  5. The row never covers the buttons: no absolute positioning, one line that
 *     scrolls horizontally.
 *
 * DECLARED LIMIT: parts 1-2 run the real module; parts 3-5 read the TEXT of
 * the sources, not the rendered DOM.
 *
 *     node scripts/check-alias-pills.mjs
 */
import { leggiSorgente, senzaCommenti } from './lib/sorgente.mjs';
import { aliasPillList, insertAliasText } from '../src/lib/aliasPills.js';

const guasti = [];
const eq = (got, want, what) => {
	if (JSON.stringify(got) !== JSON.stringify(want)) guasti.push(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

// ── 1. pills from aliases ────────────────────────────────────────────────
eq(aliasPillList({ recap: 'fate summary e tldr' }), [{ name: 'recap', text: 'fate summary e tldr' }], 'one alias → one pill');
eq(aliasPillList({}), [], 'no aliases → no pills');
eq(aliasPillList(null), [], 'missing aliases → no pills');
eq(aliasPillList({ zeta: 'z', alfa: 'a', vuoto: '  ' }).map((p) => p.name), ['alfa', 'zeta'], 'sorted, empty text dropped');

// ── 2. insertion ─────────────────────────────────────────────────────────
const T = 'fate summary e tldr';
eq(insertAliasText('', T, 0, 0, false), { value: T, caret: T.length }, 'empty input');
eq(insertAliasText('ciao', T, 0, 0, false), { value: `ciao ${T}`, caret: 5 + T.length }, 'no focus → append (with a space)');
eq(insertAliasText('ciao mondo', T, 4, 4, true), { value: `ciao ${T} mondo`, caret: 5 + T.length }, 'focus → at the caret, caret after the text');
eq(insertAliasText('ciaoX mondo', T, 4, 4, true), { value: `ciao ${T} X mondo`, caret: 5 + T.length + 1 }, 'glued word → spaces on both sides');
eq(insertAliasText('ciao XX mondo', T, 5, 7, true), { value: `ciao ${T} mondo`, caret: 5 + T.length }, 'selection is replaced');
eq(insertAliasText('ciao ', T, 0, 0, true), { value: `${T} ciao `, caret: T.length + 1 }, 'at the start');
for (const r of [insertAliasText('x', T, 1, 1, true), insertAliasText('', T, 0, 0, false)]) {
	if (r.value.includes('$recap')) guasti.push('insertion must put the alias text, not `$recap`');
}

// ── 3. never sends ───────────────────────────────────────────────────────
const COMP = 'src/lib/components/AliasPills.svelte';
const comp = leggiSorgente(COMP, guasti, 'alias pills');
if (comp) {
	const code = senzaCommenti(comp);
	if (!/\{#if pills\.length\}/.test(code)) guasti.push(`${COMP}: the row must render only when there are pills`);
	if (!/aliasPillList\(\$channelAliases\)/.test(code)) guasti.push(`${COMP}: pills must come from the shared aliases store`);
	if (!/insert\(p\.text\)/.test(code)) guasti.push(`${COMP}: a click must insert the alias text (p.text)`);
	if (/insert\([^)]*p\.name/.test(code) || /['"`]\$['"`]\s*\+\s*p\.name|\$\{?\s*p\.name/.test(code.replace(/\{p\.name\}/g, ''))) guasti.push(`${COMP}: must not insert \`$name\``);
	if (!/title=\{p\.text\}/.test(code)) guasti.push(`${COMP}: the tooltip must show the full text`);
	if (/postChannelMessage|apiPost|dispatch\(\s*['"]send|requestSubmit|\.submit\(|\bsend\(/.test(code)) guasti.push(`${COMP}: a pill must never send`);
	const buttons = [...code.matchAll(/<button\b[^>]*>/g)].map((m) => m[0]);
	if (!buttons.length) guasti.push(`${COMP}: no pill button`);
	if (buttons.some((b) => !/type="button"/.test(b))) guasti.push(`${COMP}: pill buttons must be type="button"`);
	if (!/new Event\('input'/.test(code)) guasti.push(`${COMP}: must dispatch an input event so bind:value and on:input run`);
	if (!/setSelectionRange\(next\.caret, next\.caret\)/.test(code)) guasti.push(`${COMP}: the caret must end after the inserted text`);
	// ── 5. layout ──
	const style = comp.slice(comp.indexOf('<style'));
	if (/position:\s*(absolute|fixed)/.test(style)) guasti.push(`${COMP}: no absolute positioning, it would cover the buttons`);
	if (!/overflow-x:\s*auto/.test(style) || !/flex-wrap:\s*nowrap/.test(style)) guasti.push(`${COMP}: one row, horizontally scrollable`);
}

// ── 4. wiring ────────────────────────────────────────────────────────────
const PAGE = 'src/routes/topics/[tier]/[name]/+page.svelte';
const page = leggiSorgente(PAGE, guasti, 'topic composer');
if (page) {
	const code = senzaCommenti(page);
	const box = code.match(/<div class="input-box">([\s\S]*?)<\/div>/);
	if (!box) guasti.push(`${PAGE}: no .input-box around the composer`);
	else {
		const pills = box[1].indexOf('<AliasPills target={composer}');
		const ta = box[1].indexOf('<textarea bind:this={composer}');
		if (pills < 0 || ta < 0 || pills > ta) guasti.push(`${PAGE}: <AliasPills target={composer}> must sit inside .input-box, above the textarea`);
	}
	if (!/<AliasPills target=\{expandedComposer\}/.test(code)) guasti.push(`${PAGE}: the expanded editor must show the pills too`);
	if (!/expandChannelAliases\(draft, \$channelAliases\)/.test(code)) guasti.push(`${PAGE}: \`$name\` expansion must read the shared store`);
}
const WIDGET = 'src/lib/components/ChatWidget.svelte';
const widget = leggiSorgente(WIDGET, guasti, 'helpdesk widget');
if (widget && !/<AliasPills target=\{input\}/.test(senzaCommenti(widget))) guasti.push(`${WIDGET}: the helpdesk composer must show the pills`);
const SETTINGS = 'src/routes/settings/+page.svelte';
const settings = leggiSorgente(SETTINGS, guasti, 'alias settings');
if (settings && !/putChannelAliases\([\s\S]{0,200}?setChannelAliases\(aliases\)/.test(senzaCommenti(settings))) {
	guasti.push(`${SETTINGS}: after saving, the aliases must be pushed to the shared store (pills refresh without reload)`);
}

if (guasti.length) {
	console.error('check-alias-pills:\n  - ' + guasti.join('\n  - '));
	process.exit(1);
}
console.log('alias pills: from the aliases, insert the text not `$name`, never send, in every chat input ✓');
