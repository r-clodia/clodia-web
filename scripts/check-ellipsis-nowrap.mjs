#!/usr/bin/env node
/**
 * `text-overflow: ellipsis` senza `white-space: nowrap` non tronca NIENTE
 * (clodia-platform#340).
 *
 * È la regola del CSS, non una preferenza di stile: l'ellissi si applica al
 * testo che **trabocca su una riga sola**. Se la riga può andare a capo, non
 * trabocca mai — cresce in altezza, e la dichiarazione resta lì a far credere
 * che il troncamento ci sia. Nel box live degli agenti (`AgentLiveBox`) il
 * risultato era la parete di testo segnalata da Davide: ogni chiamata a tool
 * con payload JSON lungo occupava N righe dentro un `max-height: 180px`, e le
 * voci separate da `gap: 2px` sembravano sovrapposte.
 *
 * Il guard non guarda un selettore in particolare: guarda la **coppia**, in
 * tutti i componenti. La dichiarazione orfana si riproduce per copia-incolla —
 * si copia la regola «che tronca» da un componente all'altro perdendo per
 * strada la riga che la fa funzionare, e nessuno se ne accorge finché il testo
 * non diventa lungo. Trovarla su un selettore solo avrebbe lasciato viva la
 * stessa riga altrove: alla scrittura di questo file era già così in
 * `Sidebar.svelte`, con etichette corte che mascheravano il difetto.
 *
 * Tollerato `white-space: pre` (tronca anch'esso: niente a capo automatico).
 * Rifiutati `pre-wrap`, `pre-line`, `normal`: vanno a capo.
 *
 *     node scripts/check-ellipsis-nowrap.mjs
 */
import { execFileSync } from 'node:child_process';
import { leggiSorgente } from './lib/sorgente.mjs';

const guasti = [];

/** I file che nominano `text-overflow`, chiesti a grep invece che a una lista
 *  scritta a mano: una lista si stacca dal repo al primo componente nuovo. */
let files = [];
try {
	files = execFileSync('grep', ['-rl', 'text-overflow', 'src'], { encoding: 'utf8' })
		.trim()
		.split('\n')
		.filter(Boolean)
		.sort();
} catch {
	// grep esce 1 quando non trova nulla: nel repo che stiamo proteggendo
	// almeno una regola con ellissi c'è sempre, quindi zero file è il sintomo
	// che stiamo guardando nel posto sbagliato, non un repo pulito.
	guasti.push('nessun file con «text-overflow» sotto src/: grep non ha trovato niente');
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

let controllate = 0;
for (const f of files) {
	const src = leggiSorgente(f, guasti, 'regole con ellissi');
	if (!src) continue;
	for (const [sel, body] of regole(src)) {
		if (!/text-overflow\s*:\s*ellipsis/.test(body)) continue;
		controllate++;
		if (!/white-space\s*:\s*(nowrap|pre)\s*[;}]/.test(body)) {
			guasti.push(
				`${f} → «${sel}»: ha «text-overflow: ellipsis» ma non «white-space: nowrap». ` +
					`Senza nowrap il testo va a capo, non trabocca mai e l'ellissi non compare: ` +
					`la regola sembra troncare e invece impila righe.`
			);
		}
		if (!/overflow(-x)?\s*:\s*(hidden|clip|auto|scroll)/.test(body)) {
			guasti.push(
				`${f} → «${sel}»: «text-overflow: ellipsis» senza «overflow: hidden»: ` +
					`il testo esce dal riquadro invece di essere troncato.`
			);
		}
	}
}

// Il bersaglio della #340, chiamato per nome: se un domani la lista degli step
// smette di troncare (o il selettore viene rinominato) il controllo generico
// sopra non se ne accorgerebbe — non trovare una regola non è un guasto per lui.
const box = 'src/lib/components/AgentLiveBox.svelte';
const live = leggiSorgente(box, guasti, 'lista dei tool nel box live');
if (live) {
	const step = regole(live).find(([sel]) => sel === '.live-steps li');
	if (!step) {
		guasti.push(`${box}: regola «.live-steps li» non trovata — rinominata? il troncamento degli step non è più protetto`);
	} else if (!/white-space\s*:\s*nowrap/.test(step[1])) {
		guasti.push(`${box}: «.live-steps li» non ha «white-space: nowrap» (clodia-platform#340)`);
	}
	// Troncare senza dare modo di leggere l'intero è mezzo lavoro: il payload
	// del tool deve restare raggiungibile col puntatore.
	if (!/<li[^>]*\btitle=/.test(live)) {
		guasti.push(`${box}: l'«<li>» degli step non ha «title»: troncato sulla riga, il payload completo non è più leggibile da nessuna parte`);
	}
}

if (guasti.length) {
	console.error('ellissi senza nowrap:');
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log(`ellissi e nowrap: ${controllate} regole con ellissi in ${files.length} file, tutte troncano davvero ✓`);
