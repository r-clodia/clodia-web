#!/usr/bin/env node
/**
 * La sezione «Partecipanti» non ha più la select contributor/reader.
 *
 * Richiesta diretta dell'owner (issue clodia-platform#292): il controllo che
 * permetteva all'owner di cambiare a mano il ruolo di un partecipante non
 * l'ha mai usato nessuno — tutti restano `contributor`, il default del server
 * quando si invita senza ruolo — quindi sparisce dalla pagina.
 *
 * Cosa NON viene toccato, ed è la metà che confonde: il modello di ruoli
 * `owner/contributor/reader` resta intero lato server
 * (`clodia-tools/server/topics/service.py`, `server/topics/test_roles.py`: un
 * `reader` non muta, degrada a gate verso l'owner) e `setChannelParticipant`
 * accetta ancora il parametro `role` opzionale. Sparisce la superficie che lo
 * impostava a mano da questa pagina, non il permesso.
 *
 * Perché un controllo e non solo il diff: `roleOf` resta in pagina — il ruolo
 * si continua a LEGGERE accanto al nome — e `setChannelParticipant` resta
 * importato e chiamato dai flussi di invito/rimozione. Rimettere la select
 * costa quindi cinque righe di markup che, in review, sembrano il ripristino
 * di un'etichetta accanto a codice che sta legittimamente lì.
 *
 * LIMITE DICHIARATO: è un controllo sul TESTO del file, non sul DOM reso. Vede
 * le tracce elencate qui sotto, non un selettore di ruolo equivalente scritto
 * con altre parole (radio, menu contestuale) o spostato in un componente nuovo.
 * Sopra questo soffitto serve un test di render (nel repo oggi non c'è un
 * runner di componenti).
 *
 * 12 Nov 2026 (owner): «eliminiamo il ruolo contributor … eliminiamo la label
 * dalla sezione partecipanti». Every participant is the same; the only label
 * left is the owner's. The non-owner label must not come back.
 */
import { leggiSorgente, senzaCommenti } from './lib/sorgente.mjs';

const PAGINA = 'src/routes/topics/[tier]/[name]/+page.svelte';

/** Tracce del controllo dismesso: se una torna, torna la select in pagina. */
const VIETATI = [
	['setRole', 'la funzione che scriveva il ruolo scelto a mano'],
	['roleBusy', 'il lucchetto anti-doppio-click della select'],
	['role-sel', 'la select del ruolo e i suoi stili'],
	["<option value=\"contributor\"", 'le opzioni del menu a tendina'],
	["<option value=\"reader\"", 'le opzioni del menu a tendina'],
	['roleOf', "l'etichetta `contributor` accanto a ogni partecipante (tolta il 12 nov 2026)"]
];

/** Ciò che deve restare: la rimozione riguarda il CONTROLLO, non il ruolo né
 *  la gestione dei partecipanti. Se si porta via anche questi, ha sforato. */
const RICHIESTI = [
	['class="role-fixed"', "l'etichetta dell'owner"],
	['setChannelParticipant', "l'API dei partecipanti, usata da invito e rimozione"],
	['removeParticipant', 'il pulsante × che toglie un partecipante (fuori scope della #292)']
];

const guasti = [];
const src = leggiSorgente(PAGINA, guasti, 'sezione Partecipanti');
if (src) {
	// I VIETATI si cercano nel codice spogliato dei commenti: il commento che
	// spiega perché la select non c'è più nomina la select (web#181).
	const codice = senzaCommenti(src);
	for (const [ago, cosa] of VIETATI) {
		if (codice.includes(ago)) guasti.push(`ricompare «${ago}» — ${cosa}`);
	}
	for (const [ago, cosa] of RICHIESTI) {
		if (!codice.includes(ago)) guasti.push(`manca «${ago}» — ${cosa}`);
	}

	// I due sopra si cercano come PAROLA, e la parola sopravvive alla sua
	// scomparsa dal markup: `roleOf` resta nella propria definizione e
	// `removeParticipant` in altri usi, quindi togliere l'etichetta del ruolo o
	// il pulsante × dalla lista dei partecipanti passava inosservato. Misurato
	// sabotando questa stessa guard: due casi su quattro sfuggivano.
	//
	// Qui si cerca la FORMA nel posto giusto. Sono le due cose che l'utente
	// perde per davvero se la rimozione sfora: riconoscere l'owner, e poter togliere
	// qualcuno dalla stanza.
	// Since 12 Nov 2026 the only role shown is the owner's: its label must
	// still be rendered next to the owner's name.
	if (!/class="role-fixed"[^>]*>\s*owner\s*</.test(codice)) {
		guasti.push("l'etichetta `owner` non è più resa accanto al nome dell'owner");
	}
	const bottoneX = /<button[^>]*on:click=\{\(\)\s*=>\s*removeParticipant\(/.test(codice);
	if (!bottoneX) {
		guasti.push(
			'il pulsante × non è più nel markup dei partecipanti: `removeParticipant` ' +
				"compare nel file ma nessun bottone lo chiama, quindi l'owner non può " +
				'più togliere nessuno dalla stanza'
		);
	} else if (!/\{#if isOwner\}[\s\S]{0,200}?removeParticipant\(/.test(codice)) {
		guasti.push(
			"il pulsante × non è più condizionato a `{#if isOwner}`: lo vedrebbe " +
				'anche chi non è owner, e il rifiuto arriverebbe dal backend'
		);
	}
}

if (guasti.length) {
	console.error(`sezione Partecipanti (${PAGINA}):`);
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log('sezione Partecipanti: nessuna select del ruolo, ruolo leggibile e API intatta ✓');
