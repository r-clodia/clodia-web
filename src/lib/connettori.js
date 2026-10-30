/**
 * Dal registry dei connettori a ciò che le pagine disegnano.
 *
 * clodia-platform#520. Fino a qui ogni connettore esisteva nel frontend per
 * NOME: la riga `BASE` della pagina Tools con cinque card scritte a mano, i
 * bottoni Telegram/Drive/Mailbox della pagina del topic con la loro modale e il
 * loro stato, le etichette degli schemi, i `WHY` del feed delle osservazioni.
 * Un connettore che arriva con un pack non poteva comparire da nessuna parte
 * senza un deploy di questo repository — cioè il registry di #518 e le rotte
 * generiche di #519 si fermavano un passo prima di servire a qualcosa.
 *
 * Qui dentro ci sono SOLO derivazioni pure del payload di `GET /connectors`:
 * nessuna fetch, nessuno stato, nessun nome di connettore. È un modulo `.js` e
 * non `.ts` apposta — lo script di guard lo importa ed ESEGUE, invece di
 * cercarne il testo.
 *
 * Il modello che le pagine ricevono è deliberatamente lo stesso di prima
 * (`CardModel`, i bottoni della riga egress): questa issue cambia da DOVE
 * vengono quei dati, non come sono disegnati — così la parità visiva è
 * verificabile leggendo il markup, che resta quello.
 */

/** @typedef {{scheme: string, direction: string, label: string, icon: string,
 *             hierarchical: boolean, danger: string,
 *             forms: {label: string, example: string}[]}} Schema */
/** Un campo come lo DICHIARA il manifest: `options` è il NOME di un insieme di
 * valori del gateway (`mailboxes`), non i valori. Quelli li risolve la rotta di
 * stato dell'azione, ed è un'altra forma (`ConnectorActionState`).
 * @typedef {{name: string, label: string, required: boolean,
 *            placeholder: string, options?: string}} Campo */
/** @typedef {{id: string, label: string, kind: string, vault_entry: string,
 *             connected?: boolean, fields: Campo[]}} Provider */
/** @typedef {{id: string, label: string, binding: string, admin_only: boolean,
 *             fields: Campo[], adds: {ingress: string[], egress: string[]}}} Azione */
/** @typedef {{id: string, label: string, pack: string, namespace: string,
 *             builtin: boolean, schemes: Schema[], providers: Provider[],
 *             verbs: {verb: string, dtype: string}[], topic_actions: Azione[],
 *             tools_card: {setup_label: string, blurb: string, scope: string,
 *                          icon: string, docs_url: string} | null,
 *             pairing?: boolean,
 *             relay?: {label?: string, attachments?: boolean, schemes?: string[]}}} Connettore */

/** I connettori del payload, in una forma sempre iterabile.
 * @param {unknown} registry */
function elenco(registry) {
	const payload = /** @type {{connectors?: unknown}} */ (registry) ?? {};
	const righe = Array.isArray(payload.connectors) ? payload.connectors : [];
	return /** @type {Connettore[]} */ (righe);
}

/**
 * Le card della pagina Tools: il registry dice COSA sono i connettori, lo
 * snapshot di `GET /tools` dice come stanno adesso.
 *
 * Due sorgenti e non una perché rispondono a due domande diverse. Il registry
 * conosce anche i connettori che nessuno ha ancora collegato — ed è l'unico
 * posto dove un connettore di un pack esiste; lo snapshot conosce gli account,
 * i guasti e le cose che il gateway monta senza manifest (i backend MCP, lo
 * storage dei topic). Una card nasce dall'uno, dall'altro o da entrambi.
 *
 * Un connettore senza `tools_card` non è una card: è un vocabolario (gli schemi
 * della piattaforma, i datastore). Disegnarlo riempirebbe la pagina di scatole
 * che non si collegano a niente.
 *
 * @param {unknown} registry payload di `GET /connectors`
 * @param {{id?: string, label?: string, provider?: string, connected?: boolean,
 *          operational?: boolean, accounts?: string[], issues?: unknown[],
 *          builtin?: boolean, backend?: string, versioning?: string,
 *          transport?: string, auth?: string, authorized?: boolean,
 *          bot_username?: string}[]} live righe di `GET /tools`
 *
 * The edition's `integrations.connectors` is not applied here: the gateway
 * filters both sources with one decision (clodia-platform#526), and the
 * profile speaks other names than the registry (`mailboxes` is `mail`).
 * The two sources share the registry's ids, so a row and its card are one.
 */
