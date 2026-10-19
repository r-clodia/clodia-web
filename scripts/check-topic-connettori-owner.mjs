#!/usr/bin/env node
/**
 * The topic page reads an OWNER-scoped connector listing, and a pack's
 * documentation link is a link only when it is https:// (review of #242).
 *
 * 1. **Topic page.** It used to draw its buttons from `GET /tools/connectors`,
 *    which the gateway serves to admins only. The proxy forwards the user's own
 *    session, so a non-admin topic owner got a silent 401 and lost the
 *    Telegram / Drive buttons they have on main, plus the egress placeholders.
 *    The page must read `GET /api/topics/{tier}/{name}/connectors`
 *    (clodia-logic#521), which the agent-server serves to the human topic
 *    owner or an admin, already reduced to what a topic page draws.
 * 2. **`docs_url`.** It comes from a pack manifest and ends up in an `href` on
 *    the Tools page, in the origin where the session token sits in
 *    localStorage. `javascript:` / `data:` would run there. Only `https://`
 *    becomes a link; anything else is shown as plain text. The gateway refuses
 *    such manifests too (clodia-tools#365): this is the second wall.
 *
 * Half of it EXECUTES `src/lib/connettori.js` on fixtures; the other half reads
 * the page and client source. LIMIT: the source half sees text, not rendering.
 */
import { leggiSorgente, senzaCommenti } from './lib/sorgente.mjs';
import * as connettori from '../src/lib/connettori.js';

const guasti = [];

// ── 1. docs_url: executed on fixtures ───────────────────────────────────────
const { linkDocumentazione, cardsDiTools } = connettori;
if (typeof linkDocumentazione !== 'function') {
	guasti.push('src/lib/connettori.js: manca «linkDocumentazione» — il link della documentazione non è filtrato');
} else {
	for (const cattivo of [
		'javascript:alert(document.cookie)',
		'JavaScript:alert(1)',
		' javascript:alert(1)',
		'data:text/html,<script>alert(1)</script>',
		'http://example.com/docs',
		'HTTPS://example.com/docs',
		'//example.com/docs',
		'/docs',
		'https:',
		'https://',
		'https://exa mple.com',
		'',
		undefined,
		null,
		42
	]) {
		if (linkDocumentazione(cattivo) !== '') {
			guasti.push(`linkDocumentazione(${JSON.stringify(cattivo)}) diventa un link: solo https:// lo è`);
		}
	}
	if (linkDocumentazione('https://example.com/docs') !== 'https://example.com/docs') {
		guasti.push('linkDocumentazione rifiuta un https:// valido');
	}
}

const carta = (docs_url) => ({
	connectors: [
		{
			id: 'p',
			label: 'P',
			schemes: [],
			providers: [],
			verbs: [],
			topic_actions: [],
			tools_card: { setup_label: '', blurb: '', scope: '', icon: '', docs_url }
		}
	]
});
const malevola = cardsDiTools(carta('javascript:alert(1)'), []).find((c) => c.id === 'p');
if (!malevola) {
	guasti.push('cardsDiTools non produce la card di prova');
} else {
	if (malevola.docsHref) guasti.push('una card con docs_url «javascript:» porta un href');
	if (malevola.docsUrl !== 'javascript:alert(1)') {
		guasti.push('il docs_url non https resta nella card come TESTO (docsUrl), non sparisce');
	}
}
const buona = cardsDiTools(carta('https://example.com/docs'), []).find((c) => c.id === 'p');
if (buona?.docsHref !== 'https://example.com/docs') {
	guasti.push('una card con docs_url https:// non porta il suo href');
}

const TOOLS = 'src/routes/tools/+page.svelte';
const tools = leggiSorgente(TOOLS, guasti, 'la pagina Tools');
if (tools !== null) {
	const codice = senzaCommenti(tools);
	if (/href=\{[^}]*docsUrl[^}]*\}/.test(codice)) {
		guasti.push(`${TOOLS}: «docsUrl» finisce in un href — va usato «docsHref», filtrato su https://`);
	}
	if (!/href=\{[^}]*docsHref[^}]*\}/.test(codice)) {
		guasti.push(`${TOOLS}: il link della documentazione non usa «docsHref»`);
	}
}

// ── 2. topic page: owner-scoped listing ────────────────────────────────────
const CLIENT = 'src/lib/api/client.ts';
const client = leggiSorgente(CLIENT, guasti, 'il client API');
if (client !== null) {
	const codice = senzaCommenti(client);
	const m = codice.match(/export async function getTopicConnectors\([\s\S]*?\n}/);
	if (!m) {
		guasti.push(`${CLIENT}: manca «getTopicConnectors» — la lettura owner-scoped dei connettori di un topic`);
	} else {
		if (!/\/api\/topics\//.test(m[0]) || !/\/connectors`/.test(m[0])) {
			guasti.push(`${CLIENT}: getTopicConnectors non chiama /api/topics/{tier}/{name}/connectors`);
		}
		if (/\/tools\/connectors/.test(m[0])) {
			guasti.push(`${CLIENT}: getTopicConnectors legge /tools/connectors, che è da admin`);
		}
	}
}

const TOPIC = 'src/routes/topics/[tier]/[name]/+page.svelte';
const topic = leggiSorgente(TOPIC, guasti, 'la pagina del topic');
if (topic !== null) {
	const codice = senzaCommenti(topic);
	if (/getConnectorRegistry|\/tools\/connectors/.test(codice)) {
		guasti.push(
			`${TOPIC}: legge ancora il registry da admin (/tools/connectors) — un owner ` +
				'non admin riceve 401 e perde i bottoni'
		);
	}
	if (!/getTopicConnectors\(\s*tier\s*,\s*name\s*\)/.test(codice)) {
		guasti.push(`${TOPIC}: non legge «getTopicConnectors(tier, name)»`);
	}
	if (!/azioniDiTopic\([^)]*isAdmin:\s*\$isAdmin/.test(codice)) {
		guasti.push(`${TOPIC}: le azioni admin_only non sono più filtrate su $isAdmin`);
	}
}

if (guasti.length) {
	console.error('connettori del topic (owner) e link di documentazione:');
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log(
	'connettori del topic: lettura owner-scoped, admin_only filtrate, ' +
		'docs_url link solo se https:// ✓'
);
