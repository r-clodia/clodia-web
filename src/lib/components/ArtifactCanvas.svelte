<script lang="ts">
	import { withInject } from '$lib/artifact-frame';
	// Pannello CANVAS inline del topic: mostra LIVE l'artefatto HTML che gli agenti
	// producono con artifact.render (→ files/artifact.html). Appare da solo quando il
	// file esiste, si nasconde quando non c'è. Stesso modello di sicurezza della
	// finestra piena: iframe `sandbox` senza allow-same-origin (origine opaca) + CSP;
	// fit-to-window via zoom; refresh a polling (~2s), ricarica solo al cambio.
	import { onMount, onDestroy } from 'svelte';
	import { channelFileUrl, authHeaders } from '$lib/api/client';

	export let tier: string;
	export let name: string;
	export let path = 'files/artifact.html';
	/** Notifica il parent quando l'artefatto compare/sparisce (per mostrare header ecc.). */
	export let onExists: ((v: boolean) => void) | undefined = undefined;

	let html = '';
	let exists = false;
	let lastKey = '';
	let timer: ReturnType<typeof setInterval> | null = null;
	// Show/hide del canvas inline (persistito). L'icona wide (openFull) resta invariata.
	let open = true;
	function toggleOpen() {
		open = !open;
		try { localStorage.setItem('canvas-open', open ? '1' : '0'); } catch {}
	}

	function setExists(v: boolean) {
		if (v !== exists) { exists = v; onExists?.(v); }
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

	// Riparte quando cambia topic.
	$: if (tier && name) { lastKey = ''; }

	onMount(() => {
		try { open = localStorage.getItem('canvas-open') !== '0'; } catch {}
		void refresh();
		timer = setInterval(refresh, 2000);
	});
	onDestroy(() => { if (timer) clearInterval(timer); });
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
			<iframe class="canvas-frame" title="Canvas live" sandbox="allow-scripts" srcdoc={html}></iframe>
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
	.canvas-frame { width: 100%; height: 260px; border: 1px solid var(--border); border-radius: 8px; background: #fff; display: block; }
</style>
