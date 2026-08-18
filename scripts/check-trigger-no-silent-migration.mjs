#!/usr/bin/env node
/**
 * Il trigger di un topic non si migra da solo.
 *
 * I trigger creati prima di clodia-platform#239 hanno un'espressione cron al
 * posto di intervallo+ripetizioni. Il pannello li PROPONE convertiti — campo
 * pre-compilato con la cadenza equivalente — ma la conversione la salva
 * l'owner premendo il bottone. La differenza non è cosmetica: `0 9 * * 1`
 * riscritto come "ogni 10080 minuti" continua a firare ogni settimana ma non
 * più il lunedì alle 9, e un cambio d'orario che nessuno ha chiesto non si
 * nota finché non manca la cosa che quel trigger doveva ricordare.
 *
 * Il guasto che questo controllo previene è una PUT partita dal caricamento
 * del pannello invece che dal click: un aggiunta di due righe in `load()` che
 * "completa la migrazione", verde in ogni type check, e silenziosa in
 * produzione.
 *
 * LIMITE DICHIARATO: è un controllo statico sul solo TopicTriggersPanel. Vede
 * il call site, non il comportamento a runtime: una PUT partita da un modulo
 * terzo, o dietro un livello di indirezione (un alias della funzione, un
 * dispatch dinamico), gli sfugge. Copre la forma in cui il difetto si
 * scriverebbe davvero — dentro questo file, dove sta il resto della logica.
 */
import { readFileSync } from 'node:fs';

const FILE = 'src/lib/components/TopicTriggersPanel.svelte';
const PUT = 'putTopicCronTrigger(';
const guasti = [];

let sorgente = '';
try {
	sorgente = readFileSync(FILE, 'utf8');
} catch (e) {
	console.error(`✗ ${FILE}: non leggibile (${e.code ?? e.message}).`);
	console.error('  Se il pannello è stato spostato, aggiorna questo controllo.');
	process.exit(1);
}

/** Il corpo di una funzione, per bilanciamento di graffe dalla prima `{`.
 *  `null` se la firma non c'è o le graffe non chiudono. */
function corpoDi(testo, firma) {
	const inizio = testo.indexOf(firma);
	if (inizio === -1) return null;
	const apertura = testo.indexOf('{', inizio);
	if (apertura === -1) return null;
	let livello = 0;
	for (let i = apertura; i < testo.length; i++) {
		if (testo[i] === '{') livello++;
		else if (testo[i] === '}' && --livello === 0) return testo.slice(apertura, i + 1);
	}
	return null;
}

/** Occorrenze di `ago` in `pagliaio` (stringa fissa, niente regex). */
function quante(pagliaio, ago) {
	return pagliaio.split(ago).length - 1;
}

const totale = quante(sorgente, PUT);
const corpoSave = corpoDi(sorgente, 'async function save()');

if (totale === 0) {
	guasti.push(`nessuna chiamata a ${PUT} — il pannello non salva più il trigger?`);
} else if (corpoSave === null) {
	guasti.push(
		'`async function save()` non trovata (o graffe sbilanciate): senza di lei ' +
			'questo controllo non sa distinguere un salvataggio esplicito da uno automatico'
	);
} else {
	const dentroSave = quante(corpoSave, PUT);
	if (dentroSave !== totale) {
		guasti.push(
			`${totale - dentroSave} chiamata/e a ${PUT} FUORI da save(): il trigger va ` +
				"salvato solo su azione dell'owner, mai al caricamento del pannello"
		);
	}
}

// La PUT manda i due numeri, e non torna a mandare il cron: il server lo
// rifiuta con 422, ma il messaggio d'errore lo vedrebbe l'utente, non chi
// scrive la riga.
for (const campo of ['interval_minutes:', 'repeat_count:']) {
	if (!sorgente.includes(campo)) {
		guasti.push(`il payload del trigger non contiene \`${campo}\` (#239)`);
	}
}
if (sorgente.includes('cron_expr:')) {
	guasti.push(
		'il pannello manda ancora `cron_expr:` nel payload: sostituito da ' +
			'interval_minutes + repeat_count (#239)'
	);
}

if (guasti.length) {
	console.error(`✗ ${FILE}`);
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}

console.log('trigger di topic: nessuna migrazione silenziosa del cron legacy ✓');
