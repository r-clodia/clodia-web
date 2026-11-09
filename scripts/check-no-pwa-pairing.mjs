#!/usr/bin/env node
/**
 * The PWA is retired (clodia-platform#657, epic #655): no Settings section
 * mints a pairing token any more, and the minting helper is gone.
 *
 * A pairing token was a 30-day `ckt1` session token signed in the browser and
 * carried to the phone in a QR code — a bearer that outlived every WebUI
 * session by 60x. The servers now reject that shape (clodia-logic and
 * clodia-tools `verify_session_token`); this check keeps the client from
 * minting it again.
 *
 * NOT affected: connector device pairing (`/tools/connectors/<id>/pairing`,
 * clodia-platform#639/#641) — same word, different feature. It is the witness
 * below: if it disappeared too, the removal went too far.
 *
 * DECLARED LIMIT: a check on source text, not on the rendered DOM.
 */
import { leggiSorgente, senzaCommenti } from './lib/sorgente.mjs';

const SETTINGS = 'src/routes/settings/+page.svelte';
const SESSION = 'src/lib/auth/session.ts';
const TYPES = 'src/lib/api/types.ts';
const INSTANCE = 'src/lib/stores/instance.ts';
const TOOLS = 'src/routes/tools/+page.svelte';
const CLIENT = 'src/lib/api/client.ts';

const FORBIDDEN = {
	[SETTINGS]: [
		['Dispositivo PWA', 'the title of the removed section'],
		['mintPairingToken', 'minting a pairing token from Settings'],
		['features.pwa', 'the feature flag that gated the section'],
		['clodia.pwa.pairing', 'the QR payload type'],
		['qrcode', 'the QR library, used here only by the pairing section']
	],
	[SESSION]: [
		['mintPairingToken', 'the pairing token helper'],
		['PAIRING_TTL', 'the 30-day lifetime of a pairing token']
	],
	[TYPES]: [['pwa:', 'the `features.pwa` profile flag']],
	[INSTANCE]: [['pwa:', 'the `features.pwa` default']]
};

const REQUIRED = {
	[TOOLS]: [["from 'qrcode'", 'the QR of connector device pairing (#639)']],
	[CLIENT]: [
		['getConnectorPairing', 'connector device pairing status (#639)'],
		['startConnectorPairing', 'connector device pairing start (#639)']
	]
};

const faults = [];

for (const [file, needles] of Object.entries(FORBIDDEN)) {
	const src = leggiSorgente(file, faults, 'PWA pairing surface removed');
	if (src === null) continue;
	const code = senzaCommenti(src);
	for (const [needle, what] of needles) {
		if (code.includes(needle)) faults.push(`${file}: «${needle}» is back — ${what}`);
	}
}

for (const [file, needles] of Object.entries(REQUIRED)) {
	const src = leggiSorgente(file, faults, 'what the removal must not touch');
	if (src === null) continue;
	for (const [needle, what] of needles) {
		if (!src.includes(needle)) faults.push(`${file}: «${needle}» is missing — ${what}`);
	}
}

if (faults.length) {
	console.error('PWA pairing in the webui:');
	for (const f of faults) console.error(`  - ${f}`);
	process.exit(1);
}
console.log('PWA pairing: no Settings section, no minting helper, no features.pwa; connector pairing intact ✓');
