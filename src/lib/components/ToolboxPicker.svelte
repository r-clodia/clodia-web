<script lang="ts">
	/**
	 * Pick a verb to enable from what the gateway says is enablable
	 * (clodia-platform#609): a namespace, then `ns.*` or one of its verbs. A
	 * backend whose verbs the gateway cannot enumerate offers `ns.*` only.
	 */
	import { createEventDispatcher } from 'svelte';

	export let enablable: Record<string, string[]> = {};
	export let disabled = false;
	export let label = 'Abilita';

	const dispatch = createEventDispatcher<{ pick: string }>();
	let ns = '';
	let verb = '';

	$: namespaces = Object.keys(enablable).sort();
	$: verbs = ns ? enablable[ns] ?? [] : [];
	$: if (ns && verb && verb !== `${ns}.*` && !verbs.includes(verb)) verb = '';

	function submit() {
		const v = verb || (ns ? `${ns}.*` : '');
		if (!v) return;
		dispatch('pick', v);
		ns = '';
		verb = '';
	}
</script>

<form class="picker" on:submit|preventDefault={submit}>
	<select bind:value={ns} {disabled} aria-label="Connettore">
		<option value="">connettore…</option>
		{#each namespaces as n (n)}<option value={n}>{n}</option>{/each}
	</select>
	<select bind:value={verb} disabled={disabled || !ns} aria-label="Verbo">
		<option value="">{ns ? `${ns}.* (tutti)` : 'verbo…'}</option>
		{#each verbs as v (v)}<option value={v}>{v}</option>{/each}
	</select>
	<button type="submit" class="link-btn" disabled={disabled || !ns}>{label}</button>
</form>

<style>
	.picker { display: flex; gap: 6px; margin-top: 8px; }
	.picker select {
		flex: 1; min-width: 0; font-size: 11px; padding: 2px 4px; border-radius: 4px;
		border: 1px solid var(--border); background: var(--bg); color: var(--fg);
	}
	.link-btn {
		font-size: 11px; background: transparent; border: 1px solid var(--border);
		border-radius: 4px; color: var(--fg); cursor: pointer; padding: 2px 8px; white-space: nowrap;
	}
	.link-btn:disabled { opacity: .5; cursor: default; }
</style>
