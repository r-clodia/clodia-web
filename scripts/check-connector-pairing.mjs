#!/usr/bin/env node
// clodia-platform#639 (and the #638 display bit): a pack connector that
// declares `pairing:` gets an «Abbina» step on its Tools card; one that
// declares `relay:` shows its channel name.
//
// Two halves: the pure derivations in `connettori.js` are EXECUTED on a fixture
// registry; the client and the page are checked by text (API wired, plain-text
// rendering, polling that stops, no logging of the code).
import { readFileSync } from 'node:fs';
import { cardsDiTools, pairingFinito, etichettaPairing } from '../src/lib/connettori.js';

const fail = (m) => { console.error('check-connector-pairing: ' + m); process.exit(1); };
const page = readFileSync('src/routes/tools/+page.svelte', 'utf8');
const client = readFileSync('src/lib/api/client.ts', 'utf8');

// ── 1. derivations ─────────────────────────────────────────────────────────
const card = (extra) => ({
	id: 'demo', label: 'Demo', pack: 'demo-pack', namespace: 'demo', builtin: false,
	schemes: [], providers: [], verbs: [], topic_actions: [],
	tools_card: { setup_label: '', blurb: '', scope: '', icon: '', docs_url: '' },
	...extra
});
const [conPairing] = cardsDiTools({ connectors: [card({ pairing: true, relay: { label: 'SMS', attachments: false, schemes: ['sms'] } })] }, []);
if (conPairing.pairing !== true) fail('`pairing: true` does not reach the card model');
if (conPairing.relay?.label !== 'SMS') fail('`relay.label` does not reach the card model');
const [senza] = cardsDiTools({ connectors: [card({})] }, []);
if (senza.pairing !== false || senza.relay !== null) fail('a connector without pairing/relay must stay as before');
const [stringa] = cardsDiTools({ connectors: [card({ pairing: 'yes' })] }, []);
if (stringa.pairing !== false) fail('only a literal `pairing: true` turns pairing on');

for (const s of ['open', 'logged_out']) if (!pairingFinito({ state: s })) fail(`polling must stop on ${s}`);
if (!pairingFinito({ state: 'pairing', error: 'boom' })) fail('polling must stop on an error');
for (const s of ['pairing', 'connecting', 'starting', 'reconnecting', 'unpaired'])
	if (pairingFinito({ state: s })) fail(`polling must go on in ${s}`);
if (etichettaPairing('weird_new_state') !== 'weird_new_state') fail('an unknown state must be shown raw');

// ── 2. client ──────────────────────────────────────────────────────────────
if (!/export async function getConnectorPairing\(/.test(client)) fail('client: getConnectorPairing missing');
if (!/export async function startConnectorPairing\(/.test(client)) fail('client: startConnectorPairing missing');
if (!/apiGet<ConnectorPairing>\(`\/tools\/connectors\/\$\{encodeURIComponent\(id\)\}\/pairing`/.test(client)) fail('client: GET pairing route');
if (!/apiPost<ConnectorPairing>\(`\/tools\/connectors\/\$\{encodeURIComponent\(id\)\}\/pairing`/.test(client)) fail('client: POST pairing route');

// ── 3. page ────────────────────────────────────────────────────────────────
if (!/\{#if c\.pairing\}/.test(page)) fail('the card does not render the pairing row');
if (!/openPairing\(c\)/.test(page) || !/>\s*\{pairingStates\[c\.id\]\?\.state === 'open' \? 'Riabbina' : 'Abbina'\}/.test(page)) fail('no «Abbina» button on the card');
if (!/startConnectorPairing\(/.test(page) || !/getConnectorPairing\(/.test(page)) fail('the page does not call the pairing API');
if (!/PAIRING_POLL_MS = 3000/.test(page)) fail('polling is not every 3 s');
if (!/if \(pairingFinito\(st\)\) \{\s*stopPairingPoll\(\)/.test(page)) fail('polling does not stop on a final state');
if (!/function closePairing\(\) \{[^}]*stopPairingPoll\(\)/.test(page)) fail('closing the modal does not stop polling');
if (!/onDestroy\(\(\) => \{[^}]*stopPairingPoll\(\)/.test(page)) fail('leaving the page does not stop polling');
if (!/Collega con numero di telefono/.test(page)) fail('the phone instructions are missing');
if (!/Abbinato come/.test(page)) fail('the paired identity is not shown');
if (!/QRCode\.toDataURL\(st\.qr/.test(page)) fail('the QR is not rendered');
if (!/class="pair-code"[^>]*>\{pairStatus\.code\}<\/code>/.test(page)) fail('the code is not shown as plain monospace text');
const a = page.indexOf('{#if pairOpen && pairCard}');
const b = page.indexOf('{/if}', page.indexOf('class="modal-foot"', a));
if (a < 0 || b < 0) fail('pairing modal not found');
if (page.slice(a, b).includes('{@html')) fail('the pairing UI must not use {@html}');
if (/console\.\w+\([^)]*pair/i.test(page)) fail('the pairing code/state must not be logged');
if (/\{#if c\.relay\?\.label\}/.test(page) === false) fail('the relay channel name is not shown');

console.log('connector pairing: card model, API, plain-text code/QR, 3 s polling that stops, relay label ✓');
