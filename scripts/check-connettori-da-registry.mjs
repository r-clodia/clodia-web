#!/usr/bin/env node
/**
 * I connettori li disegna il REGISTRY, non questo repository.
 *
 * clodia-platform#520. Fino a qui ogni connettore esisteva nel frontend per
 * nome: cinque card scritte a mano nella pagina Tools, tre bottoni con tre
 * dialog nella pagina del topic, le etichette degli schemi, i motivi del feed
 * delle osservazioni. Un connettore che arriva con un pack non poteva comparire
 * da nessuna parte senza un deploy di questo repository — cioè il registry di
 * #518 e le rotte generiche di #519 si fermavano un passo prima di servire a
 * qualcosa.
 *
 * Il controllo ha due metà, ed è la prima quella che vale:
 *
 * 1. **esegue** le derivazioni su un registry FIXTURE che contiene un
 *    connettore dichiarato solo da un pack di prova. Se da quel payload escono
 *    la card e il bottone, allora un pack nuovo compare davvero — che è il
 *    criterio di accettazione della issue, verificato senza installare un pack;
 * 2. **guarda il testo** delle pagine: le card non si costruiscono più per
 *    connettore, e i nomi dei connettori spariti non sono rimasti in giro.
 *
 * Due scostamenti dichiarati, che questo controllo lascia passare APPOSTA e
 * nominandoli, perché un'eccezione taciuta è peggio di un'eccezione:
 *
 * - **la cartella Mac resta cablata** nella pagina del topic: non è un
 *   connettore (nessuno schema, nessun verbo, nessuna whitelist — dichiara un
 *   bind di filesystem) e nessuna grammatica del manifest la descrive;
 * - **l'OAuth resta sul flusso Google**: #519 ha lasciato `kind: oauth` fuori
 *   dalla rotta generica (credenziali d'applicazione, stato fra le due gambe,
 *   callback), quindi un flusso generico non esiste ancora. Qui si pretende che
 *   sia UN ramo solo, nominato.
 *
 * `mailbox` non è nell'elenco dei nomi vietati: è il nome di un INSIEME DI
 * VALORI del gateway (`OPTION_SETS`), non di un connettore. La pagina che
 * amministra quei valori può nominarli — e il pannello si aggancia all'insieme,
 * quindi un altro connettore che puntasse un campo sullo stesso insieme lo
 * erediterebbe senza che nessuno lo colleghi.
 *
 * LIMITE DICHIARATO: sul modulo esegue, sulle pagine guarda il TESTO. Vede che
 * le card arrivano da `cardsDiTools`, non come sono rese.
 */
import { leggiSorgente, senzaCommenti } from './lib/sorgente.mjs';
import { azioniDiTopic, cardsDiTools, motivoDiOsservazione, esempiPerDirezione } from '../src/lib/connettori.js';

const guasti = [];

// ── 1. un connettore che esiste solo in un pack ─────────────────────────────
//
// Nessun nome che questo repository conosca: il punto è esattamente che non lo
// conosce. Dichiara uno schema, un'azione di topic e una credenziale a form.
const PACK = {
	id: 'sms',
	label: 'SMS',
	pack: 'sms-pack',
	namespace: 'sms',
	builtin: false,
	schemes: [
		{
			scheme: 'sms',
			direction: 'both',
			label: 'Numero SMS',
			icon: '',
			hierarchical: false,
			danger: '',
			forms: [{ label: 'numero', example: '+393331234567' }]
		}
	],
	providers: [
		{
			id: 'gateway',
			label: 'Gateway SMS',
			kind: 'form',
			vault_entry: 'sms_api',
			connected: false,
			fields: [{ name: 'api_key', label: 'API key', secret: true, required: true, placeholder: '' }]
		}
	],
	verbs: [{ verb: 'sms.send', direction: 'egress', scheme: 'sms', prefix: false, dtype: 'sms' }],
	topic_actions: [
		{
			id: 'sms-link',
			label: 'Autorizza un numero',
			binding: '',
			admin_only: false,
			fields: [{ name: 'numero', label: 'Numero', required: true, placeholder: '+39…' }],
			adds: { ingress: ['sms:{numero}'], egress: ['sms:{numero}'] }
		}
	],
	tools_card: {
		setup_label: 'Incolla la API key',
		status_verb: '',
		docs_url: '',
		blurb: 'Invio di SMS dai verbi del pack.',
		scope: 'api.esempio-sms.eu',
		icon: 'generico'
	}
};