export function cardsDiTools(registry, live) {
	const vivi = Array.isArray(live) ? live : [];
	const perId = new Map(vivi.filter((r) => r && r.id).map((r) => [String(r.id), r]));
	/** @type {Record<string, unknown>[]} */
	const cards = [];
	const visti = new Set();

	for (const c of elenco(registry)) {
		const card = c.tools_card;
		if (!card) continue;
		visti.add(c.id);
		const vivo = perId.get(c.id);
		const credenziale = c.providers?.find((p) => p.kind === 'form' || p.kind === 'oauth') ?? null;
		const gestisce = insiemiGestiti(c);
		cards.push({
			id: c.id,
			name: c.label || c.id,
			blurb: card.blurb || '',
			scope: card.scope || '',
			icon: card.icon || '',
			// «Si può collegare da qui»: una credenziale dichiarata, oppure un
			// insieme di valori che questa pagina sa amministrare.
			wired: Boolean(credenziale) || gestisce.length > 0,
			connected: vivo?.connected ?? (c.providers ?? []).some((p) => p.connected === true),
			operational: vivo?.operational,
			accounts: vivo?.accounts ?? [],
			issues: vivo?.issues ?? [],
			provider: vivo?.provider ?? c.namespace,
			bot_username: vivo?.bot_username,
			builtin: vivo?.builtin === true,
			setupLabel: card.setup_label || '',
			docsUrl: card.docs_url || '',
			docsHref: linkDocumentazione(card.docs_url),
			credenziale,
			gestisce,
			// Device pairing step (clodia-platform#639): only a literal `true`
			// turns the card's «Abbina» on. A gateway without the field draws
			// the card as before.
			pairing: c.pairing === true,
			relay: relayDi(c.relay)
		});
	}

	for (const r of vivi) {
		const id = String(r.id ?? '');
		if (!id || visti.has(id)) continue;
		// Ciò che il gateway monta senza manifest: i backend MCP (Add-MCP) e lo
		// storage dei topic. Si descrivono da ciò che la riga stessa porta.
		cards.push(cardSenzaManifest(r));
	}

	return cards;
}

/**
 * The documentation link of a connector, or `''` when it must not be a link.
 *
 * `docs_url` comes from a pack manifest and would go into an `href` in the
 * origin that holds the session token: `javascript:` or `data:` would run
 * there. Only an absolute `https://` URL with a host becomes a link; the page
 * shows anything else as plain text (review of clodia-web#242). The gateway
 * refuses such manifests too (clodia-tools#365) — this is the second wall.
 * @param {unknown} url
 * @returns {string}
 */
export function linkDocumentazione(url) {
	if (typeof url !== 'string' || !url.startsWith('https://') || /\s/.test(url)) return '';
	try {
		const u = new URL(url);
		return u.protocol === 'https:' && u.hostname ? url : '';
	} catch {
		return '';
	}
}

/**
 * The relay transport a connector declares (clodia-platform#638), reduced to
 * what the card shows: the channel's name. `null` when absent or malformed.
 * @param {unknown} relay
 * @returns {{label: string, attachments: boolean, schemes: string[]} | null}
 */
export function relayDi(relay) {
	if (!relay || typeof relay !== 'object') return null;
	const r = /** @type {Record<string, unknown>} */ (relay);
	return {
		label: typeof r.label === 'string' ? r.label : '',
		attachments: r.attachments === true,
		schemes: Array.isArray(r.schemes) ? r.schemes.map(String) : []
	};
}

