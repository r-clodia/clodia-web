/**
 * Segnali per-topic dei RECENTS (issue clodia-platform#83).
 *
 * Lo stato NON si calcola più nel client (il vecchio contatore in
 * localStorage incrementava su ogni messaggio: rumore, e condiviso di fatto
 * fra sessioni). La fonte di verità è il server, per-principal:
 *
 * - `actionable` (badge numerico, accento): mention non lette rivolte a me +
 *   gate pendenti assegnati a me. Conta gli item che aspettano me, non i
 *   messaggi nuovi.
 * - `activity` (pallino neutro, booleano): si è mosso qualcosa dopo la mia
 *   ultima visita. Nessun numero, nessuna gradazione.
 *
 * Precedenza: se c'è actionable si mostra SOLO il badge, mai i due segnali
 * insieme. La visita spegne il pallino (postTopicSeen); le mention si
 * spengono con l'ack esplicito (ackMentions, inviato quando la coda dei
 * messaggi è stata effettivamente renderizzata); i gate solo se risolti o
 * riassegnati — mai per lettura.
 *
 * Gli eventi SSE `channel_message` fanno solo da trigger di refetch
 * (noteMessage → topicsBump): nessun conteggio locale.
 */
import { writable, type Readable } from 'svelte/store';
import { browser } from '$app/environment';
import { getTopicSignals, postTopicSeen, type TopicSignal } from '$lib/api/client';

export function topicKey(tier: string, name: string): string {
	return `${tier}/${name}`;
}

const _signals = writable<Record<string, TopicSignal>>({});
/** Mappa reattiva topicKey → {actionable, activity} (assente = nessun accesso). */
export const signals: Readable<Record<string, TopicSignal>> = { subscribe: _signals.subscribe };

/** Topic attualmente aperto (i suoi eventi non devono suonare). */
export const activeTopic = writable<string | null>(null);

/** Tick incrementato a ogni `channel_message` → la sidebar ri-ordina e rifetcha. */
const _topicsBump = writable(0);
export const topicsBump: Readable<number> = { subscribe: _topicsBump.subscribe };

// Ultimo set di topic osservati (quelli mostrati in sidebar): il refetch dopo
// una visita/ack riusa queste chiavi.
let _watched: string[] = [];

/** Rifetcha i segnali dal server per i topic indicati (o per gli ultimi osservati). */
export async function refreshSignals(keys?: ReadonlyArray<string>): Promise<void> {
	if (keys) _watched = [...keys];
	if (!_watched.length) {
		_signals.set({});
		return;
	}
	try {
		_signals.set(await getTopicSignals(_watched));
	} catch {
		/* rete/login assente: si riprova al prossimo trigger */
	}
}

/**
 * Un `channel_message` è arrivato via SSE: trigger di riordino + refetch.
 * Il conteggio NON si fa qui — lo fa il server, per-principal.
 */
export function noteMessage(_tier: string, _name: string): void {
	_topicsBump.update((n) => n + 1);
}

/**
 * Registra la visita al topic: spegne il pallino attività (ottimista in
 * locale, poi POST al server). NON tocca badge azionabile né gate.
 */
export function markSeen(tier: string, name: string): void {
	const key = topicKey(tier, name);
	_signals.update((m) => (m[key] ? { ...m, [key]: { ...m[key], activity: false } } : m));
	if (browser) void postTopicSeen(tier, name).catch(() => {});
}

/**
 * Ack di lettura delle mention fino a `upto` (ts dell'ultimo messaggio
 * RENDERIZZATO — va chiamato solo quando la coda è davvero visibile, non
 * alla mera navigazione). Poi riallinea i segnali dal server.
 */
export function ackMentions(tier: string, name: string, upto: string): void {
	if (!browser || !upto) return;
	void postTopicSeen(tier, name, upto)
		.then(() => refreshSignals())
		.catch(() => {});
}

/** Segnale corrente di un topic (default: nessun segnale). */
export function topicSignal(
	m: Record<string, TopicSignal>,
	tier: string,
	name: string
): TopicSignal {
	return m[topicKey(tier, name)] ?? { actionable: 0, activity: false };
}

// Migrazione: il vecchio contatore client-side non esiste più.
if (browser) {
	try {
		localStorage.removeItem('clodia.unread');
	} catch {
		/* ignore */
	}
}
