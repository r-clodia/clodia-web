#!/usr/bin/env node
/**
 * Il messaggio appena inviato non sparisce quando arriva un giro di polling.
 *
 * `send()` fa già l'echo ottimistico e fa la cosa giusta. Ma
 * `refreshMessages()` sovrascriveva l'intera lista con la risposta del server,
 * dove gli id `local-…` non esistono. Da cui la corsa segnalata da Davide il
 * 3 set 2026 («perché il messaggio in input non arriva subito in chat?»):
 *
 *   1. un giro di polling parte, GET /messages;
 *   2. l'utente invia → l'echo compare;
 *   3. quella GET — partita PRIMA dell'invio — ritorna senza il messaggio nuovo
 *      e sovrascrive: l'echo viene cancellato;
 *   4. il messaggio ricompare al giro dopo, perché il `refreshMessages()` di
 *      `send()` arriva solo a POST completata, e la POST attende il turno.
 *
 * Con il polling adattivo (#199) il punto 4 è passato da 5 a 30-60 secondi: il
 * difetto c'era già, è diventato lungo abbastanza da sembrare un invio mancato.
 *
 * Perché una guard: il ripristino di `messages = await …` è una riga sola, che
 * sembra più semplice del codice giusto, e la regressione è invisibile ai tipi e
 * ai test di rete — riappare solo quando due cose si incrociano nel tempo.
 *
 *     node scripts/check-echo-non-si-perde.mjs
 */
import { leggiSorgente, senzaCommenti } from './lib/sorgente.mjs';

const guasti = [];

let fondiConEcho, isLocale, PREFISSO_LOCALE;
try {
	({ fondiConEcho, isLocale, PREFISSO_LOCALE } = await import('../src/lib/echoLocale.js'));
} catch (e) {
	guasti.push(`src/lib/echoLocale.js non si importa (${e && e.message})`);
}
if (typeof fondiConEcho !== 'function') {
	guasti.push('src/lib/echoLocale.js non esporta fondiConEcho');
}

const umano = (id, text, author = 'davide') => ({ id, author, text, kind: 'human' });

if (typeof fondiConEcho === 'function') {
	const casi = [
		[
			'IL CASO SEGNALATO: poll partito prima dell’invio → l’echo resta',
			[umano('s1', 'vecchio')],
			[umano('s1', 'vecchio'), umano('local-x', 'appena scritto')],
			['s1', 'local-x']
		],
		[
			'il server ha confermato l’echo → via la copia provvisoria',
			[umano('s1', 'vecchio'), umano('s2', 'appena scritto')],
			[umano('s1', 'vecchio'), umano('local-x', 'appena scritto')],
			['s1', 's2']
		],
		[
			'spaziatura diversa fra inviato e restituito → conferma comunque',
			[umano('s2', 'appena  scritto\n')],
			[umano('local-x', 'appena scritto')],
			['s2']
		],
		[
			'due invii dello stesso testo, uno confermato → l’altro resta',
			[umano('s1', 'ok')],
			[umano('local-a', 'ok'), umano('local-b', 'ok')],
			['s1', 'local-b']
		],
		[
			'stesso testo ma di un ALTRO autore: non conferma il mio echo',
			[umano('s1', 'ok', 'clodia')],
			[umano('local-a', 'ok', 'davide')],
			['s1', 'local-a']
		],
		[
			'niente echo in volo → la lista del server passa intatta',
			[umano('s1', 'a'), umano('s2', 'b')],
			[umano('s1', 'a')],
			['s1', 's2']
		],
		['prima apertura: nessuna lista precedente', [umano('s1', 'a')], [], ['s1']],
		['server vuoto ma echo in volo → l’echo si vede', [], [umano('local-x', 'ciao')], ['local-x']]
	];

	for (const [nome, server, precedenti, atteso] of casi) {
		const avuto = fondiConEcho(server, precedenti).map((m) => m.id);
		const ok = JSON.stringify(avuto) === JSON.stringify(atteso);
		if (!ok) guasti.push(`${nome}: ${JSON.stringify(avuto)} (atteso ${JSON.stringify(atteso)})`);
		console.log(`${ok ? 'ok  ' : 'KO  '} ${nome} → ${JSON.stringify(avuto)}`);
	}

	// L'echo va IN CODA: è il più recente per definizione.
	const coda = fondiConEcho([umano('s1', 'a')], [umano('local-x', 'z')]);
	if (coda[coda.length - 1]?.id !== 'local-x') {
		guasti.push('l’echo non è in coda: comparirebbe sopra messaggi più vecchi');
	}
	if (typeof isLocale === 'function' && (!isLocale({ id: PREFISSO_LOCALE + '1' }) || isLocale({ id: '20260903-1' }))) {
		guasti.push('isLocale non distingue gli id provvisori da quelli del server');
	}
}

// --- e la pagina deve usarla, invece di riassegnare la lista ---------------
const PAGINA = 'src/routes/topics/[tier]/[name]/+page.svelte';
const src = leggiSorgente(PAGINA, guasti, 'echo ottimistico');
if (src !== null) {
	const codice = senzaCommenti(src);
	if (/\(\{\s*messages\s*,[^}]*\}\s*=\s*await\s+getChannelMessagesAndPresence/.test(codice)) {
		guasti.push(`${PAGINA}: refreshMessages riassegna direttamente \`messages\` dalla ` +
			`risposta del server — un giro partito prima di un invio cancella l'echo`);
	}
	if (!/fondiConEcho\s*\(/.test(codice)) {
		guasti.push(`${PAGINA}: non usa fondiConEcho: l'echo non sopravvive al polling`);
	}
	// E l'invio deve svegliare il polling, o la conferma arriva un minuto dopo.
	const corpo = codice.match(/async function send\s*\([^)]*\)\s*\{[\s\S]*?\n\t\}/);
	if (!corpo) {
		guasti.push(`${PAGINA}: non trovo send() — se è stata riscritta, riscrivi anche questa guard`);
	} else if (!/segnoDiVita\s*\(/.test(corpo[0])) {
		guasti.push(`${PAGINA}: send() non chiama segnoDiVita(): su una stanza quieta il ` +
			`polling resta sul giro da 60 s e la conferma del server tarda altrettanto`);
	}
}

if (guasti.length) {
	console.error('echo ottimistico:');
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log('echo ottimistico: il messaggio inviato resta a schermo fino alla conferma ✓');
