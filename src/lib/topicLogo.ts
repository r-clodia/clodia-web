/**
 * I byte del logo di un topic, recuperati **con l'autenticazione**.
 *
 * Perché non basta un `<img src="…/logo">`. La webui autentica ogni chiamata con
 * l'header `Authorization: Bearer ckt1…`, e un `<img>` non lo porta: il browser
 * emette una richiesta anonima, il server risponde 401, e l'immagine resta
 * rotta. Il difetto è **muto** — la pagina non segnala nulla, si vede solo che
 * l'immagine non c'è — e sembra un problema di caricamento invece che di
 * identità.
 *
 * L'endpoint non si può aprire senza autenticazione, come si è fatto per il
 * logo dell'ISTANZA: quello è il marchio di chi ospita, questo sta dentro una
 * stanza compartimentata e lo vede solo chi vi partecipa.
 *
 * Quindi si scarica come qualunque altra risorsa autenticata e si consegna un
 * `blob:` all'`<img>`. Il costo è una richiesta per topic, mitigata dalla cache
 * qui sotto: la stessa stanza compare nella lista e nella propria pagina, e
 * scaricarla due volte sarebbe uno spreco visibile su una lista lunga.
 */
import { API_BASE_URL, authHeaders } from '$lib/api/client';

/** chiave → URL blob (o null se non c'è logo / non leggibile). */
const cache = new Map<string, Promise<string | null>>();

function chiave(tier: string, name: string, rev: number): string {
	return `${tier}/${name}/${rev}`;
}

/**
 * URL utilizzabile in un `<img src>`, o `null` se il topic non ha un logo o non
 * è leggibile da chi chiede. Non solleva: chi la usa deve poter ripiegare sul
 * monogramma senza scrivere un try/catch attorno a un'immagine.
 */
export function topicLogoUrl(tier: string, name: string, rev = 0): Promise<string | null> {
	const k = chiave(tier, name, rev);
	const gia = cache.get(k);
	if (gia) return gia;

	const p = (async () => {
		try {
			const r = await fetch(
				`${API_BASE_URL}/api/topics/${encodeURIComponent(tier)}/${encodeURIComponent(name)}/logo`,
				{ headers: authHeaders() }
			);
			if (!r.ok) return null;
			const b = await r.blob();
			// Un corpo vuoto non è un'immagine: meglio il monogramma di un
			// riquadro trasparente che sembra un difetto di rendering.
			if (!b.size) return null;
			return URL.createObjectURL(b);
		} catch {
			return null;
		}
	})();
	cache.set(k, p);
	return p;
}

/**
 * Butta via le versioni precedenti di un topic dopo un caricamento nuovo.
 *
 * Serve per due ragioni distinte, e la seconda è quella che si nota: senza,
 * l'URL blob vecchio resterebbe in cache e la pagina continuerebbe a mostrare
 * l'immagine sostituita — facendo sembrare che il salvataggio non abbia
 * funzionato. L'altra è che un object URL non revocato tiene i byte in memoria
 * finché la scheda resta aperta.
 */
export function dimenticaLogo(tier: string, name: string): void {
	for (const [k, p] of [...cache.entries()]) {
		if (!k.startsWith(`${tier}/${name}/`)) continue;
		cache.delete(k);
		p.then((u) => {
			if (u) URL.revokeObjectURL(u);
		}).catch(() => {});
	}
}
