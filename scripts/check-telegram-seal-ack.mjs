#!/usr/bin/env node
/**
 * Collegare Telegram sopra il cap SEAL si può, ma l'owner deve prendersene atto
 * — e la domanda deve dire cosa sta accettando.
 *
 * clodia-platform#405: su un topic sopra SEAL-1 la rotta rispondeva 400 e
 * basta. Ora il cap è una domanda: con `accept_seal_downgrade` il collegamento
 * passa e la presa d'atto resta scritta nel meta del topic. Questo controllo
 * tiene in piedi i due modi in cui quella domanda può degradare in silenzio:
 *
 * 1. **la spunta sparisce ma il campo resta**, magari cablato a `true` per
 *    «sbloccare» il caso d'uso — e allora ogni collegamento accetta il
 *    downgrade per conto dell'owner, che non ha mai visto la frase;
 * 2. **la regola viene riscritta nel frontend** (`tier === 'SEAL-2'`, `cap`
 *    scritto a mano). Il «se chiedere» lo decide il server con
 *    `seal.requires_ack`: due copie della stessa policy sono due copie che un
 *    giorno diranno il contrario, e quella che conta non sarà quella letta
 *    dall'owner.
 *
 * Due fonti indipendenti, nessuna delle quali è questo file: la pagina del
 * topic (dove sta la spunta) e il client API (dove si compone la richiesta).
 *
 * LIMITE DICHIARATO: è un controllo sul TESTO dei file, non sul DOM reso. Vede
 * la spunta legata a `telegramAck` e il bottone che la rispetta, non una
 * conferma equivalente scritta in un componente separato. Sopra questo
 * soffitto serve un test di render, che in questo repo non ha ancora un runner.
 */
import { leggiSorgente, senzaCommenti } from './lib/sorgente.mjs';

const PAGINA = 'src/routes/topics/[tier]/[name]/+page.svelte';
const CLIENT = 'src/lib/api/client.ts';

const guasti = [];

const pagina = leggiSorgente(PAGINA, guasti, 'la pagina del topic');
if (pagina !== null) {
	const codice = senzaCommenti(pagina);
	for (const [ago, cosa] of [
		['telegramSeal', 'lo stato del cap letto dal server'],
		['requires_ack', 'il «se chiedere», che lo decide il server'],
		['bind:checked={telegramAck}', "la spunta della presa d'atto"]
	]) {
		if (!codice.includes(ago)) guasti.push(`${PAGINA}: manca «${ago}» — ${cosa}`);
	}
	// La spunta è una spunta: un `<input type="checkbox">` legato a
	// `telegramAck`. Senza, resta una variabile che qualcuno mette a true.
	if (!/<input[^>]*type="checkbox"[^>]*bind:checked=\{telegramAck\}/.test(codice)) {
		guasti.push(
			`${PAGINA}: «telegramAck» non è legata a una casella di spunta — la presa ` +
				"d'atto dev'essere un gesto dell'owner, non un valore di default"
		);
	}
	// Il default è «non accetto». `= true` in dichiarazione è esattamente il
	// modo in cui questa conferma smette di essere una conferma.
	if (/\blet telegramAck\s*=\s*true/.test(codice)) {
		guasti.push(
			`${PAGINA}: «telegramAck» nasce a true — il collegamento accetterebbe il ` +
				"downgrade per conto dell'owner"
		);
	}
	// Il bottone deve rispettarla: se resta abilitato, la spunta è decorativa.
	if (!/requires_ack\s*&&\s*!telegramAck/.test(codice)) {
		guasti.push(
			`${PAGINA}: «+ connetti» non è condizionato alla presa d'atto — la spunta ` +
				'non fermerebbe nulla'
		);
	}
	// La policy non si riscrive qui: il cap e i tier che tocca stanno nel
	// server, che li manda in `seal`.
	for (const copia of [/telegramSeal[^\n]*tier\s*===\s*['"]SEAL-/, /cap\s*[:=]\s*['"]SEAL-1['"]/]) {
		if (copia.test(codice)) {
			guasti.push(
				`${PAGINA}: il cap SEAL è deciso in pagina — la regola sta nel server, ` +
					'qui si mostra soltanto ciò che manda in «seal»'
			);
		}
	}
}

const client = leggiSorgente(CLIENT, guasti, 'il client API');
if (client !== null) {
	const codice = senzaCommenti(client);
	const i = codice.indexOf('export async function connectTelegramLink');
	if (i < 0) {
		guasti.push(`${CLIENT}: manca «connectTelegramLink» — il collegamento della chat`);
	} else {
		const corpo = codice.slice(i, codice.indexOf('\n}\n', i) + 1);
		if (!corpo.includes('accept_seal_downgrade')) {
			guasti.push(
				`${CLIENT}: «connectTelegramLink» non manda «accept_seal_downgrade» — la ` +
					"presa d'atto si fermerebbe nel browser"
			);
		}
		if (/accept_seal_downgrade\s*:\s*true/.test(corpo)) {
			guasti.push(
				`${CLIENT}: «accept_seal_downgrade» è cablato a true — accetterebbe il ` +
					"downgrade a ogni collegamento, senza che l'owner lo abbia detto"
			);
		}
		if (!/acceptSealDowngrade\s*=\s*false/.test(corpo)) {
			guasti.push(
				`${CLIENT}: «acceptSealDowngrade» non ha false come default — chi non ` +
					'dichiara niente non ha dichiarato niente'
			);
		}
	}
	for (const [ago, cosa] of [
		['requires_ack: boolean', 'il «se chiedere» che la pagina legge dal server'],
		['seal?: TelegramSealState', 'lo stato del cap nella risposta della rotta']
	]) {
		if (!codice.includes(ago)) guasti.push(`${CLIENT}: manca «${ago}» — ${cosa}`);
	}
}

if (guasti.length) {
	console.error("presa d'atto sul cap SEAL di Telegram:");
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log(
	"cap SEAL Telegram: la domanda la decide il server, la spunta è dell'owner, il default è no ✓"
);