/** Pairing states after which polling stops (clodia-platform#639): the device
 * is linked, or the service gave up. */
const PAIRING_FINALI = new Set(['open', 'logged_out']);
/** States in which the service is still working on it. */
const PAIRING_IN_CORSO = new Set(['connecting', 'pairing', 'starting', 'reconnecting']);

/**
 * Whether polling the pairing status must stop on this answer: a final state
 * or an error. Pure, so the guard script can execute it.
 * @param {{state?: unknown, error?: unknown} | null | undefined} stato
 */
export function pairingFinito(stato) {
	if (!stato) return true;
	const st = String(stato.state ?? '');
	if (PAIRING_FINALI.has(st)) return true;
	// A transient `error` while the service is still connecting or pairing is
	// not the end: it is shown, and polling goes on. An error in any other
	// state (unknown, unpaired…) has nothing left to wait for.
	if (stato.error) return !PAIRING_IN_CORSO.has(st);
	return false;
}

/**
 * The pairing payload a 4xx/5xx of the pairing routes carries (the gateway
 * passes the service's body through: `{state, code?, qr?, me?, error?}`), or
 * `null` when the body is not that shape.
 * @param {unknown} body raw response body
 * @returns {{state: string, me?: string, error?: string} | null}
 */
export function pairingDaErrore(body) {
	if (typeof body !== 'string' || !body) return null;
	try {
		const j = JSON.parse(body);
		if (!j || typeof j !== 'object') return null;
		const o = /** @type {Record<string, unknown>} */ (j);
		// FastAPI-style `{detail: {...}}` wraps the same payload.
		const p = o.detail && typeof o.detail === 'object' ? /** @type {Record<string, unknown>} */ (o.detail) : o;
		if (typeof p.state !== 'string' && typeof p.error !== 'string') return null;
		return {
			state: typeof p.state === 'string' ? p.state : '',
			...(typeof p.me === 'string' ? { me: p.me } : {}),
			...(typeof p.error === 'string' ? { error: p.error } : {})
		};
	} catch {
		return null;
	}
}

/**
 * The Italian message for a refused pairing request (409, 412, …).
 * @param {number} status
 * @param {{state?: string, me?: string, error?: string} | null} p
 */
export function messaggioErrorePairing(status, p) {
	if (status === 401 || status === 403) return 'Solo un amministratore può abbinare un dispositivo.';
	if (status === 409 || p?.state === 'open') {
		return p?.me ? `Già abbinato come ${p.me}.` : 'Il dispositivo è già abbinato.';
	}
	if (status === 412) return `Inserisci prima il numero nella scheda del connettore${p?.error ? ` (${p.error})` : ''}.`;
	if (p?.error) return `Abbinamento non riuscito (${status}): ${p.error}`;
	return `Abbinamento non riuscito (HTTP ${status}).`;
}

/**
 * The Italian label of a pairing state. An unknown state is shown raw: a newer
 * service must not look like a known one.
 * @param {unknown} state
 */
export function etichettaPairing(state) {
	const s = String(state ?? '');
	/** @type {Record<string, string>} */
	const nomi = {
		unpaired: 'Non abbinato',
		starting: 'Avvio…',
		connecting: 'Connessione…',
		pairing: 'In abbinamento',
		open: 'Abbinato',
		reconnecting: 'Riconnessione…',
		logged_out: 'Disconnesso dal dispositivo'
	};
	return nomi[s] ?? (s || 'sconosciuto');
}

