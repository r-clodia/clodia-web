#!/usr/bin/env node
/**
 * Le scelte non scadono perché è arrivato un altro messaggio
 * (clodia-platform#407 per le pill, #408 per le card di gate).
 *
 * Il difetto era UNA condizione — `i === shownMessages.length - 1` — che
 * decideva se mostrare o no ogni widget della bolla. In un canale a più agenti
 * quella condizione è falsa quasi subito: la domanda perde i bottoni mentre è
 * ancora aperta, e il gate in attesa diventa irraggiungibile finché non scade.
 *
 * Esegue le funzioni vere:
 *  1. una pill sopravvive ai messaggi che arrivano dopo;
 *  2. si chiude col click, con la risposta già data (anche dopo un ricarico,
 *     dove la memoria del click non c'è più), o con una nuova domanda dello
 *     stesso autore — e NON perché ha parlato qualcun altro;
 *  3. una card di gate da decidere resta visibile ovunque sia; una già chiusa
 *     altrove sparisce, tranne che sull'ultimo messaggio.
 * E verifica che la pagina usi quelle regole al posto della posizione.
 */
import { leggiChoices, pillsAttive, rispondeAllePill } from '../src/lib/pillPersistenti.js';
import { gateCardVisibile } from '../src/lib/gateCard.js';
import { leggiSorgente, senzaCommenti } from './lib/sorgente.mjs';

const guasti = [];
const PAGINA = 'src/routes/topics/[tier]/[name]/+page.svelte';

// ── 1. lettura del marcatore ────────────────────────────────────────────────
const ch1 = leggiChoices('Procedo?\n<!-- choices=Procedi,Correggi qualcosa -->');
if (!ch1 || ch1.multi || ch1.items.length !== 2) guasti.push(`choices singola mal letta: ${JSON.stringify(ch1)}`);
const ch2 = leggiChoices('<!-- choices-multi=A,B,C -->');
if (!ch2 || !ch2.multi || ch2.items.length !== 3) guasti.push(`choices-multi mal letta: ${JSON.stringify(ch2)}`);
if (leggiChoices('nessun marcatore') !== null) guasti.push('choices trovate dove non ce ne sono');

// ── 2. quali pill restano vive ──────────────────────────────────────────────
const msg = (id, author, text, kind = 'ai') => ({ id, author, kind, text });
const DOMANDA = 'Come procedo?\n<!-- choices=Procedi,Correggi qualcosa -->';
const MULTI = 'Quali attivo?\n<!-- choices-multi=Email,Telegram,Drive -->';

const caso = (nome, messaggi, risolte, attese) => {
	const vive = [...pillsAttive(messaggi, risolte)].sort();
	if (JSON.stringify(vive) !== JSON.stringify([...attese].sort())) {
		guasti.push(`${nome}: attese [${attese}], trovate [${vive}]`);
	}
};

// il caso della issue: la conversazione va avanti, la domanda è ancora lì
caso('pill viva dopo altri messaggi',
	[msg('m1', 'clodia', DOMANDA), msg('m2', 'sysadmin', 'Intanto ho riavviato il gateway'),
	 msg('m3', 'sistema', 'partecipante aggiunto', 'system')],
	new Set(), ['m1']);
// click: chiusa subito, senza aspettare che il messaggio torni dal backend
caso('pill risolta col click',
	[msg('m1', 'clodia', DOMANDA), msg('m2', 'sysadmin', 'altro')], new Set(['m1']), []);
// ricarico: del click non resta niente in pagina, ma la risposta è in chat
caso('pill chiusa dalla risposta già data',
	[msg('m1', 'clodia', DOMANDA), msg('m2', 'davide', '@clodia Procedi', 'human')],
	new Set(), []);
// una risposta a parole SUE non chiude: meglio una pill di troppo che una in meno
caso('risposta fuori elenco non chiude',
	[msg('m1', 'clodia', DOMANDA), msg('m2', 'davide', '@clodia fai come credi', 'human')],
	new Set(), ['m1']);
// lo stesso agente richiede: vale l'ultima domanda, non due sondaggi paralleli
caso('nuova domanda dello stesso autore',
	[msg('m1', 'clodia', DOMANDA), msg('m2', 'clodia', 'Meglio così?\n<!-- choices=Sì,No -->')],
	new Set(), ['m2']);
// due agenti, due domande aperte: chiuderne una perché ha parlato l'altro
// sarebbe lo stesso difetto di prima, solo più raro
caso('domande di autori diversi convivono',
	[msg('m1', 'clodia', DOMANDA), msg('m2', 'fullstack-dev', MULTI)],
	new Set(), ['m1', 'm2']);
// multipla: il click pubblica l'elenco separato da virgole
caso('multi chiusa dalla risposta composta',
	[msg('m1', 'clodia', MULTI), msg('m2', 'davide', '@clodia Email, Drive', 'human')],
	new Set(), []);
// un AGENTE che ripete una delle voci non risponde per l'utente
caso('solo un umano chiude la domanda',
	[msg('m1', 'clodia', DOMANDA), msg('m2', 'sysadmin', 'Procedi')], new Set(), ['m1']);
// la citazione in corsivo che la pagina antepone non conta come risposta
if (!rispondeAllePill('> Come procedo?\n@clodia Procedi', { items: ['Procedi', 'Correggi qualcosa'] })) {
	guasti.push('la quote della reply impedisce di riconoscere la risposta');
}
if (rispondeAllePill('@clodia Procedi con calma', { items: ['Procedi'] })) {
	guasti.push('una frase che CONTIENE la voce non è la risposta');
}

// ── 3. la card di gate ──────────────────────────────────────────────────────
for (const stato of ['da-decidere', 'decisa']) {
	if (!gateCardVisibile(stato, false)) guasti.push(`card «${stato}» nascosta perché non è l'ultimo messaggio`);
}
if (gateCardVisibile('chiusa', false)) guasti.push('una card decisa altrove resta appesa ai messaggi vecchi');
if (!gateCardVisibile('chiusa', true)) guasti.push("l'esito sull'ultimo messaggio deve restare leggibile");

// ── 4. la pagina usa le regole, non la posizione ────────────────────────────
const src = leggiSorgente(PAGINA, guasti, 'pill e card di gate persistenti');
if (src) {
	const codice = senzaCommenti(src);
	const pills = codice.indexOf('<div class="pills">');
	if (pills < 0) guasti.push(`${PAGINA}: blocco delle pill non trovato`);
	else if (!codice.slice(Math.max(0, pills - 400), pills).includes('pillsVive.has(m.id)')) {
		guasti.push(`${PAGINA}: le pill non sono più guidate da pillsAttive — se il guardiano torna a essere ` +
			'la posizione nella timeline, la issue#407 è tornata con lui');
	}
	const gate = codice.indexOf('decideGate(m.id, g, true)');
	if (gate < 0) guasti.push(`${PAGINA}: card di gate non trovata`);
	else if (!codice.slice(Math.max(0, gate - 2000), gate).includes('gateVisibile')) {
		guasti.push(`${PAGINA}: la card di gate non passa da gateCardVisibile (issue#408)`);
	}
	if (/multiSel\s*=\s*new Set\(\)/.test(codice)) {
		guasti.push(`${PAGINA}: la selezione multipla viene azzerata in blocco — le spunte vivono per ` +
			'messaggio, e cancellarle all\'arrivo di un messaggio è metà della issue#407');
	}
}

if (guasti.length) {
	console.error('check-pill-persistenti:\n  ' + guasti.join('\n  '));
	process.exit(1);
}
console.log('check-pill-persistenti: ok');
