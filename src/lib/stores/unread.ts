/**
 * Non-letti per-topic + segnale di riordino RECENTS.
 *
 * Alimentato dagli eventi SSE `channel_message` (un messaggio umano o AI è stato
 * persistito in un topic). Per ogni messaggio in un topic NON attualmente aperto
 * e NON scritto dall'utente stesso, incrementa il contatore non-letti di quel
 * topic. Aprendo il topic (`markSeen`) il contatore si azzera. `topicsBump` è un
 * tick che la sidebar osserva per ri-fetchare/riordinare i RECENTS (il topic con
 * attività risale in cima).
 *
 * Persistito in localStorage così i badge sopravvivono al reload.
 */
import { writable, derived, get, type Readable } from 'svelte/store';
import { browser } from '$app/environment';

const LS = 'clodia.unread';

export function topicKey(tier: string, name: string): string {
	return `${tier}/${name}`;
}

function _load(): Record<string, number> {
	if (!browser) return {};
	try {
		return JSON.parse(localStorage.getItem(LS) || '{}');
	} catch {
		return {};
	}
}

const _unread = writable<Record<string, number>>(_load());
_unread.subscribe((v) => {
	if (browser) {
		try {
			localStorage.setItem(LS, JSON.stringify(v));
		} catch {
			/* quota — ignora */
		}
	}
});

/** Mappa reattiva topicKey → conteggio non-letti. */
export const unread: Readable<Record<string, number>> = { subscribe: _unread.subscribe };

/** Topic attualmente aperto (i suoi messaggi non contano come non-letti). */
export const activeTopic = writable<string | null>(null);

/** Tick incrementato a ogni `channel_message` → la sidebar ri-ordina i RECENTS. */
const _topicsBump = writable(0);
export const topicsBump: Readable<number> = { subscribe: _topicsBump.subscribe };

/**
 * Registra un messaggio arrivato in un topic. Incrementa i non-letti se il topic
 * NON è quello aperto e l'autore NON è l'utente stesso. Sempre bumpa il tick di
 * riordino.
 */
export function noteMessage(tier: string, name: string, author?: string, me?: string | null): void {
	const key = topicKey(tier, name);
	_topicsBump.update((n) => n + 1);
	if (key === get(activeTopic)) return; // lo sto guardando → già letto
	if (author && me && author === me) return; // mio messaggio → non è "non letto"
	_unread.update((m) => ({ ...m, [key]: (m[key] || 0) + 1 }));
}

/** Azzera i non-letti di un topic (all'apertura / mentre lo si guarda). */
export function markSeen(tier: string, name: string): void {
	const key = topicKey(tier, name);
	_unread.update((m) => {
		if (!m[key]) return m;
		const c = { ...m };
		delete c[key];
		return c;
	});
}

/** Conteggio non-letti di un topic (0 se nessuno). */
export const unreadCount = (m: Record<string, number>, tier: string, name: string): number =>
	m[topicKey(tier, name)] || 0;
