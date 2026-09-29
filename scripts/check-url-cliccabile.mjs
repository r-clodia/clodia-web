#!/usr/bin/env node
/**
 * Un URL scritto nudo in chat deve restare CLICCABILE (clodia-platform#452).
 *
 * Il renderer markdown di casa collegava solo la forma `[testo](url)`, che in
 * conversazione non scrive nessuno: gli indirizzi arrivavano nudi e finivano a
 * schermo come testo morto. Il guard protegge le due metà della correzione, e
 * le protegge in modo diverso apposta:
 *
 *   1. **eseguendo** `autolink` sui casi che contano — è logica di potatura di
 *      stringhe, cioè il genere di codice che si rompe in silenzio quando
 *      qualcuno "semplifica" una regex;
 *   2. **leggendo** `markdown.ts`, che è l'unico punto in cui quella funzione
 *      entra in scena: un autolink perfetto che nessuno chiama non rende
 *      cliccabile niente.
 *
 * Due invarianti meritano di essere dette a voce alta, perché sono quelle che
 * un rifacimento distratto perde per prime:
 *
 *   - **mai due volte.** In `<a href="https://x">https://x</a>` l'indirizzo
 *     compare due volte; una sostituzione cieca lo riscriverebbe anche dentro
 *     l'attributo e nel testo dell'ancora, producendo ancore annidate. Il link
 *     smette di funzionare proprio dove funzionava già.
 *   - **solo http/https.** L'elenco è di ciò che è ammesso, non di ciò che è
 *     vietato: un `javascript:` che diventasse `<a href>` sarebbe una via di
 *     esecuzione aperta dal testo di un messaggio.
 *
 *     node scripts/check-url-cliccabile.mjs
 */
import { leggiSorgente, senzaCommenti } from './lib/sorgente.mjs';
import { autolink } from '../src/lib/autolink.js';

const guasti = [];

/** Quante ancore ci sono nel risultato. */
function ancore(html) {
	return (html.match(/<a\b/g) || []).length;
}
/** Il valore di `href` della prima ancora, o `null`. */
function href(html) {
	const m = /<a\b[^>]*\bhref="([^"]*)"/.exec(html);
	return m ? m[1] : null;
}
/** Il testo visibile della prima ancora, o `null`. */
function testo(html) {
	const m = /<a\b[^>]*>([\s\S]*?)<\/a>/.exec(html);
	return m ? m[1] : null;
}

/**
 * I casi, nella forma in cui `renderInline` passa la stringa: HTML già
 * scappato. Per questo le virgolette e i minore/maggiore compaiono come entità.
 *
 * @type {Array<[string, string, (out: string) => string|null]>}
 */
