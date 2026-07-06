<script lang="ts">
	// Anteprima LIVE di un artefatto HTML del topic, in una finestra "chromeless"
	// (aperta via window.open popup). L'artefatto gira in un iframe `sandbox` SENZA
	// `allow-same-origin` → origine opaca: NON può leggere token/cookie/localStorage
	// della webui. Una CSP iniettata blocca le connessioni in uscita (defense-in-depth).
	// Aggiornamento live: polling del contenuto ogni ~2s, ricarica solo su cambio.
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { channelFileUrl } from '$lib/api/client';

	$: tier = $page.params.tier ?? '';
	$: name = $page.params.name ?? '';
	$: path = $page.url.searchParams.get('path') || '';

	let html = '';
	let err = '';
	let lastKey = '';
	let timer: ReturnType<typeof setInterval> | null = null;

	const CSP =
		'<meta http-equiv="Content-Security-Policy" content="' +
		"default-src 'none'; img-src data: blob: https:; style-src 'unsafe-inline'; " +
		"script-src 'unsafe-inline'; font-src data: https:; media-src data: blob: https:" +
		'">';

	// Default responsivo: immagini/media rientrano nella finestra (proporzioni
	// preservate), così un artefatto "solo immagine" si vede INTERO senza scroll.
	// È un default: l'artefatto può sovrascriverlo con selettori propri.
	const DEFAULT_STYLE =
		'<style>html,body{margin:0}' +
		'img,svg,video,canvas{max-width:100%;max-height:100vh;height:auto}</style>';

	const HEAD_INJECT = CSP + DEFAULT_STYLE;

	function withInject(raw: string): string {
		if (/<head[^>]*>/i.test(raw)) return raw.replace(/<head[^>]*>/i, (m) => m + HEAD_INJECT);
		return HEAD_INJECT + raw;
	}

	async function refresh() {
		if (!path) return;
		try {
			const res = await fetch(channelFileUrl(tier, name, path), { cache: 'no-store' });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const raw = await res.text();
			// chiave veloce (hash+len) per ricaricare solo al cambio reale → niente flicker
			let h = 0;
			for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) | 0;
			const key = `${h}:${raw.length}`;
			if (key !== lastKey) {
				lastKey = key;
				html = withInject(raw);
			}
			err = '';
		} catch (e) {
			err = e instanceof Error ? e.message : String(e);
		}
	}

	onMount(() => {
		void refresh();
		timer = setInterval(refresh, 2000);
	});
	onDestroy(() => {
		if (timer) clearInterval(timer);
	});
</script>

<svelte:head><title>{path || 'anteprima'} · anteprima live</title></svelte:head>

<div class="preview-root">
	{#if err}<div class="preview-err">Anteprima non disponibile: {err}</div>{/if}
	<iframe class="preview-frame" title="Anteprima artefatto"
		sandbox="allow-scripts" srcdoc={html}></iframe>
</div>

<style>
	:global(body) { margin: 0; }
	.preview-root { position: fixed; inset: 0; display: flex; flex-direction: column; background: #fff; }
	.preview-frame { flex: 1 1 auto; width: 100%; border: none; }
	.preview-err { padding: 6px 10px; font: 12px/1.4 system-ui, sans-serif; color: #a1000f; background: #ffe9ea; }
</style>
