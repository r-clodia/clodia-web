#!/usr/bin/env node
/**
 * Who is who in a room: the participants panel shows owner, manager, staff,
 * deputy and acting manager from the SERVER rows (clodia-platform#497).
 *
 * The roles are derived in clodia-logic (`agents/display_roles.py`) and served
 * as `display_roles` by the channel route the page already calls. What can
 * break on this side, and what no type check sees:
 *  - the badges stop being rendered (the field arrives and nobody reads it);
 *  - someone «simplifies» by hardcoding the staff seeds in the page — then a
 *    new staff seed needs a UI change, which the issue rules out;
 *  - the ordering turns into a filter and a participant disappears (#190);
 *  - `contributor` comes back as a label next to everyone (removed by the
 *    owner on 12 Nov 2026).
 *
 * It runs the real functions of `src/lib/ruoliMostrati.js` on the acceptance
 * table of the issue, then checks that the page uses them.
 *
 * DECLARED LIMIT: the page part reads the TEXT of the page, not the DOM.
 *
 *     node scripts/check-ruoli-mostrati.mjs
 */
import { righePerNome, badgeDi, ordinaPerRuolo } from '../src/lib/ruoliMostrati.js';
import { leggiSorgente, senzaCommenti } from './lib/sorgente.mjs';

const PAGINA = 'src/routes/topics/[tier]/[name]/+page.svelte';
const CLIENT = 'src/lib/api/client.ts';
const guasti = [];

const testi = (row) => badgeDi(row).map((b) => b.testo).join(' · ');
const atteso = (caso, trovato, voluto) => {
	if (trovato !== voluto) guasti.push(`${caso}: atteso «${voluto}», trovato «${trovato}»`);
};

// ── 1. The acceptance table, as the server sends it (display_roles.py) ─────
const conClodia = [
	{ name: 'davide', display_role: 'owner', marks: [], role: 'owner', readonly: false, sort: 0 },
	{ name: 'clodia', display_role: 'manager', marks: [], role: 'contributor', readonly: false, sort: 1 },
	{ name: 'segretario', display_role: 'staff', marks: ['staff', 'deputy'], role: 'contributor', readonly: false, sort: 2 },
	{ name: 'messaggero', display_role: 'staff', marks: ['staff'], role: 'contributor', readonly: false, sort: 2 },
	{ name: 'sysadmin', display_role: 'staff', marks: ['staff'], role: 'contributor', readonly: false, sort: 2 },
	{ name: 'avvocato', display_role: 'contributor', marks: [], role: 'contributor', readonly: false, sort: 3 }
];
const r1 = righePerNome(conClodia);
// owner is rendered by the page's `role-fixed` label, not as a badge
atteso('davide (owner)', testi(r1.get('davide')), '');
atteso('clodia', testi(r1.get('clodia')), 'manager');
atteso('segretario con clodia', testi(r1.get('segretario')), 'staff · deputy');
atteso('messaggero', testi(r1.get('messaggero')), 'staff');
atteso('sysadmin', testi(r1.get('sysadmin')), 'staff');
atteso('avvocato (contributor: nessuna etichetta)', testi(r1.get('avvocato')), '');

// Same room without clodia: segretario leads as deputy, no other manager.
const senzaClodia = righePerNome([
	conClodia[0],
	{ name: 'segretario', display_role: 'manager', marks: ['staff', 'deputy', 'acting manager'], sort: 1 },
	conClodia[3], conClodia[4], conClodia[5]
]);
atteso('segretario senza clodia', testi(senzaClodia.get('segretario')), 'staff · deputy · acting manager');
const manager = [...senzaClodia.values()].filter((r) => badgeDi(r).some((b) => /manager/.test(b.testo)));
atteso('un solo manager senza clodia', manager.map((r) => r.name).join(','), 'segretario');

