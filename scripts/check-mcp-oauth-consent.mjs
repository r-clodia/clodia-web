#!/usr/bin/env node
/**
 * Un server MCP che vuole un consenso OAuth deve poterlo CHIEDERE, e finché non
 * l'ha avuto non deve risultare connesso.
 *
 * clodia-platform#532: i server MCP remoti protetti da OAuth (Lovable e simili)
 * non si potevano montare — `mcp.add` conosceva solo token statici. Ora il
 * gateway porta il consenso (`/tools/mcp/{name}/oauth/start|complete`) e dice,
 * per ogni backend, `auth: 'oauth'` e `authorized: true|false`.
 *
 * Il difetto che questo controllo impedisce è lo stesso che #451 ha già pagato
 * una volta, in un altro punto: la card dei backend MCP scriveva
 * `connected: true` COSTANTE — «montato» stampato come «funzionante». Su un
 * backend OAuth non ancora autorizzato quella riga è una bugia completa: la
 * card è verde, il bottone «Connetti» non c'è, e ogni chiamata di tool
 * fallisce con 401 senza che nessuno sappia che manca un consenso. Lo stato
 * deve venire dal gateway, e il bottone deve esistere.
 *
 * Tre fonti indipendenti, nessuna delle quali è questo file: la pagina
 * Integrations (dove si rende la card e si guida il consenso), il modulo che
 * costruisce le card (dove si decide se un backend è connesso) e il client API
 * (dove si compongono le due chiamate). La mappatura si è spostata nel modulo
 * con clodia-platform#520 — le card non si costruiscono più in pagina — e
 * questo controllo l'ha seguita invece di restare a guardare un punto vuoto.
 *
 * LIMITE DICHIARATO: è un controllo sul TESTO dei file, non sul DOM reso. Vede
 * che la card legge `x.authorized` e che il bottone c'è; non vede un CSS che lo
 * nasconda. Sopra questo soffitto serve un test di render, che in questo repo
 * non ha ancora un runner.
 */
import { leggiSorgente, senzaCommenti } from './lib/sorgente.mjs';
import { cardsDiTools } from '../src/lib/connettori.js';

const PAGINA = 'src/routes/tools/+page.svelte';
const MODULO = 'src/lib/connettori.js';
const CLIENT = 'src/lib/api/client.ts';

const guasti = [];

const pagina = leggiSorgente(PAGINA, guasti, 'la pagina Integrations');
if (pagina !== null) {
	const codice = senzaCommenti(pagina);
	for (const [ago, cosa] of [
		['startMcpOAuth', "l'avvio del consenso OAuth"],
		['completeMcpOAuth', 'la chiusura del consenso (code/URL incollata)'],
		['openMcpOAuth', 'il bottone che apre il dialog dalla card'],
		["c.auth === 'oauth'", 'la card distingue i backend OAuth dagli altri'],
		['authorized', 'lo stato del consenso letto dal gateway']
	]) {
		if (!codice.includes(ago)) guasti.push(`${PAGINA}: manca «${ago}» — ${cosa}`);
	}
	if (!/Da autorizzare/.test(codice)) {
		guasti.push(
			`${PAGINA}: nessuno stato «Da autorizzare» sulla card — senza, un consenso ` +
				'mancante è indistinguibile da un backend a posto'
		);
	}
	// Il token non si mostra MAI: la pagina maneggia la URL di consenso e il
	// code, non l'access token.
	if (/access_token/.test(codice)) {
		guasti.push(`${PAGINA}: nomina «access_token» — il token vive nel vault del gateway, non qui`);
	}
}

// Il cuore, ESEGUITO sul modulo che costruisce le card: un backend OAuth senza
// consenso NON è connesso. Un `connected: true` costante rimetterebbe
// esattamente il difetto — verde a prescindere dal consenso, e ogni chiamata
// che fallisce con 401 senza che nessuno sappia perché.
const mcp = (riga) => cardsDiTools({ connectors: [] }, [riga], {})[0];
const senzaConsenso = mcp({
	id: 'remoto', label: 'Remoto', provider: 'mcp', transport: 'http',
	auth: 'oauth', authorized: false, connected: false
});
if (senzaConsenso?.connected) {
	guasti.push(
		`${MODULO}: un backend MCP OAuth senza consenso risulta connesso — la card ` +
			'sarebbe verde e il bottone «Connetti» non comparirebbe'
	);
}
const conConsenso = mcp({
	id: 'remoto', label: 'Remoto', provider: 'mcp', transport: 'http',
	auth: 'oauth', authorized: true, connected: true
});
if (!conConsenso?.connected) {
	guasti.push(`${MODULO}: un backend MCP autorizzato risulta comunque da connettere`);
}
const stdio = mcp({ id: 'locale', label: 'Locale', provider: 'mcp', transport: 'stdio' });
if (!stdio?.connected) {
	guasti.push(`${MODULO}: un backend MCP senza OAuth non è più «montato»`);
}
if (!leggiSorgente(MODULO, guasti, 'il modulo che costruisce le card')) {
	// `leggiSorgente` ha già registrato il guasto: senza il modulo i tre
	// controlli qui sopra non avrebbero potuto girare.
}

const client = leggiSorgente(CLIENT, guasti, 'il client API');
if (client !== null) {
	const codice = senzaCommenti(client);
	for (const [fn, rotta] of [
		['startMcpOAuth', '/oauth/start'],
		['completeMcpOAuth', '/oauth/complete']
	]) {
		const i = codice.indexOf(`export async function ${fn}`);
		if (i < 0) {
			guasti.push(`${CLIENT}: manca «${fn}» — il consenso OAuth dei server MCP`);
			continue;
		}
		const corpo = codice.slice(i, codice.indexOf('\n}\n', i) + 1);
		if (!corpo.includes(rotta)) guasti.push(`${CLIENT}: «${fn}» non chiama più ${rotta}`);
		if (!corpo.includes('/tools/mcp/')) {
			guasti.push(`${CLIENT}: «${fn}» non è più sotto /tools/mcp/{name}`);
		}
	}
	// Il tipo che la pagina legge deve portare ENTRAMBI i campi: senza
	// `authorized`, «montato» torna a significare «usabile».
	for (const [ago, cosa] of [
		['auth?: string', 'il backend MCP dichiara di volere un consenso OAuth'],
		['authorized?: boolean', 'il consenso c’è ed è ancora spendibile']
	]) {
		if (!codice.includes(ago)) guasti.push(`${CLIENT}: manca «${ago}» — ${cosa}`);
	}
}

if (guasti.length) {
	console.error('consenso OAuth dei server MCP:');
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log(
	'consenso OAuth dei server MCP: stato dal gateway, bottone Connetti sulla card, token mai nel browser ✓'
);
