/**
 * URL scritti nudi nel testo → link cliccabili (clodia-platform#452).
 *
 * Il renderer markdown di casa (`$lib/markdown`) trasformava in `<a>` soltanto
 * la forma esplicita `[testo](url)`. Un agente che in chat scrive
 * «la PR è qui: https://github.com/r-clodia/clodia-web/pull/1» produceva
 * testo inerte: per aprirlo bisognava selezionarlo e copiarlo a mano. È il caso
 * più frequente, perché nessuno scrive markdown mentre parla.
 *
 * Il difetto si corregge in UN punto solo — `renderInline` — perché di lì
 * passano tutte le superfici che mostrano testo: bolle di chat, risposta in
 * streaming, TL;DR delle topic card, pagine skill e rules. Una funzione per
 * chiamante avrebbe lasciato indietro quello scritto domani.
 *
 * ## Cosa diventa link
 * Solo `http://` e `https://`, più la forma `www.…` (href con `https://`).
 * **Niente altri schemi**: `javascript:`, `data:` e `file:` non possono entrare
 * da questa porta, che è la ragione per cui il controllo è una lista di ciò che
 * è ammesso e non una lista di ciò che è vietato.
 *
 * ## Su che stringa lavora
 * Su HTML **già scaricato di caratteri pericolosi** da `escapeHtml` — cioè
 * dopo la fuga di `<`, `>`, `"`, `'`, `&`. Due conseguenze che il codice qui
 * sotto tratta esplicitamente:
 *   - `&amp;` è un pezzo LEGITTIMO di URL (le query string), mentre `&lt;`,
 *     `&gt;`, `&quot;`, `&#39;` nascono da un delimitatore e segnano la FINE
 *     dell'URL: `&lt;https://x&gt;` deve produrre il link a `https://x`, non a
 *     `https://x&gt;`;
 *   - il testo del link e il valore di `href` restano nella forma con entità,
 *     che è quella giusta dentro un attributo HTML.
 *
 * Modulo JS e non TS di proposito, come `liveBox.js` e `liveReply.js`: così
 * `scripts/check-url-cliccabile.mjs` importa ed ESEGUE questa funzione invece
 * di riscriverne una copia che può divergere in silenzio.
 */

/** Entità che nascono da un carattere di delimitazione: lì l'URL finisce.
 *  `&amp;` non c'è, ed è la differenza che tiene in piedi le query string. */
const DELIMITATORE = /&(?:lt|gt|quot|#39);/;

/** Punteggiatura che in una frase segue l'URL invece di farne parte.
 *  «Guarda https://x.dev.» — il punto è della frase, non dell'indirizzo. */
const CODA = '.,;:!?';

/**
 * Candidati: dallo schema (o dal `www.`) fino al primo spazio.
 *
 * Il lookbehind esclude i candidati attaccati a testo o a un indirizzo email
 * (`tizio@www.esempio.it`) e le forme incollate a un percorso. La potatura del
 * resto la fa `ripulisci`: allargare qui il pattern per escludere la
 * punteggiatura finale sarebbe più fragile, perché i caratteri da togliere
 * dipendono da cosa c'è *prima* (le parentesi bilanciate).
 */
const CANDIDATO = /(?<![\w@/.-])(?:https?:\/\/|www\.)[^\s]+/gi;

/** @param {string} s @param {string} c */
function conta(s, c) {
	let n = 0;
	for (const ch of s) if (ch === c) n++;
	return n;
}

/**
 * Toglie dalla fine ciò che appartiene alla frase e non all'URL.
 *
 * Le parentesi si contano invece di toglierle sempre: gli URL con parentesi
 * dentro esistono (Wikipedia), e troncarli produce un link rotto che *sembra*
 * giusto. Si toglie solo la chiusa che non ha un'aperta nel match — il caso
 * «(vedi https://x.dev/p)».
 *
 * @param {string} grezzo
 * @returns {string}
 */
function ripulisci(grezzo) {
	const taglio = DELIMITATORE.exec(grezzo);
	let u = taglio ? grezzo.slice(0, taglio.index) : grezzo;
	for (;;) {
		// `&amp;` finisce per `;`: se lo si sfogliasse un carattere per volta
		// resterebbe l'avanzo `&amp` attaccato al link. Si toglie intero.
		if (u.endsWith('&amp;')) {
			u = u.slice(0, -5);
			continue;
		}
		const ultimo = u.slice(-1);
		if (!ultimo) break;
		if (CODA.includes(ultimo)) {
			u = u.slice(0, -1);
			continue;
		}
		if (ultimo === ')' && conta(u, ')') > conta(u, '(')) {
			u = u.slice(0, -1);
			continue;
		}
		if (ultimo === ']' && conta(u, ']') > conta(u, '[')) {
			u = u.slice(0, -1);
			continue;
		}
		break;
	}
	return u;
}

/**
 * Vale la pena renderlo cliccabile?
 *
 * Con lo schema basta un host non vuoto (`http://localhost:7843` è un link
 * buono). Senza schema serve almeno un punto DOPO `www.`, altrimenti una frase
 * che nomina «www.» e poco altro diventerebbe un link a un host inesistente.
 *
 * @param {string} u
 */
function vale(u) {
	if (/^https?:\/\//i.test(u)) return /^https?:\/\/[^\s/]+/i.test(u);
	return /^www\.[^\s/.]+\.[^\s/.]+/i.test(u);
}

/** @param {string} u @returns {string} */
function ancora(u) {
	const href = /^https?:\/\//i.test(u) ? u : `https://${u}`;
	return `<a href="${href}" target="_blank" rel="noopener noreferrer">${u}</a>`;
}

/** @param {string} testo @returns {string} */
function collega(testo) {
	return testo.replace(CANDIDATO, (m) => {
		const u = ripulisci(m);
		if (!u || !vale(u)) return m;
		// La coda potata torna nel testo: è punteggiatura della frase, non deve
		// sparire solo perché stava attaccata a un indirizzo.
		return ancora(u) + m.slice(u.length);
	});
}

/**
 * Rende cliccabili gli URL nudi di un frammento HTML, **lasciando stare quelli
 * che un link ce l'hanno già**.
 *
 * Il taglio sugli `<a>…</a>` è la parte che non si può omettere: in
 * `<a href="https://x">https://x</a>` l'indirizzo compare due volte, e una
 * sostituzione cieca lo riscriverebbe sia dentro l'attributo sia nel testo,
 * producendo un'ancora annidata — HTML che il browser ricostruisce a modo suo e
 * che rende il link inservibile. È lo stesso motivo per cui `linkifyFiles`
 * spezza sui code span prima di sostituire.
 *
 * @param {string} html frammento già passato da `escapeHtml`
 * @returns {string}
 */
export function autolink(html) {
	return String(html ?? '')
		.split(/(<a\b[^>]*>[\s\S]*?<\/a>)/i)
		.map((seg, i) => (i % 2 === 0 ? collega(seg) : seg))
		.join('');
}
