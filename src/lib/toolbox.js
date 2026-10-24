/**
 * La toolbox di una stanza, come la legge il pannello (clodia-platform#609 R5).
 *
 * Due cose che non si possono sbagliare, e che per questo stanno qui invece che
 * dentro il markup del componente:
 *
 * 1. **Un'eccezione morde per nome, per namespace (`ns.*`) o su tutto (`*`).**
 *    È la regola del gateway (`room_tools._bites`), e il gateway ci è arrivato
 *    dopo un difetto vero: fino alla review di clodia-tools#429 l'eccezione si
 *    sottraeva come stringa, `web.*` fra le eccezioni lasciava passare
 *    `web.fetch`, e il pannello mostrava un divieto che non c'era. Qui lo stesso
 *    errore mostrerebbe il contrario — un agente marcato «escluso» che invece
 *    il verbo ce l'ha — e nessuno se ne accorgerebbe guardando lo schermo.
 *
 * 2. **Un `ns.*` abilitato copre i verbi di quel namespace.** Chi guarda deve
 *    vedere `web.fetch` come «viene dalla stanza», non come «spento», se
 *    l'owner ha abilitato `web.*`. Spuntare il verbo singolo quando il wildcard
 *    c'è già sarebbe un doppione senza effetto.
 *
 * Modulo JS e non TS di proposito, come `liveBox.js`: così
 * `scripts/check-room-toolbox-panel.mjs` importa ed ESEGUE queste funzioni
 * invece di riscriverne una copia che può divergere.
 */

const WILDCARD = '*';

/** Il namespace di una voce: `web` per `web.fetch` e per `web.*`.
 *  @param {string} entry */
export function namespaceOf(entry) {
	const e = String(entry ?? '').trim();
	const i = e.indexOf('.');
	return i > 0 ? e.slice(0, i) : '';
}

/**
 * Una di queste voci colpisce `verb`? Per nome esatto, per `ns.*` o per `*`.
 * Serve sia per le eccezioni di un agente sia per sapere se un verbo è già
 * coperto da un wildcard abilitato: è la stessa domanda.
 *
 * @param {string} verb
 * @param {Iterable<string>} entries
 */
export function copre(verb, entries) {
	const v = String(verb ?? '').trim();
	if (!v) return false;
	const ns = namespaceOf(v);
	for (const raw of entries ?? []) {
		const e = String(raw ?? '').trim();
		if (e === WILDCARD || e === v || (ns && e === `${ns}.${WILDCARD}`)) return true;
	}
	return false;
}

/**
 * Le righe del pannello, un gruppo per backend/namespace.
 *
 * Un namespace senza verbi enumerabili (un backend MCP montato, un connettore
 * di un pack il cui componente non è caricato) arriva con la lista vuota: resta
 * nel pannello con il solo `ns.*`, perché quello è tutto ciò che si può
 * abilitare — non si inventano verbi che il gateway non sa nominare.
 *
 * @param {Record<string, string[]>} enablable  namespace → verbi offerti
 * @param {Iterable<string>} enabled            `meta.tools.enabled`
 * @param {Iterable<string>} gated              i verbi offerti che restano gated
 */
export function gruppiToolbox(enablable, enabled, gated) {
	const acceso = new Set(Array.from(enabled ?? [], (e) => String(e).trim()).filter(Boolean));
	const conGate = new Set(Array.from(gated ?? [], (e) => String(e).trim()).filter(Boolean));
	const out = [];
	for (const ns of Object.keys(enablable ?? {}).sort()) {
		const tutti = `${ns}.${WILDCARD}`;
		const verbi = (enablable[ns] ?? []).map((v) => ({
			verbo: v,
			acceso: acceso.has(v),
			gated: conGate.has(v),
			// Spento di suo ma coperto dal wildcard: lo dà la stanza lo stesso.
			coperto: !acceso.has(v) && acceso.has(tutti)
		}));
		out.push({
			ns,
			tutti,
			tuttiAccesi: acceso.has(tutti),
			// Un `ns.*` non è gated né non gated: lo sono i verbi che porta. Se
			// il namespace non li enumera, qui non c'è niente da promettere.
			tuttiHannoGate: verbi.some((v) => v.gated),
			verbi,
			// Quante voci di questo namespace ha acceso l'owner, wildcard escluso
			// (che si mostra per quello che è: «tutti»).
			accesi: verbi.filter((v) => v.acceso).length
		});
	}
	return out;
}

/**
 * Le voci della toolbox che l'owner ha acceso e che non compaiono più fra ciò
 * che il gateway sa offrire: un connettore disinstallato, un backend MCP
 * smontato. Restano scritte nel meta e vanno mostrate — altrimenti il pannello
 * dice «niente» di una stanza che una riga ce l'ha, e quella riga non si può
 * nemmeno togliere.
 *
 * @param {Record<string, string[]>} enablable
 * @param {Iterable<string>} enabled
 */
export function orfane(enablable, enabled) {
	const noti = new Set(Object.keys(enablable ?? {}));
	return Array.from(enabled ?? [], (e) => String(e).trim())
		.filter((e) => e && !noti.has(namespaceOf(e)))
		.sort();
}
