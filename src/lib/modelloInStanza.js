/**
 * Provider **e** modello della stanza, in un chip solo (clodia-platform#315).
 *
 * #310 ha portato in chat il provider effettivo per topic; il modello restava
 * invisibile ovunque. La scelta qui è **un chip, non due**: il backend non
 * sceglie provider e modello separatamente — prende il provider min-cost idoneo
 * al tier e con lui il modello ABBINATO a quello stack (`provider_models`, e
 * `candidate_providers` che filtra i provider proprio in base al modello che
 * servirebbero). Due chip affiancati si leggono come due assi liberi — «opus,
 * su qualunque provider» — che è la premessa sbagliata da cui è nata la #306.
 * Il separatore `·` dice quello che sono: una coppia.
 *
 * L'altra decisione è **accorciare nel chip, mai nel tooltip**. Un
 * inference-profile Bedrock (`eu.anthropic.claude-opus-4-6-v1`) è lungo il
 * doppio del nome dell'agente e manderebbe a capo l'header del messaggio; ma la
 * regione e la versione sono esattamente ciò che si va a cercare quando un
 * turno si comporta in modo strano, quindi l'id esatto resta nel `title`.
 */

/** I prefissi di regione degli inference-profile, e i vendor che li seguono. */
const REGIONE = /^(?:eu|us|global|apac)\./;
const VENDORE = /^(?:anthropic|amazon|meta|mistral|ai21|cohere|deepseek|qwen|openai)\./;
/** Coda di versione (`-v1`, `-v1:0`) e data di rilascio (`-20251001`). */
const CODA = [/-v\d+(?::\d+)?$/, /-\d{8}$/];

/**
 * Il modello come sta in un chip: senza regione, vendor, versione e data.
 *
 * Toglie SOLO forme note. Un id che non le ha — `mistral-small-3.2-24b-instruct-2506`
 * — esce intatto: meglio un chip lungo di un chip che nomina un modello diverso
 * da quello in uso.
 *
 * @param {string|null|undefined} model
 * @returns {string}
 */
export function modelloBreve(model) {
	let m = (model ?? '').trim();
	if (!m) return '';
	m = m.replace(REGIONE, '').replace(VENDORE, '');
	for (const coda of CODA) m = m.replace(coda, '');
	return m;
}

/**
 * Il testo del chip: `provider · modello`.
 *
 * Senza provider non c'è chip (l'agente in questa stanza non lavora: lo dice
 * già il ⚠️ dei Partecipanti). Senza modello resta il chip di #310 — un
 * provider senza modello è meno informativo, `provider · undefined` è rotto.
 *
 * @param {string|null|undefined} provider
 * @param {string|null|undefined} model
 * @returns {string}
 */
export function chipStanza(provider, model) {
	const p = (provider ?? '').trim();
	if (!p) return '';
	const m = modelloBreve(model);
	return m ? `${p} · ${m}` : p;
}

/**
 * Il tooltip: la coppia per esteso, con l'id modello NON accorciato — regione e
 * versione comprese, che è ciò che serve quando si indaga su un turno.
 *
 * @param {string|null|undefined} provider
 * @param {string|null|undefined} model
 * @returns {string}
 */
export function titoloChip(provider, model) {
	const p = (provider ?? '').trim();
	const m = (model ?? '').trim();
	if (!p) return '';
	return m
		? `provider e modello in questa stanza: ${p} · ${m}`
		: `provider in questa stanza: ${p}`;
}
