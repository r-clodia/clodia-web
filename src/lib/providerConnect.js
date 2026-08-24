/**
 * Form di collegamento di un provider: quali campi chiedere, cosa rifiutare
 * prima di chiamare il backend, cosa mandargli (clodia-platform#281).
 *
 * Vive fuori dalla pagina perché la regola che decide questi tre punti non è
 * la stessa per tutti i provider, e la variante che conta non era raggiungibile
 * dalla UI: per un provider a ENDPOINT dichiarato (`generic-openai` — ollama,
 * LM Studio, vLLM) la chiave è FACOLTATIVA e ciò che rende il provider
 * «collegato» è il `base_url`. La modale chiedeva solo `api_key` e bloccava
 * l'invio a chiave vuota, quindi il caso d'uso principale del provider era
 * semplicemente impossibile da schermo.
 *
 * Il contratto è del backend (`clodia-logic`, server/api/providers.py — NON
 * clodia-tools, che tiene solo il vault). Qui si RISPECCHIA, non si inventa:
 *
 *   GET /api/providers        → `configurable` (lista ordinata di nomi campo,
 *                               o null), `apikey_optional`, e i valori attuali
 *                               `base_url`/`model` — che NON sono segreti e
 *                               infatti tornano in chiaro, a differenza di
 *                               `api_key`, che dal backend non esce mai.
 *   POST /api/providers/{id}/key
 *     · `api_key` vuota          → 400, tranne se `apikey_optional`
 *     · campo non in `configurable` → 400 (rifiutato, non ignorato in silenzio)
 *     · `base_url` dichiarato e mancante → 400: senza endpoint il bundle
 *       sarebbe una credenziale muta e il provider risulterebbe scollegato.
 *
 * Da quest'ultima riga viene la cosa meno ovvia di questo modulo: `base_url`
 * **non è opzionale**. Per il provider che lo dichiara è il campo obbligatorio,
 * e prende il posto della chiave in quel ruolo.
 *
 * E da lì viene anche il prefill: `set_key` riscrive il bundle INTERO, non fa
 * merge. «Riconnetti» con il solo campo chiave cancellerebbe l'endpoint di un
 * provider che stava funzionando — il backend risponde 400 e l'utente legge un
 * errore che non spiega niente di ciò che ha fatto.
 */

/**
 * @typedef {Object} ProviderLike
 * @property {string[]|null} [configurable]  nomi dei campi configurabili
 * @property {boolean|null} [apikey_optional] la chiave è facoltativa
 * @property {string|null} [base_url]        endpoint attualmente configurato
 * @property {string|null} [model]           modello attualmente configurato
 */

/** Campi configurabili che questa UI sa disegnare. Uno dichiarato dal backend e
 *  non presente qui NON viene mostrato né mandato: meglio un campo mancante in
 *  pagina che un payload che il backend rifiuta con 400. */
const CAMPI_NOTI = ['base_url', 'model'];

/** @param {ProviderLike|null|undefined} p */
function configurabili(p) {
	const dichiarati = Array.isArray(p?.configurable) ? p.configurable : [];
	return CAMPI_NOTI.filter((c) => dichiarati.includes(c));
}

/**
 * I campi da mostrare nello step «chiave» della modale, in ordine di apparizione.
 *
 * `api_key` c'è sempre: anche quando è facoltativa resta l'unico modo di
 * collegare un endpoint che invece una chiave la vuole (un gateway
 * OpenAI-compatible remoto).
 *
 * @param {ProviderLike|null|undefined} p
 * @returns {{ name: 'api_key'|'base_url'|'model', required: boolean }[]}
 */
export function connectFields(p) {
	const conf = configurabili(p);
	/** @type {{ name: 'api_key'|'base_url'|'model', required: boolean }[]} */
	const out = [{ name: 'api_key', required: !p?.apikey_optional }];
	for (const c of conf) {
		// `base_url` è richiesto quando dichiarato (il backend lo esige);
		// `model` no: l'endpoint può servirne uno solo, o averne un default.
		out.push({ name: /** @type {'base_url'|'model'} */ (c), required: c === 'base_url' });
	}
	return out;
}

/**
 * Valori con cui APRIRE la modale per questo provider: i campi non segreti si
 * ripresentano già compilati, la chiave mai (dal backend non torna, e un
 * placeholder finto farebbe credere di averla ancora).
 *
 * @param {ProviderLike|null|undefined} p
 * @returns {{ api_key: string, base_url: string, model: string }}
 */
export function connectInitialValues(p) {
	const conf = configurabili(p);
	return {
		api_key: '',
		base_url: conf.includes('base_url') ? (p?.base_url ?? '') : '',
		model: conf.includes('model') ? (p?.model ?? '') : ''
	};
}

/**
 * L'errore da mostrare PRIMA di chiamare il backend, o `null` se si può inviare.
 *
 * Duplicare qui le regole del backend non è ridondanza: senza, l'unico modo di
 * scoprire che manca un campo è un 400 con il messaggio del server, e nel caso
 * della chiave facoltativa la UI si fermava prima ancora di provare.
 *
 * @param {ProviderLike|null|undefined} p
 * @param {{ api_key?: string, base_url?: string, model?: string }} valori
 * @returns {string|null}
 */
export function validateConnect(p, valori) {
	for (const campo of connectFields(p)) {
		if (!campo.required) continue;
		const v = (valori?.[campo.name] ?? '').trim();
		if (v) continue;
		if (campo.name === 'api_key') return 'Inserisci la API key.';
		if (campo.name === 'base_url')
			return "Inserisci l'endpoint (host:port oppure http://host:port/v1).";
		return `Campo obbligatorio mancante: ${campo.name}.`;
	}
	return null;
}

/**
 * Il corpo di `POST /api/providers/{id}/key`: solo i campi DICHIARATI dal
 * provider e davvero valorizzati.
 *
 * Il filtro su `configurable` non è cosmetico: il backend RIFIUTA con 400 un
 * campo che non ha dichiarato, invece di ignorarlo — apposta, perché chi lo
 * manda crede di aver configurato un endpoint. Mandare `base_url` a un provider
 * che non ne ha uno spezzerebbe il collegamento di quel provider.
 *
 * @param {ProviderLike|null|undefined} p
 * @param {{ api_key?: string, base_url?: string, model?: string }} valori
 * @returns {{ api_key?: string, base_url?: string, model?: string }}
 */
export function connectPayload(p, valori) {
	/** @type {{ api_key?: string, base_url?: string, model?: string }} */
	const body = {};
	for (const campo of connectFields(p)) {
		const v = (valori?.[campo.name] ?? '').trim();
		if (v) body[campo.name] = v;
	}
	return body;
}