/** @param {Record<string, unknown>} r */
function cardSenzaManifest(r) {
	const mcp = r.provider === 'mcp';
	const transport = typeof r.transport === 'string' ? r.transport : undefined;
	const oauth = r.auth === 'oauth';
	// I metodi del «Connetti» (clodia-platform#565): tipi, scope, nomi ed
	// etichette dei campi — mai valori. Un gateway più vecchio non li manda, e
	// per un backend OAuth di #532 si ricostruisce l'unico metodo che c'era.
	const authMethods = Array.isArray(r.auth_methods)
		? r.auth_methods
		: oauth
			? [{ type: 'oauth' }]
			: [];
	const credential = authMethods.some((m) => m && m.type === 'credential');
	const backend = typeof r.backend === 'string' ? r.backend : 'local-fs';
	return {
		id: String(r.id),
		name: String(r.label ?? r.id),
		blurb: mcp
			? credential
				? `MCP server montato (${transport ?? 'http'}) — si connette con «Connetti»${oauth ? ' (consenso OAuth o credenziale)' : ''}: la credenziale sta nel vault del gateway, mai nel config.`
				: oauth
					? `MCP server montato (${transport ?? 'http'}) con consenso OAuth — il token sta nel vault del gateway e si rinnova da solo.`
					: `MCP server montato (${transport ?? 'stdio'}) — tool esposti agli agent via gateway.`
			: `Backend di storage dei topic (${backend}, versioning ${r.versioning ?? 'emulated'}). I topic vivono qui, dietro il gateway.`,
		scope: mcp
			? ['mcp', ...authMethods.map((m) => (m.type === 'credential' ? 'credenziale' : 'oauth'))].join(' · ')
			: backend,
		icon: mcp ? 'mcp' : 'storage',
		wired: true,
		connected: mcp && authMethods.length === 0 ? true : Boolean(r.connected),
		operational: r.operational,
		accounts: [],
		issues: r.issues ?? [],
		provider: String(r.provider ?? ''),
		builtin: r.builtin === true,
		setupLabel: '',
		docsUrl: '',
		docsHref: '',
		credenziale: null,
		gestisce: [],
		mcp,
		transport,
		auth: r.auth,
		authorized: r.authorized,
		authMethods,
		// Un gateway senza `auth_methods` (< 2.112.0) non dice il metodo attivo
		// né ha la rotta `disconnect`: per un OAuth di #532 autorizzato l'attivo
		// è l'OAuth, e «Disconnetti» non si mostra.
		authActive: typeof r.auth_active === 'string' ? r.auth_active : oauth && r.authorized ? 'oauth' : null,
		canDisconnect: Array.isArray(r.auth_methods),
		// Tool spenti da un admin nella lista del Test (#633).
		disabledTools: Array.isArray(r.disabled_tools) ? r.disabled_tools.map(String) : []
	};
}

/**
 * Gli insiemi di valori che un connettore usa nelle proprie azioni
 * (`options: mailboxes`).
 *
 * È il gancio del pannello che amministra quei valori — le caselle di sistema.
 * La chiave è il nome dell'INSIEME, che è un elenco chiuso del gateway, non il
 * nome del connettore: il giorno che un altro connettore punta un campo sullo
 * stesso insieme, eredita lo stesso pannello senza che nessuno lo colleghi.
 * @param {Connettore} c
 */
export function insiemiGestiti(c) {
	const out = new Set();
	for (const a of c.topic_actions ?? []) {
		for (const f of a.fields ?? []) {
			const opzioni = /** @type {{options?: unknown}} */ (f).options;
			if (typeof opzioni === 'string' && opzioni) out.add(opzioni);
		}
	}
	return [...out];
}

/**
 * I bottoni che la riga «Egress/ingress locali» di un topic deve mostrare.
 *
 * Uno per ogni azione dichiarata dai connettori installati. `admin_only` lo
 * dice il manifest (una casella di SISTEMA è posta che non è dell'owner della
 * stanza): finché quella regola era un `{#if $isAdmin}` attorno a un bottone
 * scritto a mano, renderla generica l'avrebbe cancellata in silenzio.
 *
 * @param {unknown} registry
 * @param {{isAdmin?: boolean}} [opzioni]
 */
