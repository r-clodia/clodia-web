#!/usr/bin/env node
/**
 * Un provider a ENDPOINT si collega da schermo (clodia-platform#281).
 *
 * Il provider `generic-openai` esiste nel backend da #265 e serve a puntare un
 * modello che gira altrove: ollama, LM Studio, vLLM. La sua particolarità è che
 * la API key è FACOLTATIVA — un ollama in locale non ne chiede nessuna — e che
 * ciò che lo rende «collegato» è il `base_url`, che il repository non può
 * conoscere perché lo sceglie l'admin.
 *
 * La modale «Connetti» chiedeva solo `api_key` e rifiutava l'invio a chiave
 * vuota: il caso d'uso principale del provider era irraggiungibile dalla UI, e
 * il campo che serviva davvero non esisteva. Non era un errore visibile — la
 * pagina funziona, il messaggio «Inserisci la API key» è chiaro — ed è per
 * questo che regredisce senza rumore: basta una guardia in più su `apiKey`.
 *
 * Il controllo ESEGUE la logica (modulo `src/lib/providerConnect.js`, sul
 * precedente di `gateCard.js`) invece di cercarne il testo: le quattro
 * situazioni qui sotto sono quelle che il backend distingue, e valgono solo se
 * qualcuno le prova davvero.
 *
 * LIMITE DICHIARATO: sul modulo esegue, sulla pagina e su `client.ts` guarda il
 * TESTO — vede che i campi sono in modale e che il payload arriva al backend,
 * non come sono resi. Sopra questo soffitto serve un test di render, che in
 * questo repo oggi non ha un runner.
 */
import {
	connectFields,
	connectInitialValues,
	connectPayload,
	validateConnect
} from '../src/lib/providerConnect.js';

let rotti = 0;
/** @param {boolean} ok @param {string} caso @param {unknown} avuto @param {unknown} atteso */
function verifica(ok, caso, avuto, atteso) {
	if (!ok) rotti++;
	console.log(`${ok ? 'ok  ' : 'ROTTO'} ${caso}: ${JSON.stringify(avuto)} (atteso ${JSON.stringify(atteso)})`);
}

// Le due forme che `GET /api/providers` produce davvero: il provider a endpoint
// dichiara `configurable` + `apikey_optional`, quello classico ha entrambi null.
const endpoint = { configurable: ['base_url', 'model'], apikey_optional: true, base_url: null, model: null };
const classico = { configurable: null, apikey_optional: null, base_url: null, model: null };
const configurato = { ...endpoint, base_url: 'http://localhost:11434/v1', model: 'llama3.1:8b' };

// 1. Il caso per cui esiste il provider: endpoint locale, nessuna chiave.
//    Prima del fix la UI si fermava qui con «Inserisci la API key».
verifica(
	validateConnect(endpoint, { api_key: '', base_url: 'localhost:11434' }) === null,
	'endpoint locale senza chiave → si può inviare',
	validateConnect(endpoint, { api_key: '', base_url: 'localhost:11434' }),
	null
);

// 2. L'endpoint dichiarato e lasciato vuoto è un errore NOSTRO, non un 400 del
//    backend: senza `base_url` il bundle sarebbe una credenziale muta.
verifica(
	typeof validateConnect(endpoint, { api_key: 'sk-x', base_url: '  ' }) === 'string',
	'endpoint dichiarato ma vuoto → errore prima della chiamata',
	validateConnect(endpoint, { api_key: 'sk-x', base_url: '  ' }),
	'un messaggio'
);

// 3. Il provider classico non è cambiato: chiave vuota resta un errore.
verifica(
	validateConnect(classico, { api_key: '' }) === 'Inserisci la API key.',
	'provider classico senza chiave → errore, come prima',
	validateConnect(classico, { api_key: '' }),
	'Inserisci la API key.'
);

// 4. Un campo non DICHIARATO dal provider non deve finire nel corpo: il backend
//    lo rifiuta con 400 invece di ignorarlo, quindi manderlo spezzerebbe il
//    collegamento di un provider che non c'entra niente.
verifica(
	JSON.stringify(connectPayload(classico, { api_key: 'sk-x', base_url: 'localhost:11434' })) ===
		JSON.stringify({ api_key: 'sk-x' }),
	'campo non configurabile → fuori dal payload',
	connectPayload(classico, { api_key: 'sk-x', base_url: 'localhost:11434' }),
	{ api_key: 'sk-x' }
);

