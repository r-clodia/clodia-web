import { get, writable } from 'svelte/store';
import { goto } from '$app/navigation';
import { createOrOpenDm, postChannelMessage } from '$lib/api/client';
import { isAdmin } from '$lib/stores/capabilities';
import { toastError } from '$lib/stores/toasts';

/**
 * Helpdesk = the person's DM with sysadmin, opened in the global side widget
 * (clodia-platform#702). The agent is fixed: there is no per-instance setting
 * any more (the old `helpdesk.agent` / `wainston` fallback is gone). Make it
 * configurable again only when a second helpdesk agent exists.
 */
export const HELPDESK_AGENT = 'sysadmin';

/** An explicit page reference a caller may add (e.g. the pack whose setup was
 *  asked for). Identifiers only — see `$lib/pageContext`. */
export type HelpdeskRef = Partial<Record<'kind' | 'tier' | 'name' | 'pack' | 'datastore' | 'collection' | 'job' | 'agent' | 'section', string>>;

export interface HelpdeskRequest {
	message: string;
	ref?: HelpdeskRef;
	/** Two identical requests in a row must still be told apart. */
	nonce: number;
}

/** Drives the widget from any page: the widget opens and posts the message. */
export const helpdeskRequest = writable<HelpdeskRequest | null>(null);

/** What the topic page knows about the room on screen: whether it is a DM.
 *  Only the kind — it lets the page reference say `dm` instead of `topic`. */
export const currentRoom = writable<{ tier: string; name: string; kind?: string } | null>(null);

/**
 * «Aiuto», «💬 Aiuto setup», «Finish setup»: ask sysadmin about this.
 *
 * Admins get the side widget with the message posted, without leaving the
 * page. The widget is admin-only (owner decision, 19 Nov 2026), so anyone else
 * keeps the previous path — the DM page with the message already sent —
 * instead of a button that silently does nothing.
 */
export async function askHelpdesk(message: string, ref?: HelpdeskRef): Promise<void> {
	if (get(isAdmin)) {
		helpdeskRequest.set({ message, ref, nonce: Date.now() + Math.random() });
		return;
	}
	try {
		const dm = await createOrOpenDm(HELPDESK_AGENT);
		if (message) await postChannelMessage(dm.tier, dm.name, message);
		await goto(`/topics/${encodeURIComponent(dm.tier)}/${encodeURIComponent(dm.name)}`);
	} catch (e) {
		toastError('Assistenza', e instanceof Error ? e.message : String(e));
	}
}