// A NEW staff seed is recognised from its row alone — no name list here.
atteso('seed staff nuovo', testi({ name: 'archivista', display_role: 'staff', marks: ['staff'] }), 'staff');
// reader (legacy) keeps a visible read-only mark next to the display role
atteso('sola lettura', testi({ name: 'x', display_role: 'contributor', marks: [], readonly: true }), 'sola lettura');
// older backend / malformed payload: no badges, no crash
if (righePerNome(undefined).size !== 0 || righePerNome({}).size !== 0 || righePerNome([null, 3]).size !== 0)
	guasti.push('righePerNome non tollera un payload assente o malformato');
atteso('riga assente', testi(undefined), '');

// ── 2. Ordering: owner, manager, staff, contributors; never a filter ───────
const dichiarati = ['avvocato', 'sysadmin', 'segretario', 'umano-senza-riga', 'clodia', 'messaggero', 'davide'];
const ordinati = ordinaPerRuolo(dichiarati, r1);
atteso('ordine', ordinati.join(','),
	'davide,clodia,sysadmin,segretario,messaggero,avvocato,umano-senza-riga');
if (ordinati.length !== dichiarati.length) guasti.push('ordinaPerRuolo ha tolto partecipanti (#190)');
atteso('senza righe resta l’ordine dichiarato', ordinaPerRuolo(dichiarati, new Map()).join(','), dichiarati.join(','));

// ── 3. The page uses the server rows ────────────────────────────────────────
const src = leggiSorgente(PAGINA, guasti, 'badge dei ruoli nella stanza');
if (src !== null) {
	const codice = senzaCommenti(src);
	if (!/righePerNome\(\s*info\?\.display_roles\s*\)/.test(codice))
		guasti.push(`${PAGINA}: le righe non vengono da \`info?.display_roles\``);
	if (!/\$:\s*participants\s*=\s*ordinaPerRuolo\(/.test(codice))
		guasti.push(`${PAGINA}: i partecipanti non sono ordinati con \`ordinaPerRuolo\` (owner, manager, staff, contributor)`);
	const corpo = codice.match(/\{#snippet corpo_participants\(\)\}([\s\S]*?)\{\/snippet\}/);
	if (!corpo) guasti.push(`${PAGINA}: snippet corpo_participants non trovato`);
	else {
		if (!/badgeDi\(ruoli\.get\(p\)\)/.test(corpo[1]))
			guasti.push(`${PAGINA}: il pannello Partecipanti non rende i badge (\`badgeDi(ruoli.get(p))\`)`);
		if (!/class="role-badge/.test(corpo[1]))
			guasti.push(`${PAGINA}: nessun \`role-badge\` nel pannello Partecipanti`);
	}
	if (!/invite-chip in">[^\n]*badgeDi\(ruoli\.get\(a\)\)/.test(codice))
		guasti.push(`${PAGINA}: il widget «Invita la squadra» non mostra i ruoli di chi è già nella stanza`);
	// No hardcoded staff list: the seed attribute is the only source.
	for (const nome of ['messaggero', 'sysadmin']) {
		if (new RegExp(`['"\`]${nome}['"\`]`).test(codice))
			guasti.push(`${PAGINA}: «${nome}» scritto nella pagina — lo staff lo dichiara il seed (staff: true), non la UI`);
	}
	if (/>\s*contributor\s*</.test(codice))
		guasti.push(`${PAGINA}: l'etichetta «contributor» è tornata (tolta il 12 nov 2026)`);
}

const cli = leggiSorgente(CLIENT, guasti, 'ChannelInfo.display_roles');
if (cli !== null && !/display_roles\?\s*:/.test(senzaCommenti(cli)))
	guasti.push(`${CLIENT}: ChannelInfo non dichiara \`display_roles\``);

if (guasti.length) {
	console.error('ruoli mostrati (#497):');
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log('Ruoli nella stanza: owner, manager, staff, deputy dal server, nessuna lista di nomi in pagina ✓');
