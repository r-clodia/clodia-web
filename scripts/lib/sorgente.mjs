/**
 * Lettura del bersaglio di un guard, con TRE esiti invece di due
 * (clodia-platform#290).
 *
 * Sette dei venti guard di questo repo passavano verdi su un file **vuoto**:
 * il `catch` copriva il file assente, ma un file di zero byte si legge senza
 * errori, produce `''`, e il `if (src) { …controlli… }` che seguiva saltava
 * l'intero blocco. Exit 0, messaggio di successo, zero controlli eseguiti —
 * cioè il guasto che la #263 chiede di chiudere, dentro l'attrezzatura che
 * quella issue ha costruito.
 *
 * Un file svuotato non è uno scenario di laboratorio: lo produce un merge
 * risolto male, un `>` di troppo, un refactor che sposta il contenuto e lascia
 * il file. Ed è **peggiore** del file cancellato, perché il build continua a
 * funzionare e la pagina si costruisce vuota.
 *
 * La regola che questo modulo impone: **un guard non deve poter riuscire senza
 * aver controllato niente.** Se il bersaglio non è leggibile — assente, vuoto o
 * illeggibile — quello è l'esito negativo del guard, non un motivo per tacere.
 */
import { readFileSync } from 'node:fs';

/**
 * Legge `file` e ritorna il suo contenuto, oppure `null` avendo già registrato
 * il guasto in `guasti`.
 *
 * `null` significa «non ho niente da controllare», e il chiamante deve
 * *saltare* i suoi controlli su questo file — non riuscire. La differenza col
 * codice che sostituisce è che qui il guasto è già stato registrato, quindi
 * saltare non produce più un verde.
 *
 * @param {string} file      percorso, relativo alla radice del repo
 * @param {string[]} guasti  accumulatore dei guasti del guard
 * @param {string} [cosa]    cosa protegge quel file, per il messaggio
 * @returns {string|null}
 */
export function leggiSorgente(file, guasti, cosa = '') {
	const dove = cosa ? ` (${cosa})` : '';
	let testo;
	try {
		testo = readFileSync(file, 'utf8');
	} catch (e) {
		// ENOENT è l'esito atteso quando il file è stato spostato o rinominato:
		// è un risultato del controllo, non un incidente da stack trace. Gli
		// altri errori (permessi, directory al posto del file) vanno distinti,
		// perché suggeriscono rimedi diversi.
		const perche = e && e.code === 'ENOENT' ? 'file assente — spostato o rinominato' : `file illeggibile (${e && e.code})`;
		guasti.push(`${file}: ${perche}${dove}`);
		return null;
	}
	if (testo.trim() === '') {
		guasti.push(
			`${file}: file VUOTO — nessun controllo eseguito su questo bersaglio${dove}. ` +
				`Un file di zero byte si legge senza errori: se il guard tacesse qui, ` +
				`sarebbe verde senza aver guardato niente (clodia-platform#290)`
		);
		return null;
	}
	return testo;
}

/**
 * Spoglia i commenti prima di cercare dentro il codice.
 *
 * Vive qui perché la stessa riga era copiata in cinque guard, e perché la
 * ragione è una sola e vale per tutti: un controllo che cerca una PAROLA la
 * trova anche nel commento che spiega la regola — e i guard di questo repo il
 * commento ce l'hanno, di solito proprio sopra il codice controllato (web#181).
 */
export function senzaCommenti(s) {
	return s
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
