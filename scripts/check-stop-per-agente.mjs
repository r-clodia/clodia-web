#!/usr/bin/env node
/**
 * Il ⏹ vive nel box dell'agente, non nel composer (clodia-platform#403).
 *
 * Il difetto che questa guard impedisce di far tornare: un bottone «Stop» solo,
 * in fondo alla chat, che chiama l'interruzione del canale SENZA bersaglio. Con
 * più agenti al lavoro quel gesto non sa dire quale turno debba morire, quindi
 * li ferma tutti — distruggendo lavoro che nessuno aveva chiesto di fermare.
 *
 * È una regressione muta: rimettere quel bottone compila, passa i tipi e a
 * schermo sembra perfino più comodo. Si vede solo con due agenti attivi in
 * parallelo, cioè mai in un test di sviluppo con un agente solo.
 *
 * Tre controlli su DUE file indipendenti, nessuno dei quali è questo:
 *   1. `AgentLiveBox.svelte` deve OFFRIRE il controllo (evento `stop`), e i due
 *      bottoni devono restare fratelli: un <button> dentro un <button> non è
 *      HTML valido e il click sul ⏹ smette di essere distinguibile da quello
 *      che espande il box;
 *   2. la pagina del topic deve CABLARLO a un'interruzione con bersaglio;
 *   3. la pagina non deve più avere il bottone generico nel composer.
 *
 *     node scripts/check-stop-per-agente.mjs
 */
import { leggiSorgente, senzaCommenti } from './lib/sorgente.mjs';

const BOX = 'src/lib/components/AgentLiveBox.svelte';
const PAGINA = 'src/routes/topics/[tier]/[name]/+page.svelte';

const guasti = [];

const box = leggiSorgente(BOX, guasti, 'box di ragionamento con il suo ⏹');
if (box !== null) {
	const codice = senzaCommenti(box);
	if (!/dispatch\(\s*['"]stop['"]\s*,\s*agent\s*\)/.test(codice)) {
		guasti.push(
			`${BOX}: il box non emette stop con la propria etichetta. Senza il nome ` +
				`dell'agente chi ascolta deve indovinare quale box è stato premuto, ` +
				`che è l'ambiguità del bottone unico spostata di un livello`
		);
	}
	// Due bottoni FRATELLI. Il `.live-head` è un <button> che copre tutta la
	// riga: se il ⏹ ci finisce dentro, il markup non è valido e il browser lo
	// ricostruisce a modo suo.
	const testa = codice.match(/<button[\s\S]*?class="live-head"[\s\S]*?<\/button>/);
	if (!testa) {
		guasti.push(`${BOX}: non trovo il bottone .live-head — se l'intestazione è stata riscritta, riscrivi anche questa guard`);
	} else if (/<button/.test(testa[0].slice(testa[0].indexOf('>')))) {
		guasti.push(
			`${BOX}: c'è un <button> dentro il <button> dell'intestazione. HTML non ` +
				`valido: il ⏹ va accanto alla testa, non dentro`
		);
	}
	if (!/class="live-stop"/.test(codice)) {
		guasti.push(`${BOX}: manca il bottone .live-stop, cioè il ⏹ che la #403 chiede di avere nel box`);
	}
}

const pagina = leggiSorgente(PAGINA, guasti, 'chat del canale');
if (pagina !== null) {
	const codice = senzaCommenti(pagina);
	if (!/on:stop=/.test(codice)) {
		guasti.push(
			`${PAGINA}: <AgentLiveBox> non ascolta on:stop — il ⏹ esiste nel componente ` +
				`ma non ferma niente`
		);
	}
	// L'interruzione deve portare un bersaglio. `interruptChannel(tier, name)`
	// nudo è il «ferma tutti» che la issue toglie.
	const chiamate = [...codice.matchAll(/interruptChannel\(([^)]*)\)/g)].map((m) => m[1].trim());
	if (!chiamate.length) {
		guasti.push(`${PAGINA}: nessuna chiamata a interruptChannel: il ⏹ non arriva al server`);
	}
	for (const args of chiamate) {
		if (!/,[^,]*,/.test(args)) {
			guasti.push(
				`${PAGINA}: interruptChannel(${args}) non passa il bersaglio: senza il terzo ` +
					`argomento il server ferma TUTTA la stanza, che è il difetto della #403`
			);
		}
	}
	// Il bottone generico si cerca in TUTTA la pagina, non dentro il composer:
	// ritagliare il composer con un regex è fragile (il primo `</div>` chiude il
	// ritaglio molto prima del bottone, e il controllo passa verde a vuoto), e
	// comunque un «ferma tutto» senza bersaglio è lo stesso difetto ovunque stia.
	for (const [traccia, come] of [
		[/class="stop-btn"/, 'la classe .stop-btn'],
		[/\bstopTurn\b/, 'la funzione stopTurn()'],
		[/■\s*Stop/, 'il bottone «■ Stop»']
	]) {
		if (traccia.test(codice)) {
			guasti.push(
				`${PAGINA}: ${come} è di nuovo qui. Fermare «le risposte in corso» non dice ` +
					`quale turno muore: il controllo vive nel box di ciascun agente attivo`
			);
		}
	}
}

if (guasti.length) {
	console.error('stop per agente:');
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log('stop per agente: il ⏹ sta nel box e ferma quel turno, non la stanza ✓');
