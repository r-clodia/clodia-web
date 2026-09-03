<script lang="ts">
	import { MIN_ZOOM_INTERO, withInject } from '$lib/artifact-frame';
	// Pannello CANVAS inline del topic: mostra LIVE l'artefatto HTML che gli agenti
	// producono con artifact.render (→ files/artifact.html). Appare da solo quando il
	// file esiste, si nasconde quando non c'è. Stesso modello di sicurezza della
	// finestra piena: iframe `sandbox` senza allow-same-origin (origine opaca) + CSP;
	// fit-to-window via zoom; refresh a polling (~2s), ricarica solo al cambio.
	import { onMount, onDestroy } from 'svelte';
	import { channelFileUrl, authHeaders } from '$lib/api/client';
	import { artifactDelay } from '$lib/polling';

	export let tier: string;
	export let name: string;
	export let path = 'files/artifact.html';
	/** Notifica il parent quando l'artefatto compare/sparisce (per mostrare header ecc.). */
	export let onExists: ((v: boolean) => void) | undefined = undefined;

	let html = '';
	let exists = false;
	let lastKey = '';
	let timer: ReturnType<typeof setTimeout> | null = null;
	// Show/hide del canvas inline (persistito). L'icona wide (openFull) resta invariata.
	let open = true;
	function toggleOpen() {
		open = !open;
		try { localStorage.setItem('canvas-open', open ? '1' : '0'); } catch {}
	}

	function setExists(v: boolean) {
		if (v !== exists) {
			exists = v;
			onExists?.(v);
			// La cadenza dipende da questo: un artefatto appena comparso deve
			// passare subito ai due secondi, uno sparito deve rallentare.
			programma();
		}
	}
	async function refresh() {
		try {
			const res = await fetch(channelFileUrl(tier, name, path), { cache: 'no-store', headers: authHeaders() });
			if (!res.ok) { setExists(false); return; }
			const raw = await res.text();
			let h = 0;
			for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) | 0;
			const key = `${h}:${raw.length}`;
			if (key !== lastKey) { lastKey = key; html = withInject(raw); }
			setExists(true);
		} catch {
			setExists(false);
		}
	}
	function openFull() {
		const url = `/preview/${encodeURIComponent(tier)}/${encodeURIComponent(name)}?path=${encodeURIComponent(path)}`;
		window.open(url, `artifact-${tier}-${name}`, 'popup,width=1024,height=720');
	}

	// Se il documento è molto più largo del pannello, qui dentro non si legge:
	// lo si dice invece di mostrare una miniatura. La soglia è la stessa scala
	// minima leggibile usata per decidere se mostrare intero un artefatto.
	let frame: HTMLIFrameElement | null = null;
	let tropoStretto = false;
	function misura() {
		try {
			const d = frame?.contentDocument;
			const w = Math.max(d?.documentElement?.scrollWidth ?? 0, d?.body?.scrollWidth ?? 0);
			const disponibile = frame?.clientWidth ?? 0;
			tropoStretto = !!w && !!disponibile && disponibile / w < MIN_ZOOM_INTERO;
		} catch {
			tropoStretto = false;   // iframe non ispezionabile: non si indovina
		}
	}

	// Riparte quando cambia topic.
	$: if (tier && name) { lastKey = ''; }

	// Cadenza ADATTIVA invece di 2 secondi fissi (issue del polling, 3 set 2026).
	// Due secondi servono a vedere un canvas CAMBIARE mentre l'agente lo scrive;
	// a scoprire che è NATO bastano venti. Su un canale senza artefatto questo
	// timer produceva 30 richieste al minuto che rispondono 404 — 5073 contate
	// nei log dell'agent-server in tre ore — e su una scheda in background le
	// produceva per nessuno.
	let visibile = true;
	function programma() {
		if (timer) clearTimeout(timer);
		timer = null;
		const attesa = artifactDelay({ visibile, esiste: exists });
		if (attesa === null) return;
		timer = setTimeout(async () => {
			await refresh();
			misura();
			programma();
		}, attesa);
	}
	function onVisibility() {
		const prima = visibile;
		visibile = typeof document === 'undefined' || !document.hidden;
		if (visibile && !prima) void refresh();
		programma();
	}
	onMount(() => {
		try { open = localStorage.getItem('canvas-open') !== '0'; } catch {}
		visibile = typeof document === 'undefined' || !document.hidden;
		document.addEventListener('visibilitychange', onVisibility);
		void refresh().then(programma);
	});
	onDestroy(() => {
		if (timer) clearTimeout(timer);
		if (typeof document !== 'undefined')
			document.removeEventListener('visibilitychange', onVisibility);
	});
</script>

{#if exists}
	<section class="canvas-panel">
		<div class="canvas-head">
			<span>🎨 Canvas live</span>
			<div class="canvas-actions">
				<button
					type="button"
					class="canvas-btn"
					title={open ? 'Nascondi il canvas' : 'Mostra il canvas'}
					aria-label={open ? 'Nascondi il canvas' : 'Mostra il canvas'}
					aria-expanded={open}
					on:click={toggleOpen}
				>{open ? '▾' : '▸'}</button>
				<button type="button" class="canvas-btn" title="Apri il canvas a schermo intero" on:click={openFull}>⛶</button>
			</div>
		</div>
		{#if open}
			<iframe class="canvas-frame" title="Canvas live" sandbox="allow-scripts"
				srcdoc={html} bind:this={frame}></iframe>
			{#if tropoStretto}
				<!-- Il pannello è largo quanto la sidebar. Un documento da 1180px lì
				     starebbe al 30%: una miniatura che nessuno può leggere, e che fa
				     credere che l'artefatto sia venuto male. Meglio dire cosa fare. -->
				<button type="button" class="canvas-hint" on:click={openFull}>
					⛶ Troppo stretto per leggerlo qui — aprilo a schermo intero
				</button>
			{/if}
		{/if}
	</section>
{/if}

<style>
	.canvas-panel { margin-top: 14px; }
	.canvas-head { display: flex; align-items: center; justify-content: space-between;
		font-size: 12px; font-weight: 600; margin-bottom: 5px; }
	.canvas-actions { display: flex; align-items: center; gap: 6px; }
	.canvas-btn { background: none; border: none; cursor: pointer; color: var(--fg-muted); font-size: 15px; line-height: 1; padding: 0 2px; }
	.canvas-btn:hover { color: var(--accent); }
	.canvas-hint { display: block; width: 100%; margin-top: 6px; padding: 6px 8px;
		font: inherit; font-size: 11px; text-align: left; cursor: pointer;
		color: inherit; opacity: .8; background: transparent;
		border: 1px dashed var(--border, #3a3a3a); border-radius: 6px; }
	.canvas-hint:hover { opacity: 1; }
	.canvas-frame { width: 100%; height: 260px; border: 1px solid var(--border); border-radius: 8px; background: #fff; display: block; }
</style>
