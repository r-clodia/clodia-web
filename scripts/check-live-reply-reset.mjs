#!/usr/bin/env node
/**
 * L'arrivo di un messaggio NON è la fine del turno.
 *
 * Un turno può pubblicare più volte — bolle per blocco (clodia-platform#243) o
 * post via tool — e il codice che reagisce ai messaggi nuovi cancellava tutto il
 * live dell'autore, leggendo «è arrivato un suo messaggio» come «ha finito».
 * Effetto visibile: la risposta parziale compariva, l'agente continuava a
 * lavorare, e il testo spariva da sotto gli occhi di chi stava leggendo.
 *
 * La separazione da tenere è questa:
 *   - messaggio nuovo   → `resetLiveReply` (via il solo testo ormai permanente,
 *                         non tutto il buffer: clodia-platform#250)
 *   - fine del turno    → `resetLive` (tutto), e la dichiara `active_responders`
 *
 * Perché un controllo e non un commento: la regressione è MUTA. Rimettere
 * `resetLive` nel giro dei messaggi compila, passa i tipi, non emette nulla —
 * si vede solo guardando una chat dal vivo e sapendo cosa aspettarsi.
 */
import { leggiSorgente } from './lib/sorgente.mjs';

const FILE = 'src/routes/topics/[tier]/[name]/+page.svelte';
const guasti = [];

// Vuoto e assente sono entrambi «niente da controllare», e nessuno dei due
// deve produrre un verde (#290).
const src = leggiSorgente(FILE, guasti);

if (src !== null) {
	if (!/function resetLiveReply\s*\(/.test(src)) {
		guasti.push(
			`${FILE}: manca resetLiveReply — senza di essa l'unico azzeramento è quello totale`
		);
	}

	// Il giro sui messaggi nuovi deve azzerare SOLO il testo.
	const giro = src.match(/for \(const \[a, \w+\] of newAiTexts\([^)]*\)\)\s*(\w+)\(a,/);
	if (!giro) {
		guasti.push(
			`${FILE}: non trovo il giro su newAiTexts — se è stato riscritto, riscrivi anche questo controllo`
		);
	} else if (giro[1] !== 'resetLiveReply') {
		guasti.push(
			`${FILE}: i messaggi nuovi chiamano ${giro[1]}() invece di resetLiveReply(): ` +
				`un turno che pubblica più volte perde il live a metà strada`
		);
	}

	// E `resetLiveReply` deve SOTTRARRE il testo persistito, non svuotare il
	// buffer: svuotarlo cancella anche il blocco successivo già in streaming e
	// manda la bolla nello stato vuoto — lo unmount/remount che si vede come
	// lampeggio (clodia-platform#250). Il giro qui sopra passa i testi proprio
	// perché servono a questa sottrazione: se tornano inutilizzati, la riga
	// compila e il difetto è di nuovo lì.
	if (!/consumePersistedAll/.test(src)) {
		guasti.push(
			`${FILE}: resetLiveReply non usa consumePersistedAll ($lib/liveReply): ` +
				`azzerare tutto il testo rimette il lampeggio per blocco`
		);
	}

	// E la fine del turno deve continuare a esistere: azzerare solo il testo, e
	// mai il resto, lascerebbe accesi per sempre i box di un turno morto.
	if (!/active_responders/.test(src) || !/resetLive\(a\)/.test(src)) {
		guasti.push(
			`${FILE}: la cintura di fine turno (active_responders → resetLive) non c'è più: ` +
				`il ragionamento di un turno morto resterebbe a schermo`
		);
	}
}

if (guasti.length) {
	console.error('reset del live in streaming:');
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log('reset del live: messaggio → solo testo, fine turno → tutto ✓');
