#!/usr/bin/env node
// clodia-platform#734: a room connects mailboxes one by one from 🔌, like
// MCPs (`mailbox:<account>`), and each shows as a ✉️ chip in the chat input.
// With mailboxes connected, the old room-wide Email capability has no chip.
// The chips are EXECUTED; the popup is checked by text.
import { readFileSync } from 'node:fs';
import { connectedChips, isMailboxKey } from '../src/lib/connectedChips.js';

const fail = (m) => { console.error('check-room-mailboxes: ' + m); process.exit(1); };
const box = {
	mcp: { email: {}, 'mailbox:studio': {}, 'mailbox:info': {}, github: {} },
	mcp_catalogue: { 'mailbox:studio': { label: 'studio@x.it' }, github: { label: 'GitHub' } }
};
const chips = connectedChips(box, []);
const mail = chips.filter((c) => c.kind === 'mail');
if (mail.map((c) => c.label).join() !== 'info,studio@x.it') fail('one ✉️ chip per connected mailbox, named by its address (or account)');
if (!mail.every((c) => c.icon === '✉️')) fail('the mailbox icon');
if (chips.some((c) => c.id === 'email')) fail('with mailboxes connected, no Email chip');
if (!connectedChips({ mcp: { email: {} } }, []).some((c) => c.id === 'email')) fail('without mailboxes the Email chip stays');
if (!isMailboxKey('mailbox:x') || isMailboxKey('email')) fail('mailbox keys');

const popup = readFileSync('src/lib/components/ConnectPopup.svelte', 'utf8');
if (!/m\.kind === 'mailbox'/.test(popup)) fail('the popup lists the mailboxes');
if (!/r\.kind === 'mcp' \|\| r\.kind === 'mail'/.test(popup)) fail('a mailbox is connected like an MCP');
if (!/hasMailboxes && m\.id === 'email'/.test(popup)) fail('the old Email capability is not offered where mailboxes are');

console.log('room mailboxes: connected one by one from 🔌, ✉️ chips ✓');