const casi = [
	[
		'URL nudo in mezzo a una frase',
		'La PR è qui: https://github.com/r-clodia/clodia-web/pull/1 grazie',
		(out) =>
			href(out) === 'https://github.com/r-clodia/clodia-web/pull/1'
				? null
				: `href atteso sull'URL intero, ottenuto ${JSON.stringify(href(out))}`
	],
	[
		'il punto finale è della frase, non dell’indirizzo',
		'Guarda https://clodia.dev/p.',
		(out) =>
			href(out) === 'https://clodia.dev/p' && out.endsWith('.')
				? null
				: `il punto deve restare FUORI dal link e nel testo: ${out}`
	],
	[
		'parentesi di frase: la chiusa non entra nel link',
		'(vedi https://clodia.dev/p)',
		(out) =>
			href(out) === 'https://clodia.dev/p' && out.endsWith(')')
				? null
				: `href atteso senza la parentesi: ${JSON.stringify(href(out))}`
	],
	[
		'parentesi DELL’indirizzo: bilanciate, quindi restano',
		'https://it.wikipedia.org/wiki/Roma_(città)',
		(out) =>
			href(out) === 'https://it.wikipedia.org/wiki/Roma_(città)'
				? null
				: `troncare qui produce un link rotto che sembra giusto: ${JSON.stringify(href(out))}`
	],
	[
		'forma senza schema: www.… prende https://',
		'scrivi a www.esempio.it quando vuoi',
		(out) =>
			href(out) === 'https://www.esempio.it' && testo(out) === 'www.esempio.it'
				? null
				: `href/testo attesi https://www.esempio.it / www.esempio.it, ottenuti ${JSON.stringify(href(out))} / ${JSON.stringify(testo(out))}`
	],
	[
		'query string: &amp; fa parte dell’URL',
		'https://clodia.dev/s?a=1&amp;b=2 fine',
		(out) =>
			href(out) === 'https://clodia.dev/s?a=1&amp;b=2'
				? null
				: `la query non deve essere troncata sull’entità: ${JSON.stringify(href(out))}`
	],
	[
		'&lt; e &gt; sono delimitatori: lì l’URL finisce',
		'&lt;https://clodia.dev/p&gt;',
		(out) =>
			href(out) === 'https://clodia.dev/p'
				? null
				: `l’entità del delimitatore è finita dentro il link: ${JSON.stringify(href(out))}`
	],
	[
		'schema non ammesso: nessun link',
		'javascript:alert(1) e data:text/html,x e file:///etc/passwd',
		(out) => (ancore(out) === 0 ? null : `ha prodotto ${ancore(out)} ancore: ${out}`)
	],
	[
		'indirizzo email: non è un link web',
		'scrivi a tizio@www.esempio.it',
		(out) => (ancore(out) === 0 ? null : `ha linkificato il dominio di una email: ${out}`)
	],
	[
		'MAI DUE VOLTE: un link già reso non si ri-linkifica',
		'<a href="https://x.dev" target="_blank" rel="noopener noreferrer">https://x.dev</a> e poi https://y.dev',
		(out) =>
			ancore(out) === 2 && !/<a\b[^>]*>[^<]*<a\b/.test(out)
				? null
				: `attese 2 ancore non annidate, ottenute ${ancore(out)}: ${out}`
	],
	[
		'il link si apre fuori, senza passare la referrer',
		'https://clodia.dev',
		(out) =>
			/target="_blank"/.test(out) && /rel="noopener noreferrer"/.test(out)
				? null
				: `mancano target/rel come sugli altri link del renderer: ${out}`
	],
	[
		'testo senza indirizzi: invariato',
		'Nessun link qui. Solo www e http, scritti a parole.',
		(out) =>
			out === 'Nessun link qui. Solo www e http, scritti a parole.'
				? null
				: `il testo semplice è stato modificato: ${out}`
	]
];

let passati = 0;
for (const [nome, input, verifica] of casi) {
	let out;
	try {
		out = autolink(input);
	} catch (e) {
		guasti.push(`«${nome}»: autolink ha sollevato ${e && e.message}`);
		continue;
	}
	const male = verifica(out);
	if (male) guasti.push(`«${nome}»: ${male}`);
	else {
		passati++;
		console.log(`ok   ${nome}`);
	}
}

// --- L'innesto: la funzione deve essere CHIAMATA, e nel punto giusto --------
const MD = 'src/lib/markdown.ts';
const md = leggiSorgente(MD, guasti, 'innesto dell’autolink nel renderer');
if (md) {
	const src = senzaCommenti(md);
	if (!/import\s*\{[^}]*\bautolink\b[^}]*\}\s*from\s*['"]\.\/autolink(\.js)?['"]/.test(src)) {
		guasti.push(
			`${MD}: non importa «autolink» da ./autolink.js — un autolink che nessuno chiama ` +
				`lascia gli URL nudi esattamente com'erano (clodia-platform#452)`
		);
	}
	const iAutolink = src.indexOf('autolink(s)');
	// Il code span viene messo da parte PRIMA e ripristinato DOPO: un path o un
	// URL citato fra backtick deve restare testo dentro <code>, non diventare un
	// link. L'ordine è l'unica cosa che lo garantisce.
	const iStash = src.indexOf('codeStash.push');
	const iRestore = src.search(/CODE\(\\d\+\)/);
	if (iAutolink < 0) {
		guasti.push(`${MD}: «autolink(s)» non compare in renderInline: gli URL nudi non vengono collegati`);
	} else if (iStash < 0 || iRestore < 0) {
		guasti.push(
			`${MD}: non trovo lo stash/ripristino dei code span — rinominati? ` +
				`senza quei due punti non posso più dimostrare che l'autolink sta in mezzo`
		);
	} else if (!(iStash < iAutolink && iAutolink < iRestore)) {
		guasti.push(
			`${MD}: «autolink» non sta FRA lo stash dei code span e il loro ripristino ` +
				`(stash ${iStash}, autolink ${iAutolink}, ripristino ${iRestore}): ` +
				`fuori da quell'intervallo un URL scritto fra backtick diventerebbe un link dentro <code>`
		);
	}
}

if (guasti.length) {
	console.error('URL cliccabili:');
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log(`URL cliccabili: ${passati}/${casi.length} casi, innesto nel renderer verificato ✓`);
