#!/usr/bin/env node
/**
 * Il feed delle osservazioni nomina i connettori anche a chi non è admin.
 *
 * clodia-platform#545 §4. `ObserveFeed` vive nel layout — quindi su qualunque
 * pagina — e traduceva `egress:<famiglia>` leggendo `GET /tools/connectors`,
 * che il gateway serve ai soli ADMIN (`connectors_api._authorize`). Per tutti
 * gli altri quella chiamata finiva in un 401 silenzioso e il feed mostrava la
 * chiave grezza: `avrebbe chiesto conferma a clodia per email.send —
 * egress:mail`. Cioè la forma meno leggibile proprio a chi non amministra, e
 * che quindi ha bisogno del NOME del connettore e non della famiglia con cui il
 * reference monitor classifica quell'uscita.
 *
 * È lo stesso difetto che #521 ha chiuso sulla pagina del topic, nel punto in
 * cui era rimasto: la cura è la stessa, la lista **owner-scoped**
 * `GET /api/topics/{tier}/{name}/connectors`, che l'agent-server serve
 * all'owner umano del topic. Un admin continua a leggere il registry completo,
 * che è più ricco.
 *
 * Metà ESEGUE `src/lib/connettori.js` su fixture; l'altra metà legge DUE file
 * indipendenti (il componente e il client API), nessuno dei quali è questo
 * guard. LIMITE DICHIARATO: la metà testuale vede il testo, non il rendering —
 * non prova che il feed disegni quella frase, prova che prenda i nomi da una
 * sorgente che un non admin può leggere.
 */
import { leggiSorgente, senzaCommenti } from './lib/sorgente.mjs';
import * as connettori from '../src/lib/connettori.js';

const guasti = [];

// Namespace e non import nominali: un export mancante deve diventare un
// GUASTO leggibile, non un SyntaxError che porta via con sé anche i controlli
// sul componente.
const { motivoDiOsservazione, registryUnito } = connettori;

// ── 1. le fixture: due letture PARZIALI, come le ottiene un non admin ───────
//
// La lista owner-scoped di un topic è più povera del registry (niente
// providers, niente pack, `tools_card` ridotta al glifo): se i nomi si
// potessero ricavare solo dalla forma ricca, la cura non funzionerebbe.
const TOPIC_UNO = {
	tier: 'SEAL-1',
	connectors: [
		{
			id: 'sms',
			label: 'SMS',
			schemes: [],
			verbs: [{ verb: 'sms.send', dtype: 'sms' }],
			topic_actions: [],
			tools_card: { icon: '' }
		}
	]
};
const TOPIC_DUE = {
	tier: 'SEAL-2',
	connectors: [
		{
			id: 'corriere',
			label: 'Corriere',
			schemes: [],
			verbs: [{ verb: 'corriere.send', dtype: 'pacchi' }],
			topic_actions: [],
			tools_card: { icon: '' }
		}
	]
};

if (typeof registryUnito !== 'function') {
	guasti.push('src/lib/connettori.js: manca «registryUnito» — i nomi letti un topic per volta non si accumulano');
} else {
	const solo = registryUnito(null, TOPIC_UNO);
	if (!motivoDiOsservazione(solo, 'egress:sms').includes('SMS')) {
		guasti.push("la lista owner-scoped di un topic non basta a nominare il connettore di un'osservazione");
	}

	// Il nome imparato su un topic non deve sparire aprendone un altro: le
	// osservazioni sono effimere, e un feed che dimentica i nomi cambiando
	// pagina mostrerebbe di nuovo la chiave grezza.
	const unito = registryUnito(solo, TOPIC_DUE);
	for (const [chiave, atteso] of [
		['egress:sms', 'SMS'],
		['egress:pacchi', 'Corriere']
	]) {
		if (!motivoDiOsservazione(unito, chiave).includes(atteso)) {
			guasti.push(`unendo due letture parziali si perde «${atteso}» (${chiave})`);
		}
	}

	// Unione per id, non concatenazione: lo stesso connettore torna in ogni
	// lista, e due copie farebbero dipendere la risposta dall'ordine.
	const doppio = registryUnito(TOPIC_UNO, TOPIC_UNO);
	if (doppio.connectors.length !== 1) {
		guasti.push(`registryUnito duplica lo stesso connettore (${doppio.connectors.length} righe)`);
	}

	// E niente nomi inventati: una famiglia che nessuno rivendica resta com'è.
	if (motivoDiOsservazione(unito, 'egress:ignoto') !== 'egress:ignoto') {
		guasti.push('una famiglia che nessun connettore rivendica viene inventata invece che lasciata com\'è');
	}
}

// ── 2. il componente: la sorgente dipende da chi guarda ────────────────────
const FEED = 'src/lib/components/ObserveFeed.svelte';
const feed = leggiSorgente(FEED, guasti, 'il feed delle osservazioni');
if (feed !== null) {
	const codice = senzaCommenti(feed);
	if (!/getTopicConnectors\s*\(/.test(codice)) {
		guasti.push(
			`${FEED}: non legge «getTopicConnectors» — un umano non admin riceve 401 da ` +
				'/tools/connectors e vede la chiave grezza «egress:<famiglia>»'
		);
	}
	if (!/\bisAdmin\b/.test(codice)) {
		guasti.push(
			`${FEED}: non distingue chi guarda; /tools/connectors è da admin e la scelta ` +
				'della sorgente deve dipendere da «isAdmin»'
		);
	}
	// La forma che il difetto aveva: la lettura da admin come UNICA e
	// incondizionata, in `onMount`.
	if (/onMount\([\s\S]*?getConnectorRegistry[\s\S]*?\}\);/.test(codice) && !/caricaConnettori/.test(codice)) {
		guasti.push(`${FEED}: legge il registry da admin incondizionatamente al mount`);
	}
	if (!/registryUnito\s*\(/.test(codice)) {
		guasti.push(`${FEED}: non accumula i connettori letti — i nomi si perdono cambiando pagina`);
	}
}

// ── 3. il client: la rotta owner-scoped è davvero quella ───────────────────
const CLIENT = 'src/lib/api/client.ts';
const client = leggiSorgente(CLIENT, guasti, 'il client API');
if (client !== null) {
	const codice = senzaCommenti(client);
	const m = codice.match(/export async function getTopicConnectors\([\s\S]*?\n}/);
	if (!m) {
		guasti.push(`${CLIENT}: manca «getTopicConnectors», la lettura owner-scoped dei connettori`);
	} else if (/\/tools\/connectors/.test(m[0])) {
		guasti.push(`${CLIENT}: getTopicConnectors legge /tools/connectors, che è da admin`);
	}
}

if (guasti.length) {
	console.error('feed delle osservazioni per un non admin:');
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log('feed osservazioni: i nomi dei connettori arrivano da una sorgente leggibile da un non admin ✓');
