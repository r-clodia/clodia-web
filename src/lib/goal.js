/**
 * L'OBIETTIVO di un canale (clodia-platform#457).
 *
 * L'owner promuove un proprio messaggio a obiettivo: da lì in poi è un
 * requisito vincolante che l'orchestratore deve portare a termine, e togliere
 * il pin è l'atto che ne ferma l'esecuzione.
 *
 * La regola sta qui — in JS puro, eseguibile da una guard — e non dentro la
 * pagina, perché è la stessa decisione presa in tre posti diversi: il bottone
 * nella bolla, l'evidenza sul messaggio già fissato, la fascia in cima allo
 * stream. Ricalcolata a mano in ognuno, diverge al primo ritocco.
 */

/** Stati del ciclo di vita, nell'ordine in cui si attraversano. */
export const STATI_OBIETTIVO = Object.freeze([
	'pinned',
	'strategy-review',
	'in-progress',
	'claimed-done',
	'done'
]);

/** Messaggi che possono diventare un obiettivo: quelli di una PERSONA.
 *
 *  Un messaggio di un agente no, e non è pignoleria: l'obiettivo è ciò che
 *  l'utente chiede, mentre la risposta di un agente è già l'esecuzione di
 *  qualcosa. Pinnarla farebbe eseguire a Clodia il proprio riassunto.
 */
const GENERI_UMANI = Object.freeze(['human', 'telegram', 'proxy']);

/**
 * Il bottone «fissa come obiettivo» va su questa bolla?
 *
 * @param {{kind?: string, text?: string}|null|undefined} m messaggio della timeline
 * @param {{isOwner?: boolean}} ctx
 * @returns {boolean}
 */
export function puoDiventareObiettivo(m, ctx = {}) {
	if (!ctx.isOwner) return false; // fissare un obiettivo impegna il lavoro degli agenti
	if (!m) return false;
	if (!GENERI_UMANI.includes(String(m.kind ?? 'human'))) return false;
	return String(m.text ?? '').trim().length > 0;
}

/**
 * Questo messaggio È l'obiettivo attualmente fissato?
 *
 * Il confronto è sul `message_id` e non sul testo: due richieste identiche a
 * distanza di giorni sono due obiettivi diversi, e il testo nel meta è una
 * copia troncata — confrontarlo darebbe «no» proprio sui messaggi lunghi.
 *
 * @param {{id?: string}|null|undefined} m
 * @param {{message_id?: string|null}|null|undefined} goal
 * @returns {boolean}
 */
export function eObiettivoFissato(m, goal) {
	const id = m && m.id ? String(m.id) : '';
	const rif = goal && goal.message_id ? String(goal.message_id) : '';
	return !!id && id === rif;
}

/** Etichette dello stato: cosa sta succedendo e, soprattutto, **di chi è la
 *  mossa**. È la sola cosa che l'owner deve capire senza leggere la chat.
 *  @type {Readonly<Record<string, {testo: string, attesa: string, nota: string}>>} */
const ETICHETTE = Object.freeze({
	pinned: { testo: 'Obiettivo fissato', attesa: 'agenti', nota: "l'orchestratore prepara la strategia" },
	'strategy-review': { testo: 'Strategia da approvare', attesa: 'owner', nota: 'attende il tuo via libera' },
	'in-progress': { testo: 'In esecuzione', attesa: 'agenti', nota: 'strategia approvata, lavoro in corso' },
	'claimed-done': { testo: 'Dichiarato raggiunto', attesa: 'owner', nota: 'verifica ed accetta, o chiedi una correzione' },
	done: { testo: 'Obiettivo raggiunto', attesa: 'nessuno', nota: 'accettato' }
});

/**
 * Riga di stato per la fascia dell'obiettivo.
 *
 * @param {{state?: string, text?: string}|null|undefined} goal
 * @returns {{stato: string, testo: string, attesa: string, nota: string}|null}
 */
export function statoObiettivo(goal) {
	if (!goal || !String(goal.text ?? '').trim()) return null;
	const stato = STATI_OBIETTIVO.includes(String(goal.state)) ? String(goal.state) : 'pinned';
	return { stato, ...ETICHETTE[stato] };
}

/**
 * L'obiettivo aspetta una decisione dell'owner?
 *
 * Serve a decidere se la fascia va evidenziata: un requisito che aspetta da
 * giorni un sì che nessuno sa di dover dare è il modo in cui questa feature
 * fallisce in silenzio.
 *
 * @param {{state?: string, text?: string}|null|undefined} goal
 * @returns {boolean}
 */
export function attendeOwner(goal) {
	const s = statoObiettivo(goal);
	return !!s && s.attesa === 'owner';
}