/** Un connettore che è solo un VOCABOLARIO: niente card, niente bottone. */
const VOCABOLARIO = {
	id: 'vocabolario',
	label: 'Vocabolario',
	pack: 'sms-pack',
	namespace: 'voc',
	builtin: true,
	schemes: [],
	providers: [],
	verbs: [],
	topic_actions: [],
	tools_card: null
};

/** Un'azione riservata a un admin dell'istanza. */
const RISERVATO = {
	...PACK,
	id: 'riservato',
	label: 'Riservato',
	topic_actions: [{ ...PACK.topic_actions[0], id: 'ris-link', admin_only: true }]
};

const REGISTRY = { connectors: [PACK, VOCABOLARIO, RISERVATO] };

const cards = cardsDiTools(REGISTRY, []);
const card = cards.find((c) => c.id === 'sms');
if (!card) {
	guasti.push(
		'un connettore dichiarato solo da un pack non produce nessuna card: ' +
			'il registry non arriva alla pagina Tools'
	);
} else {
	if (card.blurb !== PACK.tools_card.blurb) guasti.push('la card non usa il testo che il pack dichiara');
	if (card.scope !== PACK.tools_card.scope) guasti.push('la card non usa lo scope che il pack dichiara');
	if (card.icon !== 'generico') guasti.push('la card non usa il glifo che il pack sceglie');
	if (!card.wired) guasti.push('la card di un connettore con credenziale non è collegabile');
	if (card.credenziale?.id !== 'gateway') guasti.push('la card non porta il provider da connettere');
}
if (cards.some((c) => c.id === 'vocabolario')) {
	guasti.push(
		'un connettore senza `tools_card` produce comunque una card: la pagina si ' +
			'riempirebbe di scatole che non si collegano a niente'
	);
}

// Lo stato vivo si innesta su quello dichiarato, e ciò che il gateway monta
// senza manifest (backend MCP) resta una card.
const conVivo = cardsDiTools(REGISTRY, [
	{ id: 'sms', connected: true, accounts: ['acme'], operational: true },
	{ id: 'un-mcp', label: 'Un MCP', provider: 'mcp', connected: true, transport: 'stdio' }
]);
if (!conVivo.find((c) => c.id === 'sms')?.connected) {
	guasti.push('lo stato vivo di `GET /tools` non si innesta sulla card del registry');
}
if (!conVivo.some((c) => c.id === 'un-mcp')) {
	guasti.push('un backend montato senza manifest sparisce dalla pagina');
}
if (conVivo.filter((c) => c.id === 'sms').length !== 1) {
	// clodia-platform#526: a live row and the registry card of the same id are
	// ONE card (the mailbox row used to be `mailboxes` beside `mail`: drawn twice).
	guasti.push('una riga di `GET /tools` con l\'id di una card del registry produce due card');
}
// The edition is the gateway's (#526): the page no longer filters on the
// profile's names, which are not the registry's ids.
if (cardsDiTools(REGISTRY, [], { ammessi: [] }).length === 0) {
	guasti.push('la pagina Tools filtra ancora le card sul profilo: lo fa il gateway');
}

const azioni = azioniDiTopic(REGISTRY, { isAdmin: false });
if (!azioni.some((a) => a.chiave === 'sms/sms-link')) {
	guasti.push(
		"un'azione dichiarata solo da un pack non produce nessun bottone: " +
			'il registry non arriva alla pagina del topic'
	);
}
if (azioni.some((a) => a.adminOnly)) {
	guasti.push(
		"un'azione `admin_only` è offerta a chi non è admin — collegare una risorsa " +
			"dell'istanza non è dell'owner della stanza"
	);
}
if (!azioniDiTopic(REGISTRY, { isAdmin: true }).some((a) => a.chiave === 'riservato/ris-link')) {
	guasti.push("un'azione `admin_only` non compare nemmeno a un admin: sarebbe irraggiungibile");
}