// 5. `set_key` riscrive il bundle INTERO: «Riconnetti» deve ripresentare i campi
//    non segreti già compilati, o cancella la configurazione di un provider che
//    stava funzionando. La chiave no: dal backend non torna, e un valore finto
//    farebbe credere di averla ancora.
{
	const v = connectInitialValues(configurato);
	verifica(
		v.base_url === 'http://localhost:11434/v1' && v.model === 'llama3.1:8b' && v.api_key === '',
		'riconnetti → endpoint e modello precompilati, chiave no',
		v,
		{ api_key: '', base_url: 'http://localhost:11434/v1', model: 'llama3.1:8b' }
	);
}

// 6. Solo `base_url` è obbligatorio fra i configurabili: il modello può essere
//    implicito nell'endpoint.
verifica(
	JSON.stringify(connectFields(endpoint)) ===
		JSON.stringify([
			{ name: 'api_key', required: false },
			{ name: 'base_url', required: true },
			{ name: 'model', required: false }
		]),
	'campi del form del provider a endpoint',
	connectFields(endpoint),
	[
		{ name: 'api_key', required: false },
		{ name: 'base_url', required: true },
		{ name: 'model', required: false }
	]
);

// ── La logica giusta serve a poco se la pagina non la usa e il client non la
//    manda: qui si guarda il testo, ed è la metà debole del controllo.
import { leggiSorgente, senzaCommenti } from './lib/sorgente.mjs';

const guasti = [];
const PAGINA = 'src/routes/providers/+page.svelte';
const CLIENT = 'src/lib/api/client.ts';

const pagina = leggiSorgente(PAGINA, guasti, 'modale di collegamento provider');
if (pagina) {
	const codice = senzaCommenti(pagina);
	const richiesti = [
		['validateConnect', 'la validazione per-provider al posto del blocco fisso su apiKey'],
		['connectPayload', 'il corpo filtrato sui campi dichiarati'],
		['connectInitialValues', 'il prefill dei campi non segreti su «Riconnetti»'],
		['bind:value={baseUrl}', "il campo dell'endpoint in modale"],
		['bind:value={model}', 'il campo del modello in modale'],
		['host:port', "il formato accettato dall'endpoint, nel placeholder"]
	];
	for (const [ago, cosa] of richiesti) {
		if (!codice.includes(ago)) guasti.push(`${PAGINA}: manca «${ago}» — ${cosa}`);
	}
	// Il difetto originale, che tornerebbe con una riga: il blocco incondizionato
	// sulla chiave vuota, prima di qualunque distinzione fra provider.
	if (/if\s*\(\s*!\s*apiKey\.trim\(\)\s*\)/.test(codice)) {
		guasti.push(
			`${PAGINA}: la chiave vuota blocca di nuovo l'invio senza guardare il provider — ` +
				'un endpoint locale non ha chiave da inserire'
		);
	}
	// Il meccanismo dedotto dall'id indovinava su cinque provider e sbagliava
	// sugli altri tre: «Connetti» avviava un OAuth su provider apikey.
	if (/id\.endsWith\(['"]-api['"]\)/.test(codice)) {
		guasti.push(`${PAGINA}: il meccanismo torna a essere dedotto dall'id invece che letto da META`);
	}
	for (const pid of ['generic-openai', 'scaleway', 'claude-team']) {
		if (!codice.includes(pid)) guasti.push(`${PAGINA}: «${pid}» manca da META — card senza nome né blurb`);
	}
}

const client = leggiSorgente(CLIENT, guasti, 'client API dei provider');
if (client) {
	const codice = senzaCommenti(client);
	for (const campo of ['configurable', 'apikey_optional', 'base_url', 'model']) {
		if (!codice.includes(campo)) guasti.push(`${CLIENT}: «${campo}» non arriva dal backend a ProviderStatus`);
	}
	// La firma a oggetto è ciò che permette di mandare i campi extra: con la
	// vecchia `(id, api_key)` il resto del lavoro non raggiungerebbe il backend.
	if (!/setProviderKey\([\s\S]{0,200}body:\s*\{/.test(codice)) {
		guasti.push(`${CLIENT}: setProviderKey non accetta più i campi base_url/model nel corpo`);
	}
}

for (const g of guasti) {
	rotti++;
	console.log(`ROTTO ${g}`);
}

if (rotti) {
	console.error(
		`\nUn provider a endpoint non si collega da schermo (${rotti} casi).\n` +
			"La chiave è facoltativa e l'indirizzo è obbligatorio: è l'opposto\n" +
			'della regola valida per tutti gli altri provider.\n'
	);
	process.exit(1);
}
console.log('provider a endpoint: chiave facoltativa, endpoint richiesto e precompilato ✓');
