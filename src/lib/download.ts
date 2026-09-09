/**
 * Apertura di un file di topic con URL FIRMATO.
 *
 * Fix sicurezza 7 lug 2026: `GET /topics/{tier}/{name}/download` vuole una firma
 * `exp`/`sig` (da `/download-url`, che verifica login+membership) oppure una
 * sessione con membership. La webui autentica con header `Authorization: Bearer`,
 * e una navigazione da `<a href>` — anche con `download=` — non porta header
 * custom: la richiesta arriva anonima e il backend risponde `401`.
 *
 * Perché questa funzione sta in `$lib` e non dentro una pagina: ci stava, dentro
 * il topic-workspace, e la pagina della lista topic ha riscritto l'URL a mano
 * riproducendo il difetto su ogni artefatto recente (clodia-platform#323,
 * clodia-web#206). Un helper che non si può importare non è un pattern
 * stabilito: è una nota a piede di un file solo. Il guard
 * `scripts/check-download-firmato.mjs` tiene chiusa la scorciatoia.
 */
import { signedChannelFileUrl } from '$lib/api/client';
import { toastError } from '$lib/stores/toasts';

/**
 * Risolve l'URL firmato di `path` nel canale `tier/name` e lo apre in una nuova
 * scheda. Non solleva: un download negato si dice all'utente con un toast —
 * lasciarlo in console riprodurrebbe il guasto invisibile che #323 chiude
 * (l'utente clicca e non succede niente).
 */
export async function openSignedFile(tier: string, name: string, path: string): Promise<void> {
	try {
		const u = await signedChannelFileUrl(tier, name, path);
		window.open(u, '_blank', 'noopener');
	} catch (e) {
		toastError(`Download non autorizzato: ${path}`, e instanceof Error ? e.message : String(e));
	}
}
