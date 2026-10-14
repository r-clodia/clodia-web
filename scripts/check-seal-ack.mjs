#!/usr/bin/env node
/**
 * Collegare un canale sopra il cap SEAL si può, ma l'owner deve prendersene
 * atto — e la domanda deve dire cosa sta accettando.
 *
 * Sostituisce `check-telegram-seal-ack.mjs`, che teneva questa invariante su
 * Telegram perché Telegram era l'unico canale cablato in pagina
 * (clodia-platform#405). Dal #520 il bottone lo dichiara il manifest e il
 * dialog è uno per tutti: una regola scritta sul nome «telegram» proteggerebbe
 * l'unico connettore che oggi esiste, e il prossimo canale che arriva con un
 * pack passerebbe senza chiedere niente a nessuno.
 *
 * I due modi in cui la domanda può degradare in silenzio sono gli stessi:
 *
 * 1. **la spunta sparisce ma il campo resta**, magari cablato a `true` per
 *    «sbloccare» il caso d'uso — e allora ogni collegamento accetta il
 *    downgrade per conto dell'owner, che non ha mai visto la frase;
 * 2. **la regola viene riscritta nel frontend** (`tier === 'SEAL-2'`, `cap`
 *    dedotto in pagina). Il «se chiedere» lo decide il server con
 *    `seal.requires_ack`: due copie della stessa policy sono due copie che un
 *    giorno diranno il contrario, e quella che conta non sarà quella letta
 *    dall'owner.
 *
 * Due fonti indipendenti, nessuna delle quali è questo file: la pagina del
 * topic (dove sta la spunta) e il client API (dove si compone la richiesta).
 *
 * LIMITE DICHIARATO: è un controllo sul TESTO dei file, non sul DOM reso. Vede
 * la spunta legata ad `azioneAck` e il bottone che la rispetta, non una
 * conferma equivalente scritta in un componente separato.
 */
import { leggiSorgente, senzaCommenti } from './lib/sorgente.mjs';

const PAGINA = 'src/routes/topics/[tier]/[name]/+page.svelte';
const CLIENT = 'src/lib/api/client.ts';

const guasti = [];

const pagina = leggiSorgente(PAGINA, guasti, 'la pagina del topic');
if (pagina !== null) {
	const codice = senzaCommenti(pagina);
	for (const [ago, cosa] of [
		['azioneStato.seal?.requires_ack', 'il «se chiedere», che lo decide il server'],
		['bind:checked={azioneAck}', "la spunta della presa d'atto"],
		['azioneAck = false', 'la presa d\'atto riparte da zero a ogni apertura'],
		['accept_seal_downgrade', "ciò che l'owner ha dichiarato, inoltrato al server"]
	]) {
		if (!codice.includes(ago)) guasti.push(`${PAGINA}: manca «${ago}» — ${cosa}`);
	}
	// La spunta è una casella di spunta, non un valore qualsiasi.
	if (!/<input[^>]*type="checkbox"[^>]*bind:checked=\{azioneAck\}/.test(codice)) {
		guasti.push(
			`${PAGINA}: «azioneAck» non è legata a una casella di spunta — la presa ` +
				"d'atto dev'essere un gesto dell'owner, non un valore di default"
		);
	}
	// E il bottone di conferma la rispetta: senza, la spunta non ferma nulla.
	if (!/requires_ack === true && !azioneAck/.test(codice)) {
		guasti.push(
			`${PAGINA}: la conferma non è condizionata alla presa d'atto — la spunta ` +
				'non fermerebbe nulla'
		);
	}
	// La policy non si riscrive qui: nessun confronto sul livello o sul cap.
	for (const copia of [/tier\s*===\s*'SEAL-/, /cap\s*===\s*'SEAL-/]) {
		if (copia.test(codice)) {
			guasti.push(
				`${PAGINA}: la regola del cap è riscritta in pagina (${copia}) — la decide ` +
					'il server, e due copie un giorno diranno il contrario'
			);
		}
	}
}

const client = leggiSorgente(CLIENT, guasti, 'il client API');
if (client !== null) {
	const codice = senzaCommenti(client);
	if (!/requires_ack/.test(codice)) {
		guasti.push(`${CLIENT}: lo stato del cap non porta più «requires_ack»`);
	}
	const da = codice.indexOf('export interface ConnectorActionState');
	if (da < 0) {
		guasti.push(`${CLIENT}: manca «ConnectorActionState» — lo stato di un'azione`);
	} else if (!codice.slice(da, codice.indexOf('\n}', da)).includes('seal')) {
		guasti.push(
			`${CLIENT}: lo stato di un'azione non porta più «seal»: la pagina non ` +
				'avrebbe come sapere che c\'è una domanda da fare'
		);
	}
}

if (guasti.length) {
	console.error("presa d'atto sul cap SEAL di un canale:");
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log(
	"presa d'atto sul cap SEAL: la chiede il server, la spunta è dell'owner, " +
		'la conferma la rispetta ✓'
);
