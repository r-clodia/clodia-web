<script lang="ts">
	/**
	 * The explicit A·V·R·Q rules of a room — or of the instance — with an Ⓧ to
	 * remove one (clodia-platform#693). The rules a gate wrote say so (origin,
	 * who approved, when): an approval «sempre» is a rule like any other, and
	 * a rule nobody can see is a rule nobody can take back.
	 */
	import { onMount } from 'svelte';
	import {
		apiErrorDetail,
		getGlobalRules,
		getRoomRules,
		removeGlobalRule,
		removeRoomRule,
		type AuthzRule
	} from '$lib/api/client';
	import { toastError, toastSuccess } from '$lib/stores/toasts';

	/** A room (`tier`+`name`) or, with neither, the instance's global rules. */
	export let tier = '';
	export let name = '';
	export let canEdit = false;

	let rules: AuthzRule[] = [];
	let err = '';
	let loaded = false;
	let busy = '';
	let onlyGate = false;

	$: global = !tier || !name;
	$: shown = onlyGate ? rules.filter((r) => r.origin === 'gate') : rules;

	async function reload() {
		err = '';
		try {
			rules = global ? await getGlobalRules() : await getRoomRules(tier, name);
		} catch (e) {
			err = apiErrorDetail(e);
		} finally {
			loaded = true;
		}
	}
	onMount(() => void reload());

	const EFFETTO: Record<string, string> = { allow: 'consenti', ask: 'chiedi', deny: 'nega' };
	const ORIGINE: Record<string, string> = { gate: 'gate', manual: 'manuale', plan: 'piano' };

	function when(at?: number | null): string {
		return at ? new Date(at * 1000).toLocaleString() : '';
	}

	async function remove(r: AuthzRule) {
		if (busy) return;
		const bersagli = r.rule.map((c) => c.match).join(', ');
		if (!confirm(`Togliere la regola «${r.agent} · ${r.verb} · ${bersagli}»?`)) return;
		busy = r.id;
		try {
			if (global) await removeGlobalRule(r.id);
			else await removeRoomRule(tier, name, r.id);
			toastSuccess('Regola tolta');
			await reload();
		} catch (e) {
			toastError('Regola non tolta', apiErrorDetail(e));
		} finally {
			busy = '';
		}
	}
</script>

{#if err}
	<p class="err" role="alert">{err}</p>
{:else if loaded}
	{#if rules.length === 0}
		<p class="muted">Nessuna regola esplicita {global ? "nell'istanza" : 'in questa stanza'}.</p>
	{:else}
		{#if rules.some((r) => r.origin !== 'gate')}
			<label class="only"><input type="checkbox" bind:checked={onlyGate} /> solo quelle dei gate</label>
		{/if}
		<ul class="rules">
			{#each shown as r (r.id)}
				<li>
					<span class="who" title="agente">{r.agent === '*' ? 'tutti' : r.agent}</span>
					<code class="verb">{r.verb}</code>
					<span class="clauses">
						{#each r.rule as c}
							<span class="clause {c.effect}"><b>{EFFETTO[c.effect] ?? c.effect}</b> <code>{c.match}</code></span>
						{/each}
					</span>
					<span class="origin" title={r.by ? `${ORIGINE[r.origin] ?? r.origin} · ${r.by}${r.at ? ' · ' + when(r.at) : ''}` : ''}>
						{ORIGINE[r.origin] ?? r.origin}{#if r.by} · {r.by}{/if}
					</span>
					{#if canEdit}
						<button type="button" class="rm" disabled={!!busy}
							title="Togli questa regola" aria-label="Togli la regola {r.id}"
							on:click={() => void remove(r)}>Ⓧ</button>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
{/if}

<style>
	.muted { color: var(--fg-muted); font-size: 11px; margin: 4px 0; }
	.err { color: #dc2626; font-size: 11px; margin: 4px 0; }
	.only { font-size: 11px; color: var(--fg-muted); display: flex; gap: 4px; align-items: center; margin: 4px 0; }
	.rules { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
	.rules li { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; font-size: 11px; min-width: 0; }
	.who { font-weight: 600; white-space: nowrap; }
	.verb { font-size: 11px; }
	.clauses { display: flex; flex-wrap: wrap; gap: 2px 6px; min-width: 0; }
	.clause code { font-size: 10px; word-break: break-all; }
	.clause.allow b { color: #16a34a; }
	.clause.ask b { color: #d97706; }
	.clause.deny b { color: #dc2626; }
	.origin { font-size: 10px; color: var(--fg-muted); white-space: nowrap; }
	.rm { background: transparent; border: none; color: var(--fg-muted); cursor: pointer; font-size: 13px; line-height: 1; padding: 0 2px; margin-left: auto; }
	.rm:hover:not(:disabled) { color: var(--danger, #dc2626); }
	.rm:disabled { opacity: .5; cursor: default; }
</style>
