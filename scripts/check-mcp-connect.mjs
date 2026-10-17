#!/usr/bin/env node
/**
 * La credenziale di un backend MCP si chiede al «Connetti» della card, mai al
 * mount (clodia-platform#565, decisione dell'owner del 17 ott 2026).
 *
 * Il difetto che questo controllo impedisce ha due facce:
 *   1. un backend che dichiara un metodo di connessione e non l'ha ancora
 *      usato risulta verde («MCP montato» = connesso) e ogni chiamata fallisce;
 *   2. il dialogo «Add MCP» torna a chiedere i segreti al mount, e un pack —
 *      che quel dialogo non lo apre mai — resta senza modo di connettersi.
 *
 * LIMITE DICHIARATO: è un controllo sul TESTO dei file e sul modulo che
 * costruisce le card, non sul DOM reso.
 */
import { leggiSorgente, senzaCommenti } from './lib/sorgente.mjs';
import { cardsDiTools } from '../src/lib/connettori.js';

const PAGINA = 'src/routes/tools/+page.svelte';
const CLIENT = 'src/lib/api/client.ts';
const guasti = [];

const pagina = leggiSorgente(PAGINA, guasti, 'la pagina Integrations');
if (pagina !== null) {
	const codice = senzaCommenti(pagina);
	for (const [ago, cosa] of [
		['openMcpConnect', 'il «Connetti» generico dalla card'],
		['connectMcp(', 'la chiamata che prova e salva la credenziale'],
		['disconnectMcp(', 'il «Disconnetti»'],
		['authMethods', 'i metodi dichiarati dal backend']
	]) {
		if (!codice.includes(ago)) guasti.push(`${PAGINA}: manca «${ago}» — ${cosa}`);
	}
	if (/secretValues|secrets\s*[:}]/.test(codice)) {
		guasti.push(`${PAGINA}: «Add MCP» chiede di nuovo i segreti al mount — vanno chiesti al «Connetti»`);
	}
}

const client = leggiSorgente(CLIENT, guasti, 'il client API');
if (client !== null) {
	for (const rotta of ['/connect`', '/disconnect`']) {
		if (!client.includes(rotta)) guasti.push(`${CLIENT}: manca la rotta ${rotta}`);
	}
}

// Il modulo delle card: un backend con un metodo e senza connessione è ROSSO.
const [card] = cardsDiTools(null, [{
	id: 'invoicetronic', provider: 'mcp', transport: 'http', connected: false,
	auth: 'oauth', authorized: false, auth_active: null,
	auth_methods: [{ type: 'oauth', scope: 'invoicetronic:read' },
		{ type: 'credential', fields: [{ name: 'APIKEY', label: 'API key', secret: true }] }]
}], { ammessi: null });
if (!card) guasti.push('connettori.js: il backend MCP non produce una card');
else {
	if (card.connected) guasti.push('connettori.js: backend con metodi e senza connessione risulta connesso');
	if ((card.authMethods ?? []).length !== 2) guasti.push('connettori.js: la card perde i metodi del «Connetti»');
}
const [semplice] = cardsDiTools(null, [{ id: 'plain', provider: 'mcp', transport: 'stdio' }], { ammessi: null });
if (!semplice?.connected) guasti.push('connettori.js: un backend senza metodi deve restare «montato» (connesso)');

if (guasti.length) {
	console.error('check-mcp-connect: ' + guasti.length + ' guasti');
	for (const g of guasti) console.error('  - ' + g);
	process.exit(1);
}
console.log('check-mcp-connect: ok');
