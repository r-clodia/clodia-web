/**
 * Il messaggio appena inviato non deve sparire da sotto le dita.
 *
 * `send()` fa un echo ottimistico — aggiunge il messaggio umano alla lista con
 * un id `local-…` prima che la POST torni — e fa la cosa giusta. Ma
 * `refreshMessages()` SOVRASCRIVE l'intera lista con la risposta del server:
 *
 *     ({ messages, presence } = await getChannelMessagesAndPresence(tier, name))
 *
 * e in quella risposta l'echo non c'è, perché il server non conosce gli id
 * `local-`. Da cui la corsa che Davide ha segnalato il 3 set 2026 («il messaggio
 * in input non arriva subito in chat»):
 *
 *   1. un giro di polling parte, GET /messages;
 *   2. l'utente invia → l'echo compare, correttamente;
 *   3. la GET — partita PRIMA dell'invio, quindi con una lista che non contiene
 *      il messaggio nuovo — ritorna e sovrascrive: **l'echo viene cancellato**;
 *   4. il messaggio ricompare solo al giro DOPO, perché il `refreshMessages()`
 *      dentro `send()` arriva soltanto quando la POST ha finito — e la POST
 *      attende il turno dell'agente, che su un canale carico è minuti.
 *
 * Con il polling adattivo (#199) il punto 4 è peggiorato: se la stanza era
 * quieta, il giro dopo è a 30-60 secondi invece di 5. Il difetto c'era già; è
 * diventato lungo abbastanza da sembrare che l'invio non fosse partito.
 *
 * Qui si tengono gli echo che il server non ha ancora confermato, invece di
 * fidarsi del fatto che la risposta successiva li contenga.
 */

/** Prefisso degli id degli echo ottimistici (li assegna `send`). */
export const PREFISSO_LOCALE = 'local-';

/**
 * È un messaggio provvisorio, non ancora confermato dal server?
 * @param {{id?: string}|null|undefined} m
 */
export function isLocale(m) {
	return typeof m?.id === 'string' && m.id.startsWith(PREFISSO_LOCALE);
}

/**
 * @param {string|null|undefined} t
 * @returns {string}
 */
function normalizza(t) {
	return (t || '').replace(/\s+/g, ' ').trim();
}

/**
 * Il server ha già questo echo?
 *
 * Il confronto è su AUTORE + TESTO normalizzato e non sull'id, che per un echo
 * è locale e non esiste da nessun'altra parte. Il testo si normalizza sugli
 * spazi perché fra ciò che si invia e ciò che il server restituisce può
 * cambiare la spaziatura di coda, e un confronto rigido lascerebbe l'echo
 * appiccicato accanto al messaggio vero — cioè lo stesso testo due volte.
 *
 * @param {{author?: string, text?: string}} echo
 * @param {ReadonlyArray<{author?: string, text?: string, kind?: string}>} dalServer
 */
export function confermato(echo, dalServer) {
	const t = normalizza(echo?.text);
	const a = echo?.author;
	return (dalServer || []).some(
		(m) => m && m.author === a && normalizza(m.text) === t
	);
}

/**
 * Fonde la lista del server con gli echo ancora in volo.
 *
 * @template {{id?: string, author?: string, text?: string}} M
 * @param {ReadonlyArray<M>} dalServer   la lista appena arrivata
 * @param {ReadonlyArray<M>} precedenti  la lista che c'era a schermo
 * @returns {M[]} lista da mostrare: server + echo non confermati, in coda
 *
 * Gli echo restano IN CODA e nell'ordine in cui erano: sono i più recenti per
 * definizione — l'utente li ha appena scritti — e riordinarli per `ts` li
 * mescolerebbe con i messaggi del server a parità di secondo.
 *
 * La conferma si fa CONTANDO le occorrenze, non chiedendo «esiste?»: inviare
 * due volte lo stesso testo è normale («ok», «sì», un sollecito ripetuto), e
 * con un test di sola esistenza il primo messaggio confermato avrebbe cancellato
 * ANCHE il secondo echo, che è ancora in volo. Con il conteggio, N messaggi del
 * server confermano i primi N echo e gli altri restano.
 */
export function fondiConEcho(dalServer, precedenti) {
	const server = Array.from(dalServer || []);
	// quante volte il server ha già ciascun (autore, testo)
	/** @type {Map<string, number>} */
	const disponibili = new Map();
	for (const m of server) {
		if (!m) continue;
		const k = `${m.author}\u0000${normalizza(m.text)}`;
		disponibili.set(k, (disponibili.get(k) || 0) + 1);
	}
	/** @type {M[]} */
	const inVolo = [];
	for (const m of precedenti || []) {
		if (!isLocale(m)) continue;
		const k = `${m.author}\u0000${normalizza(m.text)}`;
		const n = disponibili.get(k) || 0;
		if (n > 0) {
			disponibili.set(k, n - 1); // questo echo è confermato: consumato
			continue;
		}
		inVolo.push(m);
	}
	return inVolo.length ? [...server, ...inVolo] : server;
}
