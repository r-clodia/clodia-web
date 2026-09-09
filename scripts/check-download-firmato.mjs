#!/usr/bin/env node
/**
 * Nessun `<a href>` può puntare all'endpoint di download di un topic senza
 * URL FIRMATO.
 *
 * Il fix di sicurezza del 7 lug 2026 ha reso `GET /topics/{tier}/{name}/download`
 * autenticato: serve **o** una firma `exp`/`sig` (rilasciata da `/download-url`,
 * che verifica login+membership) **o** una sessione con membership. La webui non
 * ha né l'una né l'altra su una navigazione: l'identità viaggia come header
 * `Authorization: Bearer`, e un `<a href>` — compreso quello con `download=` —
 * non allega header custom. La richiesta arriva anonima e il backend risponde
 * `401 "login richiesto"`.
 *
 * Quindi il link non è «meno sicuro»: è **rotto sempre**, per chiunque, membro o
 * no. Ed è rotto in silenzio dal lato di chi scrive il codice, perché l'href si
 * legge plausibile e il 401 si vede solo cliccando in un browser con una
 * sessione vera (clodia-platform#323, clodia-web#206).
 *
 * La causa per cui è ricomparso: il wrapper corretto (`openSignedFile`) viveva
 * **dentro** una pagina, quindi la pagina accanto non ce l'aveva sotto mano e ha
 * riscritto l'URL a mano. Ora sta in `src/lib/download.ts`, e questo guard
 * esiste perché la scorciatoia non rientri dal prossimo `<a>` scritto a mano.
 *
 * Il controllo va nei due versi, perché i modi di perdere la firma sono due:
 *   - un `<a href>` che ricostruisce l'URL di download  → 401 a ogni click;
 *   - `openSignedFile` che smette di firmare            → tutti i call-site
 *     diventano 401 insieme, e il controllo negativo non se ne accorgerebbe
 *     (gli href passano da una funzione: quale URL apra, non lo dicono).
 *
 * Perché non è tautologico (la trappola di clodia-web#178 e #181): non cerca una
 * parola dentro il proprio testo — questo file non sta in `src/` e non è uno dei
 * bersagli. E i bersagli si leggono con `leggiSorgente`, che tratta il file
 * vuoto come un guasto e non come «niente da dire» (clodia-platform#290).
 *
 * **Risolve un livello di indirezione**, come `check-img-auth`: `href={u}` con
 * `u` costruito venti righe sopra è la forma in cui il difetto si nasconde, e un
 * controllo che guardasse solo il testo fra graffe passerebbe verde proprio lì.
 *
 * LIMITE DICHIARATO: vede gli `<a href>` nei `.svelte` sotto `src/`, con un
 * identificatore locale risolto. Un URL che arriva da una funzione o da una prop
 * non lo vede. Restano fuori — legittimamente — gli usi di `channelFileUrl`
 * consumati via `fetch` + `authHeaders()` (`ArtifactCanvas`, `preview/`): lì
 * l'header c'è, ed è la firma a essere inutile.
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { leggiSorgente, senzaCommenti } from './lib/sorgente.mjs';

const RADICE = new URL('../src', import.meta.url).pathname;
/** Il modulo condiviso: unico posto da cui un download deve nascere. */
const MODULO = 'src/lib/download.ts';

/** L'URL di download, sia scritto a mano sia via l'helper non firmato. */
const NON_FIRMATO = /\/download\?path=|\bchannelFileUrl\s*\(/;

function sorgenti(dir) {
	const out = [];
	for (const e of readdirSync(dir)) {
		const p = join(dir, e);
		if (statSync(p).isDirectory()) out.push(...sorgenti(p));
		else if (/\.svelte$/.test(e)) out.push(p);
	}
	return out;
}

/** Valore assegnato a ogni identificatore del file, se è un letterale. */
function assegnazioni(testo) {
	const m = new Map();
	const re = /(?:\$:\s*|(?:let|const|var)\s+)([A-Za-z_$][\w$]*)\s*=\s*([^\n;]+)/g;
	for (const a of testo.matchAll(re)) {
		const [, nome, valore] = a;
		m.set(nome, (m.get(nome) ?? '') + ' ' + valore);
	}
	return m;
}

const guasti = [];

// --- verso 1: nessun href ricostruisce l'URL di download ---------------------
for (const f of sorgenti(RADICE)) {
	const grezzoFile = leggiSorgente(f, guasti, 'link di download');
	if (grezzoFile === null) continue;
	const testo = senzaCommenti(grezzoFile);
	const asg = assegnazioni(testo);
	for (const m of testo.matchAll(/<a\b[^>]*?\bhref\s*=\s*(\{(?:[^{}]|\{[^{}]*\})*\}|"[^"]*")/g)) {
		const grezzo = m[1];
		let valore = grezzo;
		const ident = grezzo.match(/^\{\s*([A-Za-z_$][\w$]*)\s*\}$/);
		if (ident && asg.has(ident[1])) valore += ' ' + asg.get(ident[1]);
		if (!NON_FIRMATO.test(valore)) continue;
		const riga = testo.slice(0, m.index).split('\n').length;
		guasti.push(`${f.replace(RADICE, 'src')}:~${riga}  href=${grezzo.slice(0, 70)}`);
	}
}

// --- verso 2: il modulo condiviso firma davvero ------------------------------
// Senza questo, `openSignedFile` potrebbe aprire l'URL nudo e ogni call-site
// prenderebbe 401 mentre il verso 1 resta verde.
const modulo = leggiSorgente(MODULO, guasti, 'il wrapper che apre i download');
if (modulo !== null) {
	const codice = senzaCommenti(modulo);
	if (!/\bsignedChannelFileUrl\s*\(/.test(codice)) {
		guasti.push(
			`${MODULO}: \`openSignedFile\` non chiama più \`signedChannelFileUrl\` — ` +
				`l'URL che apre non è firmato e ogni link che passa da qui prende 401`
		);
	}
	if (!/\bexport\s+async\s+function\s+openSignedFile\b/.test(codice)) {
		guasti.push(
			`${MODULO}: non esporta più \`openSignedFile\` — le pagine tornano a ` +
				`costruirsi l'URL a mano, che è la causa di clodia-platform#323`
		);
	}
}

if (guasti.length) {
	console.error(
		"Un <a href> punta all'endpoint di download senza URL firmato: la navigazione\n" +
			"non porta l'header Bearer, il backend non trova exp/sig e risponde 401 a\n" +
			'OGNI click (clodia-platform#323). Apri il file con openSignedFile(tier, name,\n' +
			'path) da $lib/download: href="#download" + on:click|preventDefault.\n'
	);
	for (const g of guasti) console.error('  - ' + g);
	process.exit(1);
}
console.log('link di download: nessun <a href> senza firma, il wrapper firma ✓');
