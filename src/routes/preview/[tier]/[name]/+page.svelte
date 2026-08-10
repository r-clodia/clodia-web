<script lang="ts">
	import { CSP, HEAD_INJECT } from '$lib/artifact-frame';
	// Anteprima LIVE di un artefatto HTML del topic, in una finestra "chromeless"
	// (aperta via window.open popup). L'artefatto gira in un iframe `sandbox` SENZA
	// `allow-same-origin` → origine opaca: NON può leggere token/cookie/localStorage
	// della webui. Una CSP iniettata blocca le connessioni in uscita (defense-in-depth).
	// Aggiornamento live: polling del contenuto ogni ~2s, ricarica solo su cambio.
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { channelFileUrl, authHeaders } from '$lib/api/client';
	import { escapeHtml, isMarkdownPath, renderMarkdown } from '$lib/markdown';

	$: tier = $page.params.tier ?? '';
	$: name = $page.params.name ?? '';
	$: path = $page.url.searchParams.get('path') || '';

	let html = '';
	let err = '';
	let lastKey = '';
	let timer: ReturnType<typeof setInterval> | null = null;

	const MARKDOWN_HEAD_INJECT = CSP;

	function withInject(raw: string): string {
		if (/<head[^>]*>/i.test(raw)) return raw.replace(/<head[^>]*>/i, (m) => m + HEAD_INJECT);
		return HEAD_INJECT + raw;
	}

	function markdownDocument(raw: string): string {
		const title = escapeHtml(path.split('/').pop() || path || 'Markdown');
		return `<!doctype html>
<html lang="it">
<head>
${MARKDOWN_HEAD_INJECT}
<title>${title}</title>
<style>
	* { box-sizing: border-box; }
	html {
		overflow: auto;
		-webkit-text-size-adjust: 100%;
		text-size-adjust: 100%;
	}
	body {
		margin: 0;
		padding: clamp(18px, 3vw, 36px);
		background: #fff;
		color: #1f2933;
		font: 17px/1.62 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
	}
	.markdown-preview {
		width: min(100%, 980px);
		margin: 0 auto;
		overflow-wrap: anywhere;
		word-break: normal;
	}
	h1, h2, h3, h4, h5, h6 {
		line-height: 1.2;
		margin: 1.1em 0 .45em;
		color: #111827;
	}
	h1 { font-size: 2rem; border-bottom: 1px solid #e5e7eb; padding-bottom: .25em; }
	h2 { font-size: 1.45rem; border-bottom: 1px solid #eef2f7; padding-bottom: .2em; }
	p, ul, ol, blockquote, pre, table { margin: .75em 0; }
	ul, ol { padding-left: 1.45em; }
	p { overflow-wrap: anywhere; }
	code {
		background: #f3f4f6;
		border-radius: 4px;
		padding: .12em .32em;
		font: .92em ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
	}
	pre {
		max-width: 100%;
		overflow-x: auto;
		overflow-y: hidden;
		padding: 12px 14px;
		background: #111827;
		color: #f9fafb;
		border-radius: 8px;
		-webkit-overflow-scrolling: touch;
		overflow-wrap: normal;
	}
	pre code {
		display: block;
		min-width: max-content;
		background: transparent;
		padding: 0;
		color: inherit;
		white-space: pre;
		overflow-wrap: normal;
	}
	blockquote { border-left: 4px solid #cbd5e1; padding-left: 12px; color: #4b5563; }
	a { color: #c2410c; }
	table {
		display: block;
		max-width: 100%;
		overflow-x: auto;
		border-collapse: collapse;
		-webkit-overflow-scrolling: touch;
	}
	th, td { border: 1px solid #d8dee9; padding: 6px 9px; vertical-align: top; }
	th { background: #f8fafc; text-align: left; }
	img, video, canvas, svg {
		max-width: 100%;
		height: auto;
	}
	hr { border: none; border-top: 1px solid #e5e7eb; margin: 1.5em 0; }
	@media (max-width: 560px) {
		body { font-size: 16px; }
		h1 { font-size: 1.65rem; }
		h2 { font-size: 1.28rem; }
	}
</style>
</head>
<body><main class="markdown-preview">${renderMarkdown(raw)}</main></body>
</html>`;
	}

	async function refresh() {
		if (!path) return;
		try {
			const res = await fetch(channelFileUrl(tier, name, path), { cache: 'no-store', headers: authHeaders() });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const raw = await res.text();
			// chiave veloce (hash+len) per ricaricare solo al cambio reale → niente flicker
			let h = 0;
			for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) | 0;
			const key = `${h}:${raw.length}`;
			if (key !== lastKey) {
				lastKey = key;
				html = isMarkdownPath(path) ? markdownDocument(raw) : withInject(raw);
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