export function azioniDiTopic(registry, opzioni = {}) {
	const isAdmin = opzioni.isAdmin === true;
	const out = [];
	for (const c of elenco(registry)) {
		for (const a of c.topic_actions ?? []) {
			if (a.admin_only && !isAdmin) continue;
			out.push({
				connettore: c.id,
				namespace: c.namespace || '',
				azione: a.id,
				chiave: `${c.id}/${a.id}`,
				etichetta: a.label || c.label || c.id,
				nome: c.label || c.id,
				icona: c.tools_card?.icon || '',
				binding: a.binding || '',
				adminOnly: a.admin_only === true,
				campi: a.fields ?? [],
				// Linking a GROUP chat admits all its members, including the
				// ones added later (review of clodia-platform#638/#639).
				gruppi: a.binding === 'channel' && accettaGruppi(c)
			});
		}
	}
	return out;
}

/**
 * Whether a connector's channel link can point at a group chat: a declared
 * relay transport (clodia-platform#638), or a scheme form whose example is a
 * `g:` chat. Generic on purpose: no connector is named.
 * @param {Connettore} c
 */
export function accettaGruppi(c) {
	if (c.relay && typeof c.relay === 'object') return true;
	for (const s of c.schemes ?? []) {
		for (const f of s.forms ?? []) {
			if (typeof f?.example === 'string' && f.example.startsWith('g:')) return true;
		}
	}
	return false;
}

/** The warning shown next to a channel link that can admit a group. */
export const AVVISO_GRUPPO = 'Collegare un gruppo ammette tutti i suoi membri, anche quelli aggiunti dopo';

/**
 * Come si riempie un campo di un'azione: scegliendo, o scrivendo.
 *
 * La distinzione non è comodità, è fiducia. Un campo con un insieme di valori
 * è una TENDINA: i valori li risolve il gateway (scegliere una casella dà
 * l'indirizzo che il gateway conosce per quella casella), e scriverne uno a
 * mano metterebbe in whitelist un indirizzo identico a uno vero dietro cui non
 * c'è nessuna credenziale — l'autorizzazione esisterebbe, la casella no, e il
 * sintomo arriverebbe più tardi come «il verbo email non funziona», che non
 * nomina la causa.
 *
 * Sta qui e non nel template perché così si può ESEGUIRE in un controllo.
 * @param {{options?: unknown}} campo campo come lo descrive lo stato dell'azione
 * @returns {'scelta'|'testo'}
 */
export function tipoDiCampo(campo) {
	const opzioni = campo?.options;
	if (Array.isArray(opzioni)) return 'scelta';
	// Il manifest dichiara il NOME dell'insieme; lo stato dell'azione i valori.
	// Entrambe le forme dicono «questo campo si sceglie»: trattarne una sola
	// come tale lascerebbe un campo libero nella forma che non si riconosce.
	if (typeof opzioni === 'string' && opzioni) return 'scelta';
	return 'testo';
}

/**
 * Gli schemi che si possono censire in una direzione, con i loro esempi.
 * @param {unknown} registry
 * @param {'egress'|'ingress'} direzione
 */
export function schemiPerDirezione(registry, direzione) {
	const voluto = direzione === 'ingress' ? 'source' : 'egress';
	const out = [];
	for (const c of elenco(registry)) {
		for (const s of c.schemes ?? []) {
			if (s.direction === voluto || s.direction === 'both') out.push(s);
		}
	}
	return out;
}

/**
 * Il placeholder del campo «nuova destinazione / nuova fonte»: due esempi veri
 * fra quelli che gli schemi installati dichiarano, invece di due scritti a mano
 * che il giorno dopo nominano un connettore disinstallato.
 * @param {unknown} registry
 * @param {'egress'|'ingress'} direzione
 */
export function esempiPerDirezione(registry, direzione) {
	const esempi = [];
	for (const s of schemiPerDirezione(registry, direzione)) {
		const forma = (s.forms ?? [])[0];
		if (forma?.example) esempi.push(`${s.scheme}:${forma.example}`);
		else if (s.scheme === 'https' || s.scheme === 'http') esempi.push(`${s.scheme}://host/percorso`);
		if (esempi.length >= 2) break;
	}
	return esempi.join(' · ');
}

