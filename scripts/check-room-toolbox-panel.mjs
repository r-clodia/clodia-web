#!/usr/bin/env node
/**
 * Il pannello «Strumenti» di una stanza (clodia-platform#609 R5).
 *
 * Due regressioni silenziose che questa guard esiste per fermare:
 *
 *   1. **un'eccezione letta come stringa.** Nel gateway è già successo (review
 *      di clodia-tools#429): `web.*` fra le eccezioni lasciava passare
 *      `web.fetch` e il pannello mostrava un divieto che non c'era. Qui lo
 *      stesso errore mostra il contrario — un agente marcato «incluso» che
 *      invece il verbo non ce l'ha — e dallo schermo non si distingue.
 *   2. **il marchio `gate` ricostruito nel frontend.** Il giorno in cui un
 *      verbo entra in `gate._DEFAULT_GATED_EXACT` una lista scritta qui resta
 *      indietro e il pannello promette silenzio dove ci sarà una card. Il
 *      marchio deve venire dal payload del gateway (`gated`).
 *
 * Tre controlli indipendenti: la funzione VERA eseguita sui casi che contano,
 * e due file di pagina che devono usarla e non rifare il lavoro a mano.
 *
 *     node scripts/check-room-toolbox-panel.mjs
 */
import { leggiSorgente, senzaCommenti } from './lib/sorgente.mjs';

const guasti = [];

let copre, gruppiToolbox, orfane;
try {
	({ copre, gruppiToolbox, orfane } = await import('../src/lib/toolbox.js'));
} catch (e) {
	guasti.push(`src/lib/toolbox.js non si importa (${e && e.message})`);
}
for (const [nome, fn] of [
	['copre', copre],
	['gruppiToolbox', gruppiToolbox],
	['orfane', orfane]
]) {
	if (typeof fn !== 'function') guasti.push(`src/lib/toolbox.js non esporta ${nome}`);
}

if (typeof copre === 'function') {
	// Un'eccezione morde per nome, per namespace o su tutto: la regola del
	// gateway (`room_tools._bites`), qui sui casi che la distinguono da un
	// confronto fra stringhe.
	const casi = [
		['nome esatto', 'email.send', ['email.send'], true],
		['namespace', 'email.send', ['email.*'], true],
		['tutto', 'email.send', ['*'], true],
		['un altro verbo dello stesso backend non morde', 'email.send', ['email.read'], false],
		['un altro namespace non morde', 'email.send', ['web.*'], false],
		['nessuna eccezione', 'email.send', [], false],
		['il wildcard di un altro backend non morde', 'web.fetch', ['email.*'], false],
		['spazi attorno alla voce', 'web.fetch', ['  web.fetch '], true]
	];
	for (const [nome, verbo, ecc, atteso] of casi) {
		const ok = copre(verbo, ecc) === atteso;
		if (!ok) guasti.push(`eccezione, ${nome}: copre(${verbo}, ${JSON.stringify(ecc)}) ≠ ${atteso}`);
		console.log(`${ok ? 'ok  ' : 'KO  '} eccezione, ${nome}`);
	}
}

if (typeof gruppiToolbox === 'function') {
	const enablable = { web: ['web.fetch', 'web.post'], cartografo: [] };
	const g = gruppiToolbox(enablable, ['web.*'], ['web.post']);
	const web = g.find((x) => x.ns === 'web');
	const mcp = g.find((x) => x.ns === 'cartografo');

	// Il marchio arriva dal payload, non da una regola riscritta qui.
	const post = web?.verbi.find((v) => v.verbo === 'web.post');
	const fetch_ = web?.verbi.find((v) => v.verbo === 'web.fetch');
	if (!post?.gated) guasti.push('un verbo nella lista `gated` del gateway non viene marcato');
	if (fetch_?.gated) guasti.push('un verbo che il gateway NON dice gated viene marcato lo stesso');
	if (!web?.tuttiHannoGate) {
		guasti.push('un `ns.*` che porta con sé un verbo gated non lo dice');
	}

	// Un `ns.*` acceso copre i verbi: devono apparire come dati dalla stanza,
	// non come spenti (e non si ri-abilitano uno per uno, sarebbe un doppione).
	if (!fetch_?.coperto || !post?.coperto) {
		guasti.push('con `web.*` acceso i verbi del backend non risultano coperti');
	}
	if (fetch_?.acceso) guasti.push('un verbo coperto dal wildcard risulta acceso di suo');

	// Un backend che non enumera i propri verbi resta nel pannello col solo
	// `ns.*`: niente verbi inventati, e niente namespace scomparso.
	if (!mcp) guasti.push('un backend senza verbi enumerabili sparisce dal pannello');
	if (mcp && mcp.verbi.length !== 0) guasti.push('inventati verbi per un backend che non li nomina');
	if (mcp && mcp.tutti !== 'cartografo.*') guasti.push('il wildcard di un backend non è `ns.*`');

	// L'invariante, detta a voce alta: il pannello offre SOLO ciò che il
	// gateway dichiara abilitabile. Un namespace di governance non arriva nel
	// payload, e il pannello non deve saperlo aggiungere da sé.
	if (gruppiToolbox({}, ['jobs.run'], []).length !== 0) {
		guasti.push('il pannello costruisce gruppi che il gateway non ha offerto');
	}
}

