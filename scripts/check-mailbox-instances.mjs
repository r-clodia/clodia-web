#!/usr/bin/env node
// clodia-platform#733: every mailbox is its own integration on the Tools page
// — its own card, status, test and on/off switch (human admin). The card
// model is EXECUTED; the page is checked by text.
import { readFileSync } from 'node:fs';
import { cardCasella, cardAggiungiCasella } from '../src/lib/connettori.js';

const fail = (m) => { console.error('check-mailbox-instances: ' + m); process.exit(1); };
const on = cardCasella({ id: 'mailbox:studio', label: 'studio@x.it', provider: 'mailbox', account: 'studio', connected: true, operational: true, enabled: true });
if (on.name !== 'studio@x.it' || on.account !== 'studio' || !on.mailbox || on.icon !== 'email') fail('a card per mailbox, named by its address');
const off = cardCasella({ id: 'mailbox:info', provider: 'mailbox', connected: true, operational: false, enabled: false, send_only: true });
if (off.enabled !== false || off.account !== 'info' || off.scope !== 'SMTP') fail('a switched-off, send-only mailbox');
if (!cardCasella({ id: 'mailbox:dev', provider: 'mailbox', colony: true }).blurb.includes('colonia')) fail('the colony mailbox says so');

// The old «Email» card stops listing the mailboxes and becomes «add one».
const vecchia = { id: 'mail', name: 'Email', gestisce: ['mailboxes'], accounts: ['carbonid', 'info', 'studio'], connected: true, operational: true, issues: [] };
const [add] = cardAggiungiCasella([vecchia, on]);
if (add.name !== 'Nuova casella email' || add.accounts.length || add.connected || !add.addOnly || !add.setupLabel.includes('Aggiungi')) fail('the Email card becomes «Nuova casella email», with no accounts');
if (cardAggiungiCasella([vecchia])[0] !== vecchia) fail('without per-mailbox rows (older gateway) the old card stays as it was');

const page = readFileSync('src/routes/tools/+page.svelte', 'utf8');
if (!/\{:else if c\.mailbox\}/.test(page)) fail('the mailbox card has its own actions');
if (!/testConn\(c\.id\)/.test(page)) fail('a Test per mailbox');
if (!/setMailboxEnabled\(c\.account, c\.enabled === false\)/.test(page)) fail('Accendi / Spegni per mailbox');
if (!/c\.mailbox && c\.enabled === false\) return 'Spenta'/.test(page)) fail('a switched-off mailbox reads «Spenta»');
if (!/removeMailboxCard\(c\)/.test(page)) fail('Rimuovi on each mailbox card');
if (!/c\.addOnly\) return 'Aggiungi'/.test(page)) fail('the add card reads «Aggiungi»');
const client = readFileSync('src/lib/api/client.ts', 'utf8');
if (!/\/tools\/email\/mailboxes\/\$\{encodeURIComponent\(account\)\}\/enabled/.test(client)) fail('the switch route');

console.log('mailboxes: one integration each, with test and on/off ✓');