/**
 * L'etichetta leggibile di un URI (`tg:-100…` → «Chat Telegram»).
 * @param {unknown} registry
 * @param {string} uri
 */
export function etichettaDiUri(registry, uri) {
	const schema = String(uri || '').split(':')[0];
	if (!schema) return '';
	for (const c of elenco(registry)) {
		for (const s of c.schemes ?? []) {
			if (s.scheme === schema) return s.label || schema;
		}
	}
	return schema;
}

/**
 * Due payload di connettori in uno solo, per id — il secondo vince.
 *
 * Serve a chi può leggere i connettori solo **un pezzo per volta**
 * (clodia-platform#545 §4): il feed delle osservazioni vive nel layout, quindi
 * su qualunque pagina, ma un umano non admin non può leggere il registry
 * completo (`GET /tools/connectors` è da admin) — legge la lista *owner-scoped*
 * del topic che ha aperto. Unendo quelle liste man mano che le ottiene, un
 * nome imparato resta per la sessione invece di sparire al cambio di pagina.
 *
 * Unione e non concatenazione: lo stesso connettore compare in ogni lista, e
 * due copie della stessa riga farebbero dipendere la risposta dall'ordine.
 * @param {unknown} accumulato
 * @param {unknown} nuovo
 */
export function registryUnito(accumulato, nuovo) {
	const perId = new Map();
	for (const c of elenco(accumulato)) if (c?.id) perId.set(String(c.id), c);
	for (const c of elenco(nuovo)) if (c?.id) perId.set(String(c.id), c);
	return { connectors: [...perId.values()] };
}

/**
 * Perché un'uscita sarebbe stata fermata: `egress:<famiglia>` → la frase.
 *
 * La famiglia è il `dtype` dei verbi di un connettore, cioè il nome con cui il
 * reference monitor classifica quell'uscita. Un `why` che nessun connettore
 * installato rivendica torna com'è: è un'informazione monca, ma inventata no.
 * @param {unknown} registry
 * @param {string} why
 */
export function motivoDiOsservazione(registry, why) {
	const chiave = String(why || '');
	const famiglia = chiave.startsWith('egress:') ? chiave.slice('egress:'.length) : '';
	if (!famiglia) return chiave;
	for (const c of elenco(registry)) {
		for (const v of c.verbs ?? []) {
			if (v.dtype !== famiglia) continue;
			const nome = c.label || c.id;
			return `uscita verso ${nome} non dichiarata`;
		}
	}
	return chiave;
}

/**
 * Lo stato dei servizi lungo-vivi dei pack, per la pagina Tools
 * (clodia-platform#515, dato esposto da clodia-tools#362).
 *
 * Tollerante all'assenza del campo: finché quella PR non è in produzione il
 * gateway non lo manda, e una pagina che si rompe su un campo che arriverà è
 * peggio di una sezione che non c'è ancora.
 * @param {unknown} payload risposta di `GET /tools` o di `GET /connectors`
 */
export function serviziDiPack(payload) {
	const righe = /** @type {{services?: unknown}} */ (payload)?.services;
	if (!Array.isArray(righe)) return [];
	return righe
		.filter((r) => r && typeof r === 'object')
		.map((r) => {
			const s = /** @type {Record<string, unknown>} */ (r);
			const stato = String(s.state ?? 'sconosciuto');
			return {
				chiave: `${s.pack ?? '?'}/${s.service ?? '?'}`,
				pack: String(s.pack ?? ''),
				servizio: String(s.service ?? ''),
				stato,
				vivo: stato === 'running',
				rotto: stato === 'failed' || stato === 'backoff' || Boolean(s.last_error),
				ultimoErrore: s.last_error ? String(s.last_error) : '',
				tentativi: Number(s.failures ?? 0),
				isolato: s.isolated === true,
				salute: s.health ? String(s.health) : ''
			};
		});
}
