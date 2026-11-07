#!/usr/bin/env node
/**
 * Cards/table view on Providers and Integrations, remembered per page in a
 * cookie and read before the first paint (clodia-platform#656).
 *
 * Runs the REAL helper (`src/lib/viewPref.js`), not a copy: default `cards`,
 * an invalid value falls back to `cards`, the cookie carries
 * `Path=/`, `SameSite=Lax` and `Max-Age=31536000`, and one page's choice does
 * not leak into another's.
 *
 * Then checks the wiring in the source: the app is a SPA (`ssr = false`), so
 * the only way to avoid a cards→table flicker is to read the cookie
 * synchronously while the page component initialises. A `readView` moved into
 * `onMount` would still "work" — one frame of the wrong layout, every time —
 * and no test would fail, hence the guard.
 *
 * DECLARED LIMIT: the wiring part reads source TEXT, not the rendered DOM.
 */
import { leggiSorgente, senzaCommenti } from './lib/sorgente.mjs';

const failures = [];
let mod;
try {
	mod = await import('../src/lib/viewPref.js');
} catch (e) {
	failures.push(`src/lib/viewPref.js does not import (${e && e.message})`);
}

if (mod) {
	const { parseView, serializeView, normalizeView, viewCookieName, DEFAULT_VIEW, VIEW_COOKIE_MAX_AGE } = mod;
	const cases = [
		['default is cards', DEFAULT_VIEW, 'cards'],
		['no cookie → cards', parseView('', 'providers'), 'cards'],
		['undefined cookie → cards', parseView(undefined, 'providers'), 'cards'],
		['stored table → table', parseView('a=1; clodia_view_providers=table; b=2', 'providers'), 'table'],
		['stored cards → cards', parseView('clodia_view_providers=cards', 'providers'), 'cards'],
		['invalid value → cards', parseView('clodia_view_providers=grid', 'providers'), 'cards'],
		['empty value → cards', parseView('clodia_view_providers=', 'providers'), 'cards'],
		['case matters: TABLE → cards', parseView('clodia_view_providers=TABLE', 'providers'), 'cards'],
		['other page does not leak', parseView('clodia_view_integrations=table', 'providers'), 'cards'],
		['per-page: integrations table', parseView('clodia_view_providers=cards; clodia_view_integrations=table', 'integrations'), 'table'],
		['prefix name does not match', parseView('xclodia_view_providers=table', 'providers'), 'cards'],
		['normalize junk → cards', normalizeView({}), 'cards'],
		['cookie name', viewCookieName('providers'), 'clodia_view_providers'],
		['cookie name is sanitised', viewCookieName('Pro;viders=x'), 'clodia_view_providersx'],
		['max-age is one year', VIEW_COOKIE_MAX_AGE, 31536000]
	];
	for (const [name, got, want] of cases) {
		const ok = got === want;
		if (!ok) failures.push(`${name}: ${JSON.stringify(got)} (expected ${JSON.stringify(want)})`);
		console.log(`${ok ? 'ok  ' : 'KO  '} ${name} → ${JSON.stringify(got)}`);
	}
	const c = serializeView('providers', 'table');
	const attrs = c.split(';').map((s) => s.trim());
	for (const [name, ok] of [
		['serialize: name=value first', attrs[0] === 'clodia_view_providers=table'],
		['serialize: Path=/', attrs.includes('Path=/')],
		['serialize: SameSite=Lax', attrs.includes('SameSite=Lax')],
		['serialize: Max-Age=31536000', attrs.includes('Max-Age=31536000')],
		['serialize: no Domain / Secure-only surprises', !attrs.some((a) => /^domain=/i.test(a))],
		['serialize: invalid value stored as cards', serializeView('providers', 'grid').startsWith('clodia_view_providers=cards;')],
		['round trip', parseView(serializeView('integrations', 'table').split(';')[0], 'integrations') === 'table']
	]) {
		if (!ok) failures.push(`${name}: ${c}`);
		console.log(`${ok ? 'ok  ' : 'KO  '} ${name}`);
	}
}

// The app really is a SPA: the approach below depends on it.
const layout = leggiSorgente('src/routes/+layout.ts', failures, 'SSR setting');
if (layout !== null && !/export const ssr = false/.test(layout)) {
	failures.push('src/routes/+layout.ts: ssr is no longer false — read the cookie in a server load instead');
}

const toggle = leggiSorgente('src/lib/components/ViewToggle.svelte', failures, 'view toggle');
if (toggle !== null && !/writeView\(page,/.test(senzaCommenti(toggle))) {
	failures.push('src/lib/components/ViewToggle.svelte: a change is not persisted with writeView');
}

for (const [file, page] of [
	['src/routes/providers/+page.svelte', 'providers'],
	['src/routes/tools/+page.svelte', 'integrations']
]) {
	const raw = leggiSorgente(file, failures, `${page} page`);
	if (raw === null) continue;
	const src = senzaCommenti(raw);
	const script = src.slice(0, src.indexOf('</script>'));
	if (!new RegExp(`^\\tlet view = readView\\('${page}'\\);`, 'm').test(script)) {
		failures.push(`${file}: the view is not read with readView('${page}') at component init — first paint would flicker`);
	}
	if (/onMount\([^)]*readView/s.test(script)) {
		failures.push(`${file}: readView inside onMount — the first paint uses the default layout`);
	}
	if (!new RegExp(`<ViewToggle page="${page}" bind:view />`).test(src)) {
		failures.push(`${file}: no <ViewToggle page="${page}" bind:view />`);
	}
	if (!/\{#if view === 'table'\}/.test(src) || !/<table class="tbl">/.test(src)) {
		failures.push(`${file}: no table renderer`);
	}
	// Same actions in both renderers: one snippet rendered twice.
	const renders = (src.match(/\{@render actions\(/g) ?? []).length;
	if (!/\{#snippet actions\(/.test(src) || renders < 2) {
		failures.push(`${file}: card and table do not share the actions snippet (renders: ${renders})`);
	}
}

if (failures.length) {
	console.error('cards/table view preference:');
	for (const f of failures) console.error(`  - ${f}`);
	process.exit(1);
}
console.log('cards/table view: cookie per page, read before first paint, same actions in both views ✓');
