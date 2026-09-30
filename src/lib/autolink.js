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
 * Candidates: from the scheme (or `www.`) up to the first whitespace or `<`.
 *
 * The lookbehind rejects candidates glued to text or to an email address
 * (`tizio@www.esempio.it`) and forms stuck to a path. It lists letters and
 * digits explicitly instead of using `\w` because `\w` includes `_`, and a URL
 * wrapped in `_…_` / `__…__` emphasis must still be found.
 *
 * Stopping at `<` is defence in depth: `renderInline` runs this BEFORE the
 * emphasis step, so the only tags present are the `<a>` blocks that `autolink`
 * already skips — but a candidate must never swallow markup it did not write.
 *
 * Trimming the rest is `ripulisci`'s job: widening this pattern to exclude
 * trailing punctuation would be more fragile, because what must be removed
 * depends on what comes *before* (balanced parentheses, emphasis markers).
 */
const CANDIDATO = /(?<![A-Za-z0-9@/.-])(?:https?:\/\/|www\.)[^\s<]+/gi;

/** Emphasis markers that may wrap a URL: `**url**`, `*url*`, `__url__`, `_url_`. */
const ENFASI = /[*_]+$/;

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
 * Emphasis markers are trimmed only as many as OPEN right before the URL
 * (`apertura`): `**https://x.dev/p**` loses the trailing `**`, while
 * `https://x.dev/_a_` keeps its underscores because nothing opened them.
 *
 * @param {string} grezzo
 * @param {string} [apertura] emphasis run (`*`/`_`) immediately before the match
 * @returns {string}
 */
function ripulisci(grezzo, apertura = '') {
	let enfasi = apertura;
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
		// Closing emphasis marker matching the innermost opener still unmatched.
		if (enfasi && ultimo === enfasi.slice(-1)) {
			u = u.slice(0, -1);
			enfasi = enfasi.slice(0, -1);
			continue;
		}
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

/**
 * @param {string} testo
 * @param {(html: string) => string} proteggi
 * @returns {string}
 */
function collega(testo, proteggi) {
	return testo.replace(CANDIDATO, (m, pos) => {
		const apertura = (ENFASI.exec(testo.slice(0, pos)) || [''])[0];
		const u = ripulisci(m, apertura);
		if (!u || !vale(u)) return m;
		// La coda potata torna nel testo: è punteggiatura della frase, non deve
		// sparire solo perché stava attaccata a un indirizzo.
		return proteggi(ancora(u)) + m.slice(u.length);
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
 * `proteggi` receives every anchor this function writes and returns what goes
 * into the string instead. `renderInline` passes a function that stashes the
 * anchor behind a placeholder, so the emphasis step that runs afterwards
 * cannot rewrite the URL (`https://x.dev/_a_` would otherwise get an `<em>`
 * inside both `href` and the link text). The default leaves the anchor as is.
 *
 * @param {string} html frammento già passato da `escapeHtml`
 * @param {(html: string) => string} [proteggi]
 * @returns {string}
 */
export function autolink(html, proteggi = (a) => a) {
	return String(html ?? '')
		.split(/(<a\b[^>]*>[\s\S]*?<\/a>)/i)
		.map((seg, i) => (i % 2 === 0 ? collega(seg, proteggi) : seg))
		.join('');
}
