<script lang="ts">
	/**
	 * A tab on the right edge that opens a side panel — the same shape as the
	 * «Aiuto» helpdesk widget (`ChatWidget`): clodia-platform#724 moves the
	 * topic's Participants there, out of the sidebar.
	 *
	 * `top` places the tab on the edge. The helpdesk tab sits at 50% (half-way
	 * up), so another tab goes ABOVE it and the two never overlap.
	 */
	import { onDestroy } from 'svelte';
	import { browser } from '$app/environment';

	export let label: string;
	export let icon = '';
	/** A number shown on the tab and in the header (e.g. how many). */
	export let count: number | null = null;
	/** CSS `top` of the tab on the right edge. */
	export let top = '28%';
	export let open = false;

	function onKey(e: KeyboardEvent) {
		if (open && e.key === 'Escape') open = false;
	}
	if (browser) window.addEventListener('keydown', onKey);
	onDestroy(() => {
		if (browser) window.removeEventListener('keydown', onKey);
	});
</script>

{#if open}
	<section class="etp-panel" aria-label={label}>
		<header class="etp-head">
			{#if icon}<span aria-hidden="true">{icon}</span>{/if}
			<span class="etp-title">{label}</span>
			{#if count !== null}<span class="etp-count">{count}</span>{/if}
			<button type="button" class="etp-x" on:click={() => (open = false)} aria-label={`Chiudi ${label}`}>×</button>
		</header>
		<div class="etp-body">
			<slot />
		</div>
	</section>
{:else}
	<button type="button" class="etp-tab" style="top: {top}" on:click={() => (open = true)}
		aria-label={`Apri ${label}`} aria-expanded="false" title={label}>
		{#if icon}<span class="etp-tab-icon" aria-hidden="true">{icon}</span>{/if}
		<span class="etp-tab-text">{label}</span>
		{#if count !== null}<span class="etp-tab-count">{count}</span>{/if}
	</button>
{/if}

<style>
	/* The same tab as `.cw-tab` (ChatWidget): narrow, on the right edge. */
	.etp-tab {
		position: fixed; right: 0; transform: translateY(-50%); z-index: 60;
		display: flex; flex-direction: column; align-items: center; gap: 6px;
		padding: 10px 5px; border: 1px solid var(--border); border-right: none;
		border-radius: 10px 0 0 10px; background: var(--card-bg); color: var(--fg);
		font: inherit; font-size: 12px; font-weight: 700; cursor: pointer;
		box-shadow: 0 6px 18px rgba(0,0,0,.25);
	}
	.etp-tab:hover, .etp-tab:focus-visible { border-color: var(--accent); color: var(--accent); }
	.etp-tab-icon { font-size: 15px; line-height: 1; }
	.etp-tab-text { writing-mode: vertical-rl; transform: rotate(180deg); letter-spacing: .04em; }
	.etp-tab-count { font-size: 11px; color: var(--fg-muted); }

	/* The same panel as `.cw-panel`. */
	.etp-panel {
		position: fixed; right: 12px; top: 12px; bottom: 12px; z-index: 70;
		width: min(380px, calc(100vw - 24px));
		display: flex; flex-direction: column; background: var(--bg);
		border: 1px solid var(--border); border-radius: 14px; overflow: hidden;
		box-shadow: 0 18px 50px rgba(0,0,0,.45);
	}
	@media (max-width: 640px) {
		.etp-panel { inset: 0; width: auto; border-radius: 0; border: none; }
		.etp-tab { padding: 8px 4px; }
	}
	.etp-head { flex: 0 0 auto; display: flex; align-items: center; gap: 6px; padding: 10px 12px;
		border-bottom: 1px solid var(--border); }
	.etp-title { font-weight: 700; font-size: 14px; flex: 1 1 auto; }
	.etp-count { font-size: 12px; color: var(--fg-muted); }
	.etp-x { background: transparent; border: none; color: var(--fg-muted); font-size: 20px; cursor: pointer;
		line-height: 1; padding: 2px 5px; border-radius: 6px; }
	.etp-x:hover { color: var(--fg); background: rgba(127,127,127,.12); }
	.etp-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 12px; }
</style>