if (typeof orfane === 'function') {
	// Acceso nel meta ma il backend non c'è più: va mostrato, se no resta
	// concesso e invisibile — e non si può nemmeno togliere.
	const o = orfane({ web: ['web.fetch'] }, ['web.fetch', 'scomparso.verbo']);
	if (JSON.stringify(o) !== JSON.stringify(['scomparso.verbo'])) {
		guasti.push(`una voce accesa su un backend sparito non viene mostrata (${JSON.stringify(o)})`);
	}
}

// --------------------------------------------------------------- i due schermi

const PANNELLO = 'src/lib/components/TopicToolsPanel.svelte';
const pannello = leggiSorgente(PANNELLO, guasti, 'pannello Strumenti della stanza');
if (pannello !== null) {
	const codice = senzaCommenti(pannello);
	if (!/\bcopre\s*\(/.test(codice)) {
		guasti.push(
			`${PANNELLO}: le eccezioni non passano da copre(): confrontarle come stringhe ` +
				'è il difetto che la review di clodia-tools#429 ha già corretto nel gateway'
		);
	}
	if (!/gruppiToolbox\s*\(/.test(codice)) {
		guasti.push(`${PANNELLO}: i gruppi non vengono da gruppiToolbox()`);
	}
	if (!/box\?*\.gated|box\.gated/.test(codice)) {
		guasti.push(`${PANNELLO}: il marchio gate non viene dal payload del gateway`);
	}
	if (!/setChannelToolException\s*\(/.test(codice)) {
		guasti.push(`${PANNELLO}: non si possono impostare le eccezioni per agente (#609)`);
	}
}

const PAGINA = 'src/routes/topics/[tier]/[name]/+page.svelte';
const pagina = leggiSorgente(PAGINA, guasti, 'sezione Strumenti nella sidebar del topic');
if (pagina !== null) {
	const codice = senzaCommenti(pagina);
	if (!/<TopicToolsPanel\b/.test(codice)) {
		guasti.push(`${PAGINA}: la sidebar non monta TopicToolsPanel`);
	}
	// La rotta rifiuta la lettura a chi non è owner né admin: offrire la
	// sezione a tutti mostrerebbe un errore al posto di un pannello.
	if (!/isOwner \|\| \$isAdmin/.test(codice)) {
		guasti.push(`${PAGINA}: la sezione Strumenti non è ristretta a owner/admin`);
	}
}

const SETTINGS = 'src/routes/settings/+page.svelte';
const settings = leggiSorgente(SETTINGS, guasti, 'toolbox dei DM nelle impostazioni');
if (settings !== null) {
	const codice = senzaCommenti(settings);
	if (!/<DmToolboxPanel\b/.test(codice)) {
		guasti.push(`${SETTINGS}: le impostazioni non montano DmToolboxPanel (#609: toolbox dei DM)`);
	}
	if (!/canEdit=\{\$isAdmin\}/.test(codice)) {
		guasti.push(`${SETTINGS}: la toolbox dei DM è modificabile da chi non è admin`);
	}
}

if (guasti.length) {
	console.error('\ncheck-room-toolbox-panel: ' + guasti.length + ' problemi');
	for (const g of guasti) console.error(' - ' + g);
	process.exit(1);
}
console.log('room toolbox: eccezioni che mordono davvero, gate dal gateway, due schermi cablati ✓');
