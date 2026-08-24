#!/usr/bin/env node
/**
 * Un job FERMO non si mostra come «ok»: dove si legge lo stato, si legge anche
 * la freschezza (issue clodia-platform#287).
 *
 * Il difetto misurato il 24 ago 2026 sull'istanza: i due backup ISO 27001
 * A.8.13 erano fermi da 68 e 355 ore e nella webui risultavano `ok`. Non per un
 * dato mancante — `GET /clodia/jobs` allega `stale` e `stale_reason` a ogni job
 * dal fix di #273, e `normaliseJob` li porta fino al componente con lo spread
 * dei campi ignoti. Semplicemente **nessuno li leggeva**: `grep -rn stale src`
 * dava zero occorrenze. Il campo esisteva, era corretto, viaggiava nel payload e
 * moriva nel client; l'unico posto in cui il guasto era visibile restava il log
 * del container, cioè il posto in cui nessuno guarda se non sta già cercando un
 * guasto.
 *
 * È il tipo di difetto che nessun tipo e nessun errore segnalano: la pagina si
 * costruisce, il test passa, e a schermo compare un'affermazione falsa. Per
 * questo il controllo sta qui e non nella `svelte-check`.
 *
 * Il badge NON sostituisce lo stato dell'ultimo run: `last_status` («l'ultima
 * volta è andata bene») e `stale` («l'ultima volta è di tre giorni fa») sono due
 * fatti veri INSIEME, e mostrarne uno al posto dell'altro perde l'informazione
 * che chi apre la pagina è venuto a cercare. Quindi si pretende che sulle stesse
 * superfici ci siano entrambi.
 *
 * LIMITE DICHIARATO: questo controllo verifica le superfici ELENCATE sotto, non
 * scopre quelle nuove. Una terza pagina che domani mostri lo stato di un job
 * senza la freschezza passa verde — chi la aggiunge aggiunge la riga. È lo
 * stesso prezzo (e la stessa scelta) di `check-multi-spawn-badge.mjs`.
 */
import { readFileSync } from 'node:fs';

/** file → cosa mostra (il testo compare nel messaggio d'errore). */
const SUPERFICI = {
	'src/routes/jobs/+page.svelte': 'colonna Stato della lista job',
	'src/routes/jobs/[id]/+page.svelte': 'stato del job nel dettaglio'
};

const BADGE = 'StaleBadge';
const guasti = [];

/** Il file, o `null` con il guasto registrato: un ENOENT qui è un esito del
 *  controllo (la superficie non c'è più), non un incidente da stack trace. */
function leggi(file, cosa) {
	try {
		return readFileSync(file, 'utf8');
	} catch {
		guasti.push(`${file}: file assente — spostato, rinominato o mai creato (${cosa})`);
		return null;
	}
}

/** Un guard che cerca una parola la trova anche nel commento che spiega la
 *  regola (web#181): si spoglia il file prima di cercarci dentro. */
const senzaCommenti = (s) =>
	s
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/(^|[^:])\/\/[^\n]*/g, '$1');

for (const [file, cosa] of Object.entries(SUPERFICI)) {
	const src = leggi(file, cosa);
	if (src === null) continue;
	const nudo = senzaCommenti(src);
	if (!nudo.includes(`${BADGE}.svelte`)) {
		guasti.push(
			`${file}: non importa ${BADGE} — un job fermo da giorni si legge «ok» (${cosa})`
		);
		continue;
	}
	if (!new RegExp(`<${BADGE}\\b`).test(nudo)) {
		guasti.push(`${file}: importa ${BADGE} ma non lo rende (${cosa})`);
	}
	// Il badge affianca lo stato, non lo sostituisce: se da questa superficie
	// sparisse `StatusDot`, il badge starebbe raccontando metà della verità.
	if (!/<StatusDot\b/.test(nudo)) {
		guasti.push(
			`${file}: non rende più StatusDot: la freschezza ha sostituito l'esito ` +
				`dell'ultimo run invece di affiancarlo (${cosa})`
		);
	}
}

// Il badge deve dire PERCHÉ: «stale» da solo è un'etichetta, `stale_reason` è il
// fatto («68.1 ore senza run, ma la cadenza è ogni 1440 min») ed è ciò che
// permette di decidere se rieseguire a mano.
const badge = leggi(`src/lib/components/${BADGE}.svelte`, 'componente del badge');
if (badge !== null && !senzaCommenti(badge).includes('reason')) {
	guasti.push(`${BADGE}.svelte: non espone stale_reason — il motivo resta nel log`);
}

// Un campo consumato ma non tipizzato è consumato per caso: `normaliseJob` lo fa
// passare con lo spread, e il primo refactor che stringe il tipo lo perde senza
// che niente diventi rosso.
const tipi = leggi('src/lib/api/types.ts', 'contratto del payload jobs');
for (const campo of ['stale', 'stale_reason']) {
	if (tipi !== null && !new RegExp(`\\b${campo}\\b`).test(senzaCommenti(tipi))) {
		guasti.push(`src/lib/api/types.ts: il campo ${campo} del payload jobs non è tipizzato`);
	}
}

if (guasti.length) {
	console.error('freschezza dei job invisibile:');
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log(
	`freschezza dei job: badge STALE + motivo accanto allo stato in ` +
		`${Object.keys(SUPERFICI).length} superfici ✓`
);
