#!/usr/bin/env node
// clodia-platform#639 (and the #638 display bit): a pack connector that
// declares `pairing:` gets an «Abbina» step on its Tools card; one that
// declares `relay:` shows its channel name.
//
// Two halves: the pure derivations in `connettori.js` are EXECUTED on a fixture
// registry; the client and the page are checked by text (API wired, plain-text
// rendering, polling that stops, no logging of the code).
import { readFileSync } from 'node:fs';
import { cardsDiTools, pairingFinito, etichettaPairing, pairingDaErrore, messaggioErrorePairing, azioniDiTopic, AVVISO_GRUPPO } from '../src/lib/connettori.js';

const fail = (m) => { console.error('check-connector-pairing: ' + m); process.exit(1); };
const page = readFileSync('src/routes/tools/+page.svelte', 'utf8');
const panel = readFileSync('src/lib/components/TopicToolsPanel.svelte', 'utf8');
const topic = readFileSync('src/routes/topics/[tier]/[name]/+page.svelte', 'utf8');
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
for (const s of ['pairing', 'connecting'])
	if (pairingFinito({ state: s, error: 'transient' })) fail(`a transient error in ${s} must not stop polling`);
if (!pairingFinito({ state: 'unpaired', error: 'boom' })) fail('an error outside an active state ends polling');

// 4xx bodies passed through by the gateway become meaningful messages.
const p409 = pairingDaErrore(JSON.stringify({ state: 'open', me: '+39 333' }));
if (!messaggioErrorePairing(409, p409).includes('Già abbinato come +39 333')) fail('409 must say «Già abbinato come {me}»');
if (!messaggioErrorePairing(412, pairingDaErrore(JSON.stringify({ state: 'unpaired', error: 'no phone' }))).startsWith('Inserisci prima il numero')) fail('412 must ask for the number first');
if (pairingDaErrore('<html>') !== null) fail('a non-JSON body is not a pairing payload');

// Group links of a relay connector carry the warning; others do not.
const reg = { connectors: [
	card({ id: 'relay', relay: { label: 'SMS' }, topic_actions: [{ id: 'link', label: 'Collega', binding: 'channel', admin_only: false, fields: [] }] }),
	card({ id: 'gform', schemes: [{ scheme: 'x', forms: [{ label: 'gruppo', example: 'g:123' }] }], topic_actions: [{ id: 'link', label: 'Collega', binding: 'channel', admin_only: false, fields: [] }] }),
	card({ id: 'plain', topic_actions: [{ id: 'link', label: 'Collega', binding: 'channel', admin_only: false, fields: [] }] })
] };
const az = Object.fromEntries(azioniDiTopic(reg, { isAdmin: true }).map((a) => [a.connettore, a]));
if (!az.relay.gruppi || !az.gform.gruppi) fail('a relay / `g:` connector link must be flagged as admitting groups');
if (az.plain.gruppi) fail('a connector without relay or `g:` forms must not carry the group warning');
if (!AVVISO_GRUPPO.startsWith('Collegare un gruppo ammette tutti i suoi membri')) fail('group warning text changed');
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
if (!/\{#if pairingStates\[c\.id\]\?\.state !== 'open'\}\s*<button[^\n]*openPairing\(c\)[^\n]*>Abbina<\/button>/.test(page)) fail('«Abbina» must be on the card and hidden once paired');
if (/Riabbina/.test(page)) fail('no «Riabbina» once paired: pairing again could unlink the device');
if (!/pairingDaErrore\(err\.body\)/.test(page) || !/messaggioErrorePairing\(err\.status/.test(page)) fail('refused pairing requests are not explained');
if (!/startConnectorPairing\(/.test(page) || !/getConnectorPairing\(/.test(page)) fail('the page does not call the pairing API');
if (!/PAIRING_POLL_MS = 3000/.test(page)) fail('polling is not every 3 s');
if (!/if \(pairingFinito\(st\)\) \{\s*stopPairingPoll\(\)/.test(page)) fail('polling does not stop on a final state');
if (!/function closePairing\(\) \{[^}]*stopPairingPoll\(\)/.test(page)) fail('closing the modal does not stop polling');
if (!/catch \(err\) \{\s*\/\/[^\n]*\n\s*stopPairingPoll\(\)/.test(page)) fail('a 4xx/5xx while polling must stop polling');
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

// ── 4. topic: group warning near the link action ──────────────────────────
if (!/a\.gruppi && !statiCanale\[a\.chiave\]\?\.connected/.test(panel) || !/\{AVVISO_GRUPPO\}/.test(panel)) fail('the topic link button does not warn about groups');
if (!/\{#if azioneAperta\?\.gruppi\}/.test(topic) || !/\{AVVISO_GRUPPO\}/.test(topic)) fail('the link dialog does not warn about groups');

console.log('connector pairing: card model, API, plain-text code/QR, 3 s polling that stops, 4xx explained, relay label, group warning ✓');
