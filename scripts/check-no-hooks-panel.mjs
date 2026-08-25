#!/usr/bin/env node
/**
 * La webui non offre più di gestire i Chat Hook.
 *
 * clodia-platform#223 (step 3 di #222). La porta pubblica era già chiusa lato
 * server (#300) e la creazione automatica ferma (#211): quello che restava qui
 * era un pannello che elencava, creava, revocava e **rigenerava il segreto** di
 * una capability che nessuna rotta consuma più. Un'interfaccia che si offre di
 * rigenerare il segreto di una feature morta è peggio di nessuna interfaccia:
 * dice che la cosa funziona ancora, e chi la usa configura un integratore
 * contro un indirizzo che risponde 404.
 *
 * Perché un controllo e non solo il diff: le quattro funzioni del client
 * (`listHooks`, `createHook`, `revokeHook`, `deleteHook`) sono l'unica cosa che
 * teneva in piedi il pannello, e riscriverlo costa un `<details>` e una
 * chiamata. In una sidebar dove il pannello Cron e quello Proxy restano
 * legittimamente al loro posto e condividono gli stessi stili, una sezione
 * «Hook» rimessa lì somiglia a un dettaglio dei loro.
 *
 * Il controllo guarda TRE fonti indipendenti, perché la superficie era in tre
 * pezzi e riportarne uno solo basta a farla ricomparire: il client API, la
 * colonna dei trigger e il dialog «nuovo topic» (la spunta che chiedeva il
 * webhook alla creazione).
 *
 * LIMITE DICHIARATO: è un controllo sul TESTO dei file, non sul DOM reso. Vede
 * le tracce elencate qui sotto, non un pannello equivalente scritto con altre
 * parole o in un componente nuovo. Sopra questo soffitto serve un test di
 * render (nel repo oggi non c'è un runner di componenti).
 */
import { existsSync } from 'node:fs';

import { leggiSorgente, senzaCommenti } from './lib/sorgente.mjs';

const CLIENT = 'src/lib/api/client.ts';
const TRIGGERS = 'src/lib/components/TopicTriggersPanel.svelte';
const NUOVO_TOPIC = 'src/routes/topics/+page.svelte';
const PANNELLO = 'src/lib/components/HooksPanel.svelte';

/** Tracce della superficie dismessa, per file. Se una torna, torna la gestione. */
const VIETATI = {
	[CLIENT]: [
		['listHooks', "l'elenco degli hook di una chat"],
		['createHook', 'la creazione di un hook e del suo segreto'],
		['revokeHook', 'la revoca, che rigenerava il segreto'],
		['deleteHook', "la cancellazione dell'hook"],
		['hook_enabled', 'il flag di creazione del webhook nel body di createChannel']
	],
	[TRIGGERS]: [
		['HooksPanel', 'il pannello montato nella colonna dei trigger'],
		['Hook</span>', 'il titolo della sezione rimossa']
	],
	[NUOVO_TOPIC]: [
		['nHookEnabled', 'la spunta «Crea il webhook del topic» nel dialog'],
		['hook_enabled', 'il flag spedito alla creazione del canale']
	]
};

/** Ciò che deve restare: la colonna dei trigger non era solo l'hook, e il
 *  dialog «nuovo topic» non era solo quella spunta. Se la rimozione si porta
 *  via anche questi, ha sforato. */
const RICHIESTI = {
	[TRIGGERS]: [
		['putTopicCronTrigger', 'il trigger cron, unico rimasto in colonna'],
		['class="trigger-kind cron"', 'la sezione Cron della colonna']
	],
	[NUOVO_TOPIC]: [
		['createChannel', 'la creazione del topic dal dialog'],
		['storage_config', "la scelta dello storage, l'altra opzione del dialog"]
	]
};

const guasti = [];

// Il file del pannello non deve esistere. Va chiesto per primo: se tornasse,
// tutto il resto potrebbe essere ancora pulito e la sezione esserci comunque.
if (existsSync(PANNELLO)) {
	guasti.push(`${PANNELLO}: il componente del pannello hook è tornato sul disco`);
}

for (const [file, tracce] of Object.entries(VIETATI)) {
	const src = leggiSorgente(file, guasti, 'superficie hook rimossa');
	if (src === null) continue;
	const codice = senzaCommenti(src);
	for (const [ago, cosa] of tracce) {
		if (codice.includes(ago)) guasti.push(`${file}: ricompare «${ago}» — ${cosa}`);
	}
}

for (const [file, tracce] of Object.entries(RICHIESTI)) {
	const src = leggiSorgente(file, guasti, 'ciò che la rimozione non doveva toccare');
	if (src === null) continue;
	for (const [ago, cosa] of tracce) {
		if (!src.includes(ago)) guasti.push(`${file}: manca «${ago}» — ${cosa}`);
	}
}

if (guasti.length) {
	console.error('superficie hook nella webui:');
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log('superficie hook: nessun pannello, nessuna chiamata, Cron e dialog intatti ✓');
