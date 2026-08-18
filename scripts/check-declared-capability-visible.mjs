#!/usr/bin/env node
/**
 * La scheda dell'agente non può tacere sugli strumenti nativi.
 *
 * clodia-platform#227. La riga «Strumenti nativi» era condizionata alla
 * dichiarazione stessa:
 *
 *     {#if agent.native_tools_info?.declared || agent.native_tools?.length}
 *
 * cioè spariva esattamente nello stato in cui doveva parlare. Un seed che non
 * dichiara `native_tools` cade sul pavimento dell'arciseed — che non contiene
 * `Bash` — e la pagina non mostrava nulla: né la lista, né il perché.
 * `fullstack-dev` ha perso la shell così, e l'unico rilevatore è stato un umano
 * che ha notato, settimane dopo, che un agente sviluppatore non poteva far
 * girare `pytest`.
 *
 * Il difetto non fallisce: RIMUOVE. Un test non lo prende perché non c'è niente
 * da asserire — la sezione semplicemente non è nel DOM — quindi il controllo sta
 * qui, sul call site: la condizione della riga deve dipendere da CHI È l'agent
 * (ha un runtime?), non da COSA HA DICHIARATO.
 *
 * LIMITE DICHIARATO: questo guarda il TESTO del componente, non il DOM reso. Una
 * riscrittura che ottiene lo stesso silenzio per un'altra strada (una variabile
 * intermedia, un `{#if}` più a monte) passa verde. Copre la regressione
 * letterale — che è quella già successa una volta — non ogni modo di tacere.
 */
import { readFileSync } from 'node:fs';

const PAGINA = 'src/routes/agents/[name]/+page.svelte';
const TIPI = 'src/lib/api/types.ts';
const guasti = [];

function leggi(file) {
	try {
		return readFileSync(file, 'utf8');
	} catch {
		guasti.push(`${file}: file assente — spostato, rinominato o mai creato`);
		return null;
	}
}

const pagina = leggi(PAGINA);
if (pagina !== null) {
	// 1. La condizione della riga non deve essere la dichiarazione.
	const condizioneVietata =
		/\{#if\s+agent\.native_tools_info\?\.declared\s*\|\|\s*agent\.native_tools\?\.length\s*\}/;
	if (condizioneVietata.test(pagina)) {
		guasti.push(
			`${PAGINA}: la riga «Strumenti nativi» è condizionata alla dichiarazione — ` +
			'un seed che non dichiara niente (il caso del difetto) non vede la sezione');
	}

	// 2. Il caso non-dichiarato deve DIRE cosa comporta. Senza questo testo la
	//    riga comparirebbe vuota, che è muta quanto l'assenza.
	if (!pagina.includes('Non dichiarati')) {
		guasti.push(
			`${PAGINA}: manca il messaggio del caso non-dichiarato — la riga si rende ` +
			'ma non dice che l\'agent è sceso al pavimento dell\'arciseed');
	}
	if (!/pavimento dell'arciseed/.test(pagina)) {
		guasti.push(`${PAGINA}: il messaggio non nomina il pavimento su cui l'agent è caduto`);
	}

	// 3. Le incoerenze del load devono essere RESE, non solo tipizzate: è il
	//    punto dell'issue — un avviso che resta nel log non lo legge nessuno.
	if (!/agent\.warnings/.test(pagina)) {
		guasti.push(
			`${PAGINA}: gli avvisi del seed (\`warnings\`) non sono resi nella scheda — ` +
			'restano nel log del server, dove nessuno li guarda');
	}
}

const tipi = leggi(TIPI);
if (tipi !== null && !/\bwarnings\?:/.test(tipi)) {
	guasti.push(`${TIPI}: il campo \`warnings\` del payload agents non è tipizzato`);
}

if (guasti.length) {
	console.error('capacità dichiarata e non posseduta, invisibile nella scheda:');
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log('scheda agente: strumenti nativi e incoerenze del seed sempre visibili ✓');
