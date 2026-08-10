<script lang="ts">
	/**
	 * Il segno di un topic: la sua immagine, o un monogramma al suo posto.
	 *
	 * **Perché un monogramma e non un'icona.** Un'icona generica su venti topic
	 * sono venti macchie identiche: occupa spazio e non distingue niente, che è
	 * peggio del vuoto perché *sembra* informazione. La lettera iniziale su un
	 * colore derivato dal nome resta diversa da topic a topic ed è **stabile nel
	 * tempo** — lo stesso topic ha sempre lo stesso segno, quindi l'occhio lo
	 * ritrova nella lista invece di rileggere ogni titolo.
	 *
	 * Il colore viene dal `name` e non dal `title`: il titolo si riscrive, il
	 * nome no. Un segno che cambia colore quando qualcuno corregge un titolo
	 * smetterebbe di essere un appiglio.
	 *
	 * Un'unica copia per la lista e per la pagina del topic: due componenti che
	 * disegnano la stessa cosa divergono, e diverge sempre quello che si guarda
	 * meno.
	 */
	import { topicLogoUrl } from '$lib/topicLogo';

	export let tier: string;
	export let name: string;
	/** Path dell'immagine nel meta: qui serve solo come flag. */
	export let logo: string | null | undefined = undefined;
	export let title: string | null | undefined = undefined;
	export let size = 18;
	/** Cambia per bucare la cache dopo un caricamento. */
	export let rev = 0;

	// L'immagine si SCARICA con l'autenticazione e si consegna come blob.
	//
	// Un `<img src>` verso l'endpoint non porta l'header `Authorization`: il
	// browser emette una richiesta anonima, il server risponde 401, e l'immagine
	// resta rotta **senza segnalare niente** — si vede solo il segnaposto, e
	// sembra che il caricamento non abbia funzionato invece che un problema di
	// identità. È così che questo difetto è arrivato in produzione: il gateway
	// leggeva i byte, la rotta rispondeva 200, e la pagina mostrava il
	// monogramma. Provato ovunque tranne dove sta il browser.
	//
	// L'endpoint degli avatar (`/api/agents/<n>/pfp`) è invece APERTO, ed è la
	// ragione per cui lì un `<img src>` funziona: un avatar non sta in un
	// compartimento. Il logo di un topic sì, e aprirlo direbbe a chiunque
	// indovini tier e nome che quella stanza esiste.
	let src = '';
	$: if (logo) {
		const t = tier, n = name, r = rev;
		topicLogoUrl(t, n, r).then((u) => {
			if (t === tier && n === name && r === rev) src = u ?? '';
		});
	} else {
		src = '';
	}

	// Iniziale: dal titolo se c'è, altrimenti dal nome. Le cifre e i simboli
	// restano come sono — «#» come monogramma è comunque un segno.
	$: iniziale = ((title || name || '?').trim()[0] || '?').toUpperCase();

	/** Tinta stabile dal nome. Non casuale: lo stesso topic deve avere sempre lo
	 *  stesso colore, o il segno non serve a ritrovarlo. */
	function tinta(s: string): number {
		let h = 0;
		for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
		return h;
	}
	$: hue = tinta(name || '');
	/** Immagine rotta o non leggibile → si ripiega sul monogramma invece di
	 *  lasciare il riquadro dell'immagine spezzata: un buco visivo si legge come
	 *  un difetto della pagina, non come «questo topic non ha un logo». */
	let rotta = false;
	$: if (src) rotta = false;
</script>

{#if src && !rotta}
	<img
		class="mark img"
		style={`width:${size}px;height:${size}px`}
		src={src}
		alt=""
		on:error={() => (rotta = true)}
	/>
{:else}
	<span
		class="mark mono"
		style={`width:${size}px;height:${size}px;font-size:${Math.round(size * 0.52)}px;` +
			`background:hsl(${hue} 45% 88%);color:hsl(${hue} 55% 28%)`}
		aria-hidden="true">{iniziale}</span
	>
{/if}

<style>
	.mark {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 5px;
		flex: none;
		vertical-align: -3px;
		margin-right: 6px;
	}
	.img {
		object-fit: cover;
		background: var(--surface-2, rgba(127, 127, 127, 0.12));
	}
	.mono {
		font-weight: 700;
		line-height: 1;
		letter-spacing: 0;
		user-select: none;
	}
	/* In tema scuro le tinte chiare del monogramma diventano abbaglianti: si
	   abbassa la luminosità del fondo e si alza quella del testo, mantenendo la
	   stessa tinta — così il segno resta riconoscibile passando da un tema
	   all'altro. */
	@media (prefers-color-scheme: dark) {
		.mono {
			filter: brightness(0.42) saturate(1.4);
			color: #fff;
		}
	}
	:global(:root[data-theme='dark']) .mono {
		filter: brightness(0.42) saturate(1.4);
		color: #fff;
	}
	:global(:root[data-theme='light']) .mono {
		filter: none;
	}
</style>
