/**
 * La `reason` di una decisione di routing, resa leggibile — e la domanda «è un
 * ripiego?», che la pagina fa in più di un punto (clodia-platform#293).
 *
 * Il difetto che questo modulo chiude: la barra 🧭 confrontava `reason` con la
 * stringa letterale `'fallback-rank'` in TRE punti (etichetta, evidenziazione
 * del pannello, invito a correggere il routing). Dopo la #357 — R10, il ripiego
 * del router è il coordinatore DICHIARATO e non il rango — il backend non emette
 * più quella stringa: emette `fallback-coordinatore dichiarato (clodia)`,
 * `(segretario)`, oppure `fallback-rank-senza-coordinatore`. Tre comportamenti
 * spenti in silenzio da un deploy dell'altro repo, senza un errore e senza un
 * tipo rotto.
 *
 * Due scelte fatte con gli occhi aperti:
 *
 *  1. **il prefisso invece dell'elenco.** `isFallbackReason` guarda
 *     `fallback-`, così un quarto ripiego inventato domani nel backend conta
 *     come ripiego il giorno in cui nasce, invece di aspettare che qualcuno se
 *     ne accorga qui. È un contratto implicito fra due repo, e per questo
 *     `scripts/check-routing-fallback-reasons.mjs` lo ESEGUE sulle reason vere
 *     del router: se il backend cambia forma, quel guard diventa rosso.
 *     Nota: `multi-match fallback` contiene la parola ma non è un ripiego —
 *     è l'esito opposto, più specialisti pertinenti insieme — e infatti non
 *     comincia per `fallback-`.
 *
 *  2. **il nome del coordinatore dentro l'etichetta.** La reason del backend è
 *     parametrica (`(clodia)` / `(segretario)`), quindi una mappa di stringhe
 *     non può contenerla: si riconosce la forma e si riusa il nome. Chi legge
 *     vuole sapere CHI ha preso il turno quando i coseni hanno rinunciato.
 *
 * Modulo JS e non TS di proposito, come `$lib/liveReply`: il guard lo importa e
 * lo esegue davvero, invece di riscriverne una copia che può divergere da ciò
 * che gira (`allowJs`/`checkJs` sono attivi, i tipi JSDoc passano da
 * svelte-check come quelli di un `.ts`).
 */

/**
 * Le reason con etichetta fissa. Le due decisioni prese da una PERSONA restano
 * qui: erano il difetto della clodia-platform#253 e il loro controllo le cerca
 * attraverso questo modulo.
 *
 * @type {Record<string, string>}
 */
export const ROUTING_REASON_LABELS = {
	tagged: 'richiesto esplicitamente con @menzione',
	relevance: 'dominio più pertinente al messaggio (embedding)',
	'multi-match fallback': 'più specialisti pertinenti coinvolti in parallelo',
	rank: 'per rango (routing per rilevanza disattivato)',
	// Il ripiego di prima della #357: non lo emette più nessuno, ma sta nello
	// storico dei topic già instradati, e una traccia vecchia va letta comunque.
	'fallback-rank': 'nessuno abbastanza pertinente → fallback per rango',
	// R10: nessun coordinatore dichiarato fra i partecipanti idonei. È anche un
	// suggerimento di configurazione, e lo dice `coordinatorHint`.
	'fallback-rank-senza-coordinatore':
		'nessuno abbastanza pertinente e nessun coordinatore nella stanza → ha risposto il più alto in rango',
	'router overruled by human': 'scelta del router scavalcata da una persona',
	'routing ambiguity resolved by human': 'ambiguità risolta da una persona'
};

/** La reason parametrica del coordinatore dichiarato, dal `coordinator.pick` del backend. */
const COORDINATORE = /^fallback-coordinatore dichiarato \(([^)]+)\)$/;

/**
 * `true` se questa decisione è un RIPIEGO: il router semantico ha rinunciato e
 * il turno è stato assegnato da una seconda regola.
 *
 * @param {string | null | undefined} reason
 * @returns {boolean}
 */
export function isFallbackReason(reason) {
	return typeof reason === 'string' && reason.startsWith('fallback-');
}

/**
 * L'etichetta italiana di una reason. Sconosciuta → la stringa stessa, che è
 * sempre meglio del vuoto, ma è anche il difetto che i guard sorvegliano.
 *
 * @param {string | null | undefined} reason
 * @returns {string}
 */
export function routingReasonLabel(reason) {
	if (typeof reason !== 'string' || reason === '') return '';
	const fissa = ROUTING_REASON_LABELS[reason];
	if (fissa) return fissa;
	const coord = COORDINATORE.exec(reason);
	if (coord) return `nessuno abbastanza pertinente → l'ha preso il coordinatore (${coord[1]})`;
	return reason;
}

/**
 * Il suggerimento di configurazione, quando la reason ne porta uno: una stanza
 * che ripiega sul rango non ha né clodia né segretario fra i partecipanti
 * idonei, e questo si aggiusta cambiando lo scope, non correggendo il routing.
 *
 * @param {string | null | undefined} reason
 * @returns {string | null}
 */
export function coordinatorHint(reason) {
	return reason === 'fallback-rank-senza-coordinatore'
		? 'Questa stanza non ha né clodia né segretario fra i partecipanti idonei: ' +
				'senza un coordinatore il ripiego resta il rango. Aggiungerne uno allo scope ' +
				'fa decidere il turno a chi conosce il contesto.'
		: null;
}
