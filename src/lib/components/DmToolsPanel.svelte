<script lang="ts">
	/**
	 * The verbs enabled OUTSIDE a room (clodia-platform#609, epic #604
	 * decision 5): DMs and jobs not bound to a topic. Read by every person,
	 * changed by an admin.
	 */
	import { onMount } from 'svelte';
	import { apiErrorDetail, getDmTools, setDmTool, toolMayAsk, type Toolbox } from '$lib/api/client';
	import ToolboxPicker from '$lib/components/ToolboxPicker.svelte';
	import { isAdmin } from '$lib/stores/capabilities';
	import { toastError } from '$lib/stores/toasts';

	let box: Toolbox | null = null;
	let err = '';
	let busy = false;

	$: isGated = (v: string) => toolMayAsk(v, box?.gated ?? []);

	async function load() {
		err = '';
		try {
			box = await getDmTools();
		} catch (e) {
			err = apiErrorDetail(e);
		}
	}
	onMount(() => void load());

	async function act(action: 'enable' | 'disable', verb: string) {
		if (busy) return;
		busy = true;
		try {
			await setDmTool(action, verb);
			await load();
		} catch (e) {
			toastError('Strumenti fuori dai canali', apiErrorDetail(e));
		} finally {
			busy = false;
		}
	}

	async function enableMany(verbs: string[]) {
		if (busy || verbs.length === 0) return;
		busy = true;
		const falliti: string[] = [];
		for (const v of verbs) {
			try {
				await setDmTool('enable', v);
			} catch (e) {
				falliti.push(`${v}: ${apiErrorDetail(e)}`);
			}
		}
		await load();
		busy = false;
		if (falliti.length) toastError('Strumenti fuori dai canali', falliti.join(' · '));
	}
</script>

<div class="head">
	<h2>Strumenti fuori dai canali</h2>
</div>
<p class="muted">
	I verbi MCP e dei connettori che gli agenti possono usare nei DM e nei job non legati a un
	canale. Dentro un canale vale la lista del canale.
</p>
{#if err}
	<p class="err" role="alert">{err}</p>
{:else if !box}
	<p class="muted">Caricamento…</p>
{:else}
	{#if box.enabled.length === 0}
		<p class="muted">Nessun verbo abilitato fuori dai canali.</p>
	{:else}
		<ul class="list">
			{#each box.enabled as v (v)}
				<li>
					<code>{v}</code>
					{#if isGated(v)}<span class="gated" role="img" aria-label="Può chiedere conferma" title="Può chiedere conferma (alcuni verbi, o fuori perimetro)">⚠</span>{/if}
					{#if $isAdmin}
						<button type="button" class="x" disabled={busy} aria-label="Disabilita {v}"
							on:click={() => void act('disable', v)}>✕</button>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
	{#if $isAdmin}
		<ToolboxPicker enablable={box.enablable} enabled={box.enabled} gated={box.gated ?? []}
			disabled={busy} on:pick={(e) => void enableMany(e.detail)} />
	{/if}
{/if}

<style>
	.muted { color: var(--fg-muted); font-size: 12px; margin: 4px 0; }
	.err { color: #dc2626; font-size: 12px; }
	.list { list-style: none; margin: 6px 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
	.list li { display: flex; align-items: center; gap: 6px; font-size: 12px; }
	.gated { color: #d97706; }
	.x { background: transparent; border: none; color: var(--fg-muted); cursor: pointer; font-size: 12px; }
	.x:hover:not(:disabled) { color: #dc2626; }
</style>