// Gli esempi e i motivi vengono dal registry, non da una tabella locale.
if (!esempiPerDirezione(REGISTRY, 'egress').includes('sms:+393331234567')) {
	guasti.push("gli esempi del campo «nuova voce» non vengono dagli schemi installati");
}
if (!motivoDiOsservazione(REGISTRY, 'egress:sms').includes('SMS')) {
	guasti.push("il motivo di un'osservazione non viene dal connettore che dichiara quella famiglia");
}
if (motivoDiOsservazione(REGISTRY, 'egress:ignoto') !== 'egress:ignoto') {
	guasti.push('una famiglia che nessun connettore rivendica viene inventata invece che lasciata com\'è');
}

// ── 2. le pagine non conoscono più i connettori ────────────────────────────
const TOOLS = 'src/routes/tools/+page.svelte';
const TOPIC = 'src/routes/topics/[tier]/[name]/+page.svelte';

const tools = leggiSorgente(TOOLS, guasti, 'la pagina Tools');
if (tools !== null) {
	const codice = senzaCommenti(tools);
	if (!codice.includes('cardsDiTools')) {
		guasti.push(`${TOOLS}: le card non arrivano più da «cardsDiTools»`);
	}
	if (/const BASE\b/.test(codice)) {
		guasti.push(`${TOOLS}: è tornata la tabella «BASE» delle card scritte a mano`);
	}
	if (/\bc\.id === '/.test(codice)) {
		guasti.push(`${TOOLS}: una card è trattata per il suo id — è il per-connettore che la issue toglie`);
	}
	const rami = [...codice.matchAll(/kind === '/g)].length;
	if (rami > 1) {
		guasti.push(
			`${TOOLS}: ${rami} rami su «kind»; l'unico ammesso è l'OAuth, che #519 ha ` +
				'lasciato fuori dalla rotta generica'
		);
	}
	for (const nome of ['telegram', 'openai', 'botfather']) {
		if (new RegExp(nome, 'i').test(codice)) {
			guasti.push(`${TOOLS}: nomina ancora «${nome}» — quel flusso cablato non esiste più`);
		}
	}
}

const topic = leggiSorgente(TOPIC, guasti, 'la pagina del topic');
if (topic !== null) {
	const codice = senzaCommenti(topic);
	for (const [ago, cosa] of [
		['azioniDiTopic', 'i bottoni, dai connettori installati'],
		['esempiPerDirezione', 'gli esempi del campo «nuova voce», dagli schemi installati']
	]) {
		if (!codice.includes(ago)) guasti.push(`${TOPIC}: manca «${ago}» — ${cosa}`);
	}
	for (const nome of ['telegram', 'gdrive', 'google', 'github', 'openai']) {
		if (new RegExp(nome, 'i').test(codice)) {
			guasti.push(
				`${TOPIC}: nomina ancora «${nome}» — i bottoni di una stanza li dichiarano ` +
					'i connettori installati'
			);
		}
	}
	// Lo scostamento dichiarato: la cartella Mac, che connettore non è.
	if (!/Cartella Mac/.test(codice)) {
		guasti.push(
			`${TOPIC}: sparita la cartella condivisa — non è un connettore e non torna ` +
				'dal registry, quindi se sparisce di qui sparisce e basta'
		);
	}
}

// Gli altri due bersagli nominati dalla issue.
for (const [file, nomi, cosa] of [
	['src/lib/components/ObserveFeed.svelte', ['telegram', 'drive', 'gsheets', 'github'], 'i motivi delle osservazioni'],
	['src/lib/components/UriLabel.svelte', ['drive', 'gdrive'], "l'etichetta di una voce di whitelist"],
	['src/routes/settings/egress/+page.svelte', ['mailto:', 'gdrive', 'telegram'], 'i placeholder delle liste globali']
]) {
	const src = leggiSorgente(file, guasti, cosa);
	if (src === null) continue;
	const codice = senzaCommenti(src);
	for (const nome of nomi) {
		if (new RegExp(nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(codice)) {
			guasti.push(`${file}: nomina ancora «${nome}» — ${cosa} vengono dal registry`);
		}
	}
}

if (guasti.length) {
	console.error('connettori dal registry:');
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log(
	'connettori dal registry: un connettore di pack produce card e bottone, ' +
		'le pagine non conoscono più i nomi ✓'
);
