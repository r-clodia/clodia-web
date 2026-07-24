import { get } from 'svelte/store';
import { goto } from '$app/navigation';
import { createOrOpenDm, postChannelMessage } from '$lib/api/client';
import { instanceProfile } from '$lib/stores/instance';
import { toastError } from '$lib/stores/toasts';

// Il widget helpdesk flottante è stato rimosso: "chiedere allo steward" ora apre
// una DM REALE con l'agente di assistenza (sysadmin) e vi posta il messaggio, poi
// naviga alla chat. Stessa funzione (Setup pack, Aiuto integrazioni) senza il widget.
export async function askWainston(message: string): Promise<void> {
	const agent = get(instanceProfile)?.helpdesk?.agent || 'sysadmin';
	try {
		const dm = await createOrOpenDm(agent);
		if (message) {
			await postChannelMessage(dm.tier, dm.name, message);
		}
		await goto(`/topics/${dm.tier}/${dm.name}`);
	} catch (e) {
		toastError('Assistenza', e instanceof Error ? e.message : String(e));
	}
}
