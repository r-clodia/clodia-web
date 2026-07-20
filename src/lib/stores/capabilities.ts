/**
 * Capabilities dell'utente umano corrente — sorgente unica per il *gating della
 * UI* (defense-in-depth). NON è l'enforcement: quello è server-side (gateway
 * PDP). Qui decidiamo solo COSA MOSTRARE, così un non-admin (es. Giovanni) non
 * vede nemmeno i controlli che non può usare (es. "rimuovi MCP").
 *
 * Modello: le azioni di piattaforma (gestione MCP/integrations, pack, provider,
 * creazione agenti, lifecycle workflow, settings, backup) sono **admin-only** —
 * specchiano la classe `super-only` del gateway. Le azioni sui topic
 * (stato/archiviazione) sono **owner-only** (o admin come operatore).
 *
 * `isAdmin` = il principal loggato è fra gli admin dell'istanza (`/api/admin/state`).
 */
import { derived, get, writable } from 'svelte/store';
import { session } from '$lib/auth/session';
import { getAdminState } from '$lib/api/client';

const _admins = writable<string[]>([]);

/** Ricarica la lista admin dell'istanza. Chiamare dopo il login. */
export async function refreshCapabilities(): Promise<void> {
	try {
		const s = await getAdminState();
		_admins.set(s.admins || []);
	} catch {
		_admins.set([]);
	}
}

/** True se l'utente loggato è un admin/superadmin dell'istanza. */
export const isAdmin = derived(
	[session, _admins],
	([$s, $a]) => !!$s && $a.includes($s.principal)
);

/** Nome del principal umano loggato (o null). */
export function me(): string | null {
	return get(session)?.principal ?? null;
}

/**
 * Può gestire un topic (cambiarne stato / archiviarlo)? Solo l'OWNER del topic,
 * o un admin come operatore. Rispecchia `_require_topic_owner` del backend.
 */
export function canManageTopic(owner?: string | null): boolean {
	const p = me();
	if (!p) return false;
	return get(isAdmin) || (!!owner && p === owner);
}
