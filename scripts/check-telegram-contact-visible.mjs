#!/usr/bin/env node
/**
 * Un recapito Telegram che non recapita si vede come tale, e il campo libero
 * del profilo non è una seconda casa dove scriverlo.
 *
 * Il difetto misurato (clodia-platform#200): il contatto Telegram dell'owner
 * era stato scritto fra i campi liberi del profilo PII, il campo della scheda
 * agente era `None`, e la piattaforma si comportava come se il recapito non
 * esistesse — i messaggi in ingresso da quell'handle non venivano ricondotti a
 * lui e l'ultimo gradino di R4 non aveva dove mandare la notifica. Nessuna
 * schermata lo diceva: una persona irraggiungibile era disegnata esattamente
 * come una raggiungibile, ed è la ragione per cui il silenzio è durato.
 *
 * Il contratto che questa guard tiene fermo è in tre punti, ognuno una cosa che
 * tornerebbe indietro in silenzio:
 *
 *   1. le due superfici che elencano/descrivono le persone leggono
 *      `telegram_delivers` — la risposta la dà il SERVER, perché «solo il
 *      chat_id numerico è un destinatario» è una regola sola e ridedurla nella
 *      UI significa averne due, che divergeranno;
 *   2. il campo libero del profilo rifiuta le chiavi di contatto;
 *   3. lo smistamento del contatto di una cert-request non è `includes('@')` —
 *      un handle inizia con la chiocciola e finiva nel campo email.
 *
 * LIMITE DICHIARATO: è un controllo statico sul testo dei file elencati. Vede
 * che il campo è letto e che il badge esiste, non che siano resi nel posto
 * giusto; e una superficie nuova che elenca persone resta fuori finché qualcuno
 * non la aggiunge qui. È il prezzo di una guard che non prova a indovinare cosa
 * sia un elenco di persone.
 */
import { readFileSync } from 'node:fs';

const SCHEDA = 'src/routes/agents/[name]/+page.svelte';
const TABELLA = 'src/lib/components/AgentTable.svelte';
const LISTA = 'src/routes/agents/+page.svelte';
const TIPI = 'src/lib/api/types.ts';

const guasti = [];

function leggi(file, cosa) {
	try {
		return readFileSync(file, 'utf8');
	} catch {
		guasti.push(`${file}: file assente — spostato, rinominato o mai creato (${cosa})`);
		return null;
	}
}

// 1 · la recapitabilità arriva dal server ed è letta dove si guardano le persone.
const tipi = leggi(TIPI, 'contratto del payload agents');
if (tipi !== null && !tipi.includes('telegram_delivers')) {
	guasti.push(`${TIPI}: \`telegram_delivers\` non è tipizzato — il campo che dice se una notifica può partire`);
}
for (const [file, cosa] of [
	[SCHEDA, 'scheda della persona'],
	[TABELLA, 'registry agent, vista a tabella']
]) {
	const src = leggi(file, cosa);
	if (src === null) continue;
	if (!src.includes('telegram_delivers')) {
		guasti.push(`${file}: non legge \`telegram_delivers\` (${cosa}) — un handle passa per un recapito buono`);
	}
}

// La tabella è il posto in cui le persone si vedono TUTTE INSIEME: senza un
// segno, «irraggiungibile» ha lo stesso aspetto di «a posto».
const tabella = leggi(TABELLA, 'registry agent, vista a tabella');
if (tabella !== null && !/irraggiungibile/i.test(tabella)) {
	guasti.push(`${TABELLA}: nessun segno per la persona irraggiungibile`);
}

// 2 · il campo libero del profilo non accetta un recapito (il gateway lo
// rifiuta comunque: qui si evita che l'errore arrivi solo a salvataggio).
const scheda = leggi(SCHEDA, 'scheda della persona');
if (scheda !== null && !scheda.includes('FIXED_CONTACT_KEYS')) {
	guasti.push(`${SCHEDA}: il campo libero del profilo non rifiuta le chiavi di contatto — la seconda casa è riaperta`);
}

// 3 · il contatto di una cert-request non si smista sulla presenza di '@'.
const lista = leggi(LISTA, 'approvazione delle cert-request');
if (lista !== null) {
	if (/isEmail\s*=\s*c\.includes\('@'\)/.test(lista)) {
		guasti.push(`${LISTA}: lo smistamento è tornato a \`c.includes('@')\` — un handle @nome finisce nel campo email`);
	}
	if (!lista.includes('smistaContatto')) {
		guasti.push(`${LISTA}: manca lo smistamento esplicito del contatto (email / chat_id / handle / ignoto)`);
	}
}

if (guasti.length) {
	console.error('recapito Telegram — contratto rotto:');
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log('recapito Telegram: recapitabilità letta dal server, profilo chiuso ai contatti, smistamento esplicito ✓');
