#!/usr/bin/env node
/**
 * Il connettore Mailbox SCEGLIE una casella, non la fa scrivere.
 *
 * clodia-platform#406: «le mailbox disponibili sono quelle presenti nel
 * sistema, qui se ne seleziona una che diventa autorizzata nel canale».
 * Collegarla scrive `inbox:<indirizzo>` fra le fonti e `outbox:<indirizzo>` fra
 * le destinazioni di quel topic, ed è quella coppia che i verbi email leggono
 * per decidere con quale casella il canale può parlare.
 *
 * Il difetto che questo controllo impedisce è uno solo, ed è silenzioso: un
 * campo di testo al posto della tendina. Un indirizzo digitato a mano finisce
 * in whitelist identico a uno vero, ma dietro non c'è nessuna credenziale —
 * l'autorizzazione esiste, la casella no, e il sintomo arriva più tardi come
 * «il verbo email non funziona», che non nomina la causa. Per lo stesso motivo
 * il client non deve mandare l'INDIRIZZO al server: manda il nome dell'account
 * e l'indirizzo lo risolve il gateway dalla vault. Una whitelist il cui
 * contenuto lo sceglie il chiamante non è una whitelist.
 *
 * Due fonti indipendenti, nessuna delle quali è questo file: la pagina del
 * topic (dove sta la tendina) e il client API (dove si compone la richiesta).
 *
 * LIMITE DICHIARATO: è un controllo sul TESTO dei file, non sul DOM reso. Vede
 * un `<input>` legato alla scelta della casella, non un campo equivalente
 * costruito in un componente separato. Sopra questo soffitto serve un test di
 * render, che in questo repo non ha ancora un runner.
 */
import { leggiSorgente, senzaCommenti } from './lib/sorgente.mjs';

const PAGINA = 'src/routes/topics/[tier]/[name]/+page.svelte';
const CLIENT = 'src/lib/api/client.ts';

const guasti = [];

const pagina = leggiSorgente(PAGINA, guasti, 'la pagina del topic');
if (pagina !== null) {
	const codice = senzaCommenti(pagina);
	for (const [ago, cosa] of [
		['getTopicMailboxes', "l'elenco delle caselle di sistema"],
		['setTopicMailbox', 'il collega/scollega della casella'],
		['bind:value={mailboxChoice}', 'la scelta della casella legata a un controllo']
	]) {
		if (!codice.includes(ago)) guasti.push(`${PAGINA}: manca «${ago}» — ${cosa}`);
	}
	// La scelta è una tendina di ciò che il server ha elencato. Un `<input>` sul
	// medesimo binding sarebbe il campo libero che questo controllo esiste per
	// impedire.
	const dentroSelect = /<select[^>]*bind:value=\{mailboxChoice\}/.test(codice);
	if (!dentroSelect) {
		guasti.push(
			`${PAGINA}: «mailboxChoice» non è legata a un <select> — la casella si ` +
				'sceglie fra quelle esistenti, non si digita'
		);
	}
	if (/<input[^>]*bind:value=\{mailboxChoice\}/.test(codice)) {
		guasti.push(
			`${PAGINA}: «mailboxChoice» è legata a un <input>: un indirizzo scritto a ` +
				'mano autorizza una casella che non esiste'
		);
	}
}

const client = leggiSorgente(CLIENT, guasti, 'il client API');
if (client !== null) {
	const codice = senzaCommenti(client);
	const fn = codice.slice(codice.indexOf('export async function setTopicMailbox'));
	if (!fn || !fn.startsWith('export async function setTopicMailbox')) {
		guasti.push(`${CLIENT}: manca «setTopicMailbox» — il collega/scollega della casella`);
	} else {
		const corpo = fn.slice(0, fn.indexOf('\n}\n') + 1);
		if (!corpo.includes('mailbox-link')) {
			guasti.push(`${CLIENT}: «setTopicMailbox» non chiama più /mailbox-link`);
		}
		if (!/\{\s*action,\s*account\s*\}/.test(corpo)) {
			guasti.push(
				`${CLIENT}: «setTopicMailbox» non manda più {action, account} — se manda ` +
					"l'indirizzo, la whitelist la scrive il chiamante"
			);
		}
		if (/\bemail\b\s*[,:}]/.test(corpo)) {
			guasti.push(
				`${CLIENT}: «setTopicMailbox» manda un campo «email»: l'indirizzo lo ` +
					'risolve il gateway dalla vault, non il browser'
			);
		}
	}
	// Le due direzioni sono la sostanza del connettore: il tipo che la pagina
	// legge deve continuare a portarle entrambe, se no «collegata» torna a
	// significare metà configurazione.
	for (const [ago, cosa] of [
		['inbox: boolean', 'la casella è fonte ammessa di questo topic'],
		['outbox: boolean', 'la casella è destinazione ammessa di questo topic']
	]) {
		if (!codice.includes(ago)) guasti.push(`${CLIENT}: manca «${ago}» — ${cosa}`);
	}
}

if (guasti.length) {
	console.error('connettore Mailbox:');
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log('connettore Mailbox: casella scelta fra quelle di sistema, indirizzo risolto dal gateway, ingress+egress insieme ✓');
