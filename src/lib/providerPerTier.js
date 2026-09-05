/**
 * Il provider di un agente dipende dalla STANZA, e la card ne mostrava uno solo.
 *
 * Un turno di canale apre la sessione con il provider **meno costoso idoneo al
 * tier di quel topic**, e la sessione è per `(topic, agente)`: lo stesso agente
 * gira su provider diversi in stanze diverse. La card però era riempita con la
 * variante senza tier — l'ordine di preferenza dichiarato — e la chiamava «il
 * provider realmente in uso» (clodia-platform#306).
 *
 * Da lì la lettura naturale, e sbagliata: «un agente, un provider». Il backend
 * ora manda `provider_by_tier`; qui si decide **come dirlo senza fare rumore**.
 *
 * La regola è: si mostra solo quando aggiunge qualcosa. Se in tutti i tier
 * risponde lo stesso provider, la riga in più non informa — e una card piena di
 * righe che dicono sempre la stessa cosa è il modo in cui si smette di leggerle.
 */

/** I tier in ordine, come li dichiara il backend (`_CLR_VALID`). */
export const TIER = ['SEAL-0', 'SEAL-1', 'SEAL-2', 'SEAL-3', 'SEAL-4'];

/**
 * Raggruppa i tier consecutivi che rispondono lo stesso provider.
 *
 * @param {Record<string, string|null>|null|undefined} mappa
 * @returns {Array<{provider: string|null, tiers: string[]}>}
 */
export function raggruppaPerProvider(mappa) {
	if (!mappa) return [];
	/** @type {Array<{provider: string|null, tiers: string[]}>} */
	const gruppi = [];
	for (const t of TIER) {
		if (!(t in mappa)) continue;
		const p = mappa[t] ?? null;
		const ultimo = gruppi[gruppi.length - 1];
		if (ultimo && ultimo.provider === p) ultimo.tiers.push(t);
		else gruppi.push({ provider: p, tiers: [t] });
	}
	return gruppi;
}

/**
 * Vale la pena mostrare la ripartizione per tier?
 *
 * No quando tutti i tier danno lo stesso provider: la card direbbe due volte la
 * stessa cosa. Sì appena c'è una differenza — compreso il caso in cui in qualche
 * tier l'agente **non può lavorare** (`null`), che è l'informazione più utile
 * delle due e quella che nessun altro campo porta.
 *
 * @param {Record<string, string|null>|null|undefined} mappa
 */
export function vaMostrata(mappa) {
	const gruppi = raggruppaPerProvider(mappa);
	return gruppi.length > 1;
}

/**
 * Una riga leggibile: `SEAL-0/1 anthropic-api · SEAL-2/3 aws-region-eu · SEAL-4 —`.
 *
 * I tier contigui si abbreviano (`SEAL-0/1`) perché la card è stretta e cinque
 * voci per esteso la fanno andare a capo due volte.
 *
 * @param {Record<string, string|null>|null|undefined} mappa
 */
export function riassumiPerTier(mappa) {
	return raggruppaPerProvider(mappa)
		.map((g) => `${etichettaTier(g.tiers)} ${g.provider ?? '—'}`)
		.join(' · ');
}

/**
 * `['SEAL-0','SEAL-1']` → `SEAL-0/1`; una sola voce resta per esteso.
 * @param {string[]} tiers
 */
export function etichettaTier(tiers) {
	if (tiers.length === 1) return tiers[0];
	const numeri = tiers.map((t) => t.replace('SEAL-', ''));
	return `SEAL-${numeri.join('/')}`;
}

/**
 * I tier in cui l'agente non può prendere turni: nessun suo provider li regge.
 * @param {Record<string, string|null>|null|undefined} mappa
 */
export function tierPreclusi(mappa) {
	if (!mappa) return [];
	return TIER.filter((t) => t in mappa && !mappa[t]);
}
