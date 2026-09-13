#!/usr/bin/env node
/**
 * Una lista che scorre non deve SCHIACCIARE le sue voci (clodia-platform#340).
 *
 * In una colonna flex con un tetto (`max-height` + `overflow-y: auto`) i figli
 * hanno `flex-shrink: 1` per default: quando il contenuto supera il tetto, il
 * browser **non** fa comparire la barra di scorrimento — restringe i figli
 * finché ci stanno. Il risultato dipende solo dal loro `overflow`:
 *
 *   - `overflow: hidden` sul figlio → il testo viene tagliato a metà glifo
 *     (è `.live-steps li` del box live: la parete di testo dello screenshot
 *     del 12 set 2026);
 *   - `overflow` visibile        → il testo esce dal riquadro e si SOVRAPPONE
 *     alla voce sotto (è `.recent-topic` e `.exp-row`).
 *
 * In entrambi i casi `overflow-y: auto` sul contenitore è codice morto: non
 * entra mai in funzione. Ed è un difetto che si nota solo quando la lista è
 * LUNGA — cioè in produzione e non mentre lo si scrive, che è la ragione per
 * cui merita una guard invece di una revisione attenta.
 *
 * Il controllo guarda la COPPIA contenitore/figlio, non un selettore per nome:
 * per ogni colonna flex con tetto e scorrimento pretende che esista almeno una
 * regola discendente che dichiari `flex: none` (o `flex-shrink: 0`). Cercare
 * `.live-steps li` e basta avrebbe lasciato vive le altre due, che il giorno
 * della #340 erano già lì.
 *
 *     node scripts/check-lista-scorrevole-non-schiaccia.mjs
 */
import { execFileSync } from 'node:child_process';
import { leggiSorgente } from './lib/sorgente.mjs';

const guasti = [];

/** I file che dichiarano una colonna flex, chiesti a grep e non a una lista
 *  scritta a mano: una lista si stacca dal repo al primo componente nuovo. */
let files = [];
try {
	files = execFileSync('grep', ['-rl', 'flex-direction: column', 'src'], { encoding: 'utf8' })
		.trim()
		.split('\n')
		.filter(Boolean)
		.sort();
} catch {
	// grep esce 1 quando non trova nulla: in questo repo le colonne flex ci
	// sono sempre, quindi zero file significa che stiamo guardando nel posto
	// sbagliato — non che il repo sia pulito.
	guasti.push('nessun file con «flex-direction: column» sotto src/: grep non ha trovato niente');
}

/** Corpi delle regole CSS, col selettore che li precede. Niente parser: le
 *  regole di questi componenti sono piatte e questo basta a leggerle. */
function regole(css) {
	const out = [];
	const re = /([^{}]+)\{([^{}]*)\}/g;
	let m;
	while ((m = re.exec(css))) {
		const sel = m[1].trim().split('\n').pop().trim();
		if (sel.startsWith('@')) continue; // at-rule: il corpo vero sta dentro
		out.push([sel, m[2]]);
	}
	return out;
}

const NON_SI_STRINGE = /flex\s*:\s*(none|0 0)|flex-shrink\s*:\s*0/;

/**
 * Il selettore della prima voce di `.contenitore`, letto dal MARKUP.
 *
 * Serve perché in questo repo le voci di una lista hanno quasi sempre una
 * classe propria e piatta (`.recent-topic` dentro `.recent-list`), non un
 * selettore discendente: guardare solo i selettori che cominciano col nome del
 * contenitore vedrebbe `.live-steps li` e mancherebbe gli altri due casi, che
 * sono esattamente quelli che questa guard è nata per trovare.
 *
 * `null` quando la voce non ha una classe (è il caso di `<li>` nel box live,
 * coperto dal selettore discendente) o quando il markup non si lascia leggere:
 * chi chiama tratta `null` come «nessun indizio da qui», non come un guasto.
 */
function selettoreDellaVoce(src, contenitore) {
	const classe = contenitore.replace(/^\./, '').split(/[\s>:.[]/)[0];
	// Il tag che porta quella classe, così la ricerca può fermarsi alla sua
	// chiusura: senza il confine si finisce per leggere come «voce» il primo
	// elemento che viene DOPO la lista (in `AgentLiveBox` era `.live-empty`,
	// che sta fuori dall'`<ol>`), e una regola estranea che per caso dichiari
	// `flex: none` farebbe passare per protetta una lista che non lo è.
	const apre = new RegExp(`<(\\w+)([^>]*\\bclass="[^"]*\\b${classe}\\b[^"]*")`).exec(src);
	if (!apre) return null;
	const dentro = src.slice(apre.index + apre[0].length);
	const chiude = dentro.indexOf(`</${apre[1]}>`);
	const m = (chiude < 0 ? dentro : dentro.slice(0, chiude)).match(/class="([^"{}]+)"/);
	return m ? `.${m[1].trim().split(/\s+/)[0]}` : null;
}

let controllate = 0;
for (const f of files) {
	const src = leggiSorgente(f, guasti, 'liste che scorrono');
	if (!src) continue;
	const rs = regole(src);
	for (const [sel, body] of rs) {
		const colonna = /display\s*:\s*flex/.test(body) && /flex-direction\s*:\s*column/.test(body);
		const tetto = /max-height\s*:/.test(body);
		const scorre = /overflow(-y)?\s*:\s*(auto|scroll)/.test(body);
		if (!(colonna && tetto && scorre)) continue;
		controllate++;
		// Un figlio qualsiasi che si rifiuti di restringersi basta: è la
		// dichiarazione che tiene in piedi l'altezza della riga e fa comparire
		// davvero la barra di scorrimento.
		const voce = selettoreDellaVoce(src, sel);
		const figli = rs.filter(
			([s]) =>
				s !== sel &&
				(s.startsWith(`${sel} `) ||
					s.startsWith(`${sel}>`) ||
					s.startsWith(`${sel} >`) ||
					(voce && (s === voce || s.startsWith(`${voce}.`) || s.startsWith(`${voce}:`))))
		);
		if (!figli.some(([, b]) => NON_SI_STRINGE.test(b))) {
			guasti.push(
				`${f} → «${sel}»: colonna flex con «max-height» e scorrimento, ma nessuna regola ` +
					`figlia dichiara «flex: none». I figli si stringono per stare nel tetto invece di ` +
					`far scorrere la lista: il testo viene tagliato o si sovrappone, e «overflow-y» ` +
					`non entra mai in funzione.` +
					(figli.length ? ` Regole figlie viste: ${figli.map(([s]) => s).join(', ')}.` : ' Nessuna regola figlia nel file.')
			);
		}
	}
}

// Il bersaglio della #340, chiamato per nome: il controllo generico qui sopra
// non si accorgerebbe di un `.live-steps` che smette di avere un tetto — per
// lui «nessuna colonna da controllare» non è un guasto.
const box = 'src/lib/components/AgentLiveBox.svelte';
const live = leggiSorgente(box, guasti, 'lista dei tool nel box live');
if (live) {
	const step = regole(live).find(([sel]) => sel === '.live-steps li');
	if (!step) {
		guasti.push(`${box}: regola «.live-steps li» non trovata — rinominata? l'altezza degli step non è più protetta`);
	} else if (!NON_SI_STRINGE.test(step[1])) {
		guasti.push(`${box}: «.live-steps li» può restringersi: con più di una decina di chiamate a tool le righe tornano schiacciate (clodia-platform#340)`);
	}
}

if (guasti.length) {
	console.error('liste che scorrono:');
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log(`liste che scorrono: ${controllate} colonne flex col tetto, tutte scorrono invece di schiacciare ✓`);
