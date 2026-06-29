import { writable } from 'svelte/store';

// Canale per pilotare il ChatWidget (Wainston) da qualunque pagina: una pagina
// chiama askWainston(testo) e il widget si apre postando quel messaggio come
// richiesta dell'utente. Usato dai bottoni "Aiuto setup" delle integrazioni.
export interface HelpdeskRequest {
	message: string;
	nonce: number;
}

export const helpdeskRequest = writable<HelpdeskRequest | null>(null);

export function askWainston(message: string): void {
	// nonce per garantire che due richieste identiche consecutive si distinguano
	helpdeskRequest.set({ message, nonce: Date.now() + Math.random() });
}
