#!/usr/bin/env node
/**
 * La scheda dell'agente non può mostrare un sandbox che il runtime non applica
 * come se fosse in vigore.
 *
 * clodia-platform#296. `allow_read`, `deny_read`, `allow_write`,
 * `allow_shell_cmds` e `deny_shell_patterns` sono tradotti solo in
 * `.claude/settings.local.json`: su codex e opencode restano parole nel file.
 * `ophelia` (codex) ne dichiara cinque e tre, `messaggero` e `segretario`
 * (opencode) uno ciascuno — e questa pagina li stampava tutti in fila, come una
 * restrizione qualunque. Una restrizione raccontata e inesistente è peggio di un
 * campo assente: chi legge conclude che la shell è stretta e smette di
 * chiedersi se lo sia.
 *
 * Il server la verità la dice già (`sandbox_info.unenforced`, con i NOMI dei
 * campi). Il difetto qui è di consumo: il dato arriva e la pagina non lo legge.
 *
 * Perché una guard e non un test: in questo repo i test non ci sono, e comunque
 * il difetto non fallisce — OMETTE. Non c'è niente che si rompa: la sezione si
 * rende, è solo priva della riserva. Il controllo sta quindi sul call site.
 *
 * La marcatura è per CAMPO e non per sezione: `sandbox_info.unenforced` dice
 * quali, e un avviso che dice «il sandbox non è applicato» manda a cercare
 * quale — cioè restituisce la domanda invece della risposta.
 *
 * LIMITE DICHIARATO: come la guard gemella (`check-declared-capability-visible`)
 * questo legge il TESTO del componente, non il DOM reso. Una riscrittura che
 * ottiene lo stesso silenzio per un'altra strada — un helper che calcola la
 * marcatura altrove, un `{#if}` più a monte — passa verde. Copre la regressione
 * letterale, non ogni modo di tacere.
 */
import { readFileSync } from 'node:fs';

const PAGINA = 'src/routes/agents/[name]/+page.svelte';
const TIPI = 'src/lib/api/types.ts';

/** I cinque campi che la scheda stampa e che solo claude porta. */
const CAMPI = [
	'allow_read',
	'deny_read',
	'allow_write',
	'allow_shell_cmds',
	'deny_shell_patterns'
];

const guasti = [];

function leggi(file) {
	try {
		return readFileSync(file, 'utf8');
	} catch {
		guasti.push(`${file}: file assente — spostato, rinominato o mai creato`);
		return null;
	}
}

const pagina = leggi(PAGINA);
if (pagina !== null) {
	// 1. Il dato dev'essere LETTO. Senza questo, tutto il resto è decorazione.
	if (!/agent\?\.sandbox_info\?\.unenforced/.test(pagina)) {
		guasti.push(
			`${PAGINA}: la pagina non legge \`sandbox_info.unenforced\` — il server ` +
			'dice quali campi non sono applicati e la scheda non lo chiede');
	}

	// 2. Ogni campo stampato dev'essere marcabile SINGOLARMENTE. Un solo avviso
	//    per l'intera sezione direbbe che qualcosa non conta senza dire cosa.
	for (const campo of CAMPI) {
		if (!pagina.includes(`agent.sandbox.${campo}`)) continue;  // non stampato: niente da marcare
		if (!pagina.includes(`sandboxOff.has('${campo}')`)) {
			guasti.push(
				`${PAGINA}: \`${campo}\` è stampato ma non marcato quando il runtime non ` +
				'lo applica — si legge come una restrizione in vigore');
		}
	}

	// 3. La riserva deve NOMINARE il runtime. «non applicato» senza dire da chi
	//    lascia il lettore a chiedersi se valga per il suo caso, ed è la stessa
	//    domanda da cui l'issue è nata (stesso seed, tre runtime, tre esiti).
	if (!/non applicato da \{agent\.agent_sdk\}/.test(pagina)) {
		guasti.push(
			`${PAGINA}: la marcatura non nomina il runtime (\`agent_sdk\`) — «non ` +
			'applicato» da solo non dice a chi si riferisce');
	}

	// 4. Il riepilogo: la marcatura per campo si vede solo se si guarda il campo.
	//    Serve anche la riga che dice quanti sono, come già fa il gemello
	//    `native_tools_info.unenforced` due blocchi più sopra.
	if (!/sandboxOff\.size/.test(pagina)) {
		guasti.push(
			`${PAGINA}: manca il riepilogo dei campi non applicati — chi scorre la ` +
			'scheda senza fermarsi sulla sezione non vede niente');
	}
}

const tipi = leggi(TIPI);
if (tipi !== null && !/\bsandbox_info\?:/.test(tipi)) {
	guasti.push(
		`${TIPI}: il campo \`sandbox_info\` del payload agents non è tipizzato — ` +
		'la pagina lo leggerebbe come `any`, e un rename lato server passerebbe muto');
}

if (guasti.length) {
	console.error('sandbox dichiarato e non applicato, mostrato come se contasse:');
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log('scheda agente: i campi del sandbox non applicati sono marcati ✓');
