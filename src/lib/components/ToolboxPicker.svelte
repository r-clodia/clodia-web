<script lang="ts">
	/**
	 * Pick the verbs to enable (clodia-platform#609): a button that opens a
	 * centered dialog with every enablable verb, grouped by connector, with
	 * multiple selection. A connector can be enabled whole (`ns.*`) or verb by
	 * verb; a backend whose verbs the gateway cannot enumerate offers `ns.*`
	 * only. What is already enabled shows checked and cannot be picked again.
	 */
	import { createEventDispatcher } from 'svelte';
	import { toolMayAsk } from '$lib/api/client';
	import Modal from '$lib/components/Modal.svelte';

	export let enablable: Record<string, string[]> = {};
	/** Entries already enabled (`ns.*` or `ns.verb`). */
	export let enabled: string[] = [];
	export let gated: string[] = [];
	export let disabled = false;
	export let label = 'Abilita verbi…';

	const dispatch = createEventDispatcher<{ pick: string[] }>();

	let open = false;
	let query = '';
	let picked = new Set<string>();
	let expanded = new Set<string>();

	$: have = new Set(enabled);
	$: q = query.trim().toLowerCase();
	$: groups = Object.keys(enablable)
		.sort()
		.map((ns) => {
			const verbs = enablable[ns] ?? [];
			const nsHit = !q || ns.toLowerCase().includes(q);
			const shown = nsHit ? verbs : verbs.filter((v) => v.toLowerCase().includes(q));
			return { ns, verbs, shown, visible: nsHit || shown.length > 0 };
		})
		.filter((g) => g.visible);

	const star = (ns: string) => `${ns}.*`;
	$: covered = (ns: string) => have.has(star(ns)) || picked.has(star(ns));
	$: count = picked.size;

	function show() {
		picked = new Set();
		expanded = new Set();
		query = '';
		open = true;
	}

	function toggle(entry: string) {
		const next = new Set(picked);
		if (next.has(entry)) next.delete(entry);
		else next.add(entry);
		// Picking the whole connector makes its single verbs redundant.
		if (entry.endsWith('.*') && next.has(entry)) {
			const prefix = entry.slice(0, -1);
			for (const v of [...next]) if (v !== entry && v.startsWith(prefix)) next.delete(v);
		}
		picked = next;
	}

	function toggleOpen(ns: string) {
		const next = new Set(expanded);
		if (next.has(ns)) next.delete(ns);
		else next.add(ns);
		expanded = next;
	}

	function confirm() {
		if (count === 0) return;
		dispatch('pick', [...picked].sort());
		open = false;
	}
</script>

<button type="button" class="link-btn open-btn" {disabled} on:click={show}>{label}</button>

<Modal {open} maxWidth={620} on:close={() => (open = false)}>
	<h2 slot="title">Abilita verbi</h2>
	<div class="body">
		<input class="search" type="search" placeholder="Cerca connettore o verbo…"
			bind:value={query} aria-label="Cerca connettore o verbo" />
		{#if groups.length === 0}
			<p class="muted">Nessun connettore corrisponde.</p>
		{/if}
		<ul class="groups">
			{#each groups as g (g.ns)}
				{@const whole = star(g.ns)}
				{@const isOpen = expanded.has(g.ns) || (!!q && g.shown.length > 0)}
				<li class="group">
					<div class="row ns-row">
						<label class="check">
							<input type="checkbox" checked={have.has(whole) || picked.has(whole)}
								disabled={have.has(whole)} on:change={() => toggle(whole)} />
							<span class="ns">{g.ns}</span>
							<span class="muted">· tutti i verbi</span>
							{#if toolMayAsk(whole, gated)}<span class="gated" role="img" aria-label="Può chiedere conferma" title="Può chiedere conferma (alcuni verbi, o fuori perimetro)">⚠</span>{/if}
							{#if have.has(whole)}<span class="muted">· già abilitato</span>{/if}
						</label>
						{#if g.verbs.length > 0}
							<button type="button" class="expand" aria-expanded={isOpen}
								on:click={() => toggleOpen(g.ns)}>
								{isOpen ? '▾' : '▸'} {g.verbs.length}
							</button>
						{:else}
							<span class="muted" title="Il backend nomina i propri verbi: si abilita intero">solo intero</span>
						{/if}
					</div>
					{#if isOpen}
						<ul class="verbs">
							{#each g.shown as v (v)}
								<li class="row">
									<label class="check">
										<input type="checkbox"
											checked={have.has(v) || picked.has(v) || covered(g.ns)}
											disabled={have.has(v) || covered(g.ns)}
											on:change={() => toggle(v)} />
										<code>{v}</code>
										{#if toolMayAsk(v, gated)}<span class="gated" role="img" aria-label="Può chiedere conferma" title="Può chiedere conferma">⚠</span>{/if}
										{#if have.has(v)}<span class="muted">· già abilitato</span>{/if}
									</label>
								</li>
							{/each}
						</ul>
					{/if}
				</li>
			{/each}
		</ul>
	</div>
	<div slot="actions" class="actions">
		<button type="button" class="btn" on:click={() => (open = false)}>Annulla</button>
		<button type="button" class="btn primary" disabled={count === 0} on:click={confirm}>
			{count === 0 ? 'Abilita' : `Abilita ${count}`}
		</button>
	</div>
</Modal>

<style>
	.open-btn { margin-top: 8px; }
	.link-btn {
		font-size: 11px; background: transparent; border: 1px solid var(--border);
		border-radius: 4px; color: var(--fg); cursor: pointer; padding: 2px 8px; white-space: nowrap;
	}
	.link-btn:disabled { opacity: .5; cursor: default; }
	.body { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
	.search {
		font-size: 13px; padding: 6px 8px; border-radius: 6px;
		border: 1px solid var(--border); background: var(--bg); color: var(--fg);
	}
	.groups, .verbs { list-style: none; margin: 0; padding: 0; }
	.groups { display: flex; flex-direction: column; gap: 4px; max-height: 55vh; overflow-y: auto; }
	.group { flex: none; border-bottom: 1px solid var(--border); padding: 4px 0; }
	.verbs { margin-left: 22px; display: flex; flex-direction: column; gap: 2px; }
	.row { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 13px; }
	.check { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; cursor: pointer; }
	.check code { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.ns { font-weight: 600; }
	.muted { color: var(--fg-muted); font-size: 11px; white-space: nowrap; }
	.gated { color: #d97706; }
	.expand {
		background: transparent; border: 1px solid var(--border); border-radius: 4px;
		color: var(--fg-muted); cursor: pointer; font-size: 11px; padding: 1px 6px; white-space: nowrap;
	}
	.actions { display: flex; justify-content: flex-end; gap: 8px; }
	.btn {
		font-size: 13px; padding: 6px 12px; border-radius: 6px; cursor: pointer;
		border: 1px solid var(--border); background: transparent; color: var(--fg);
	}
	.btn.primary { background: var(--accent, #ff6b3d); border-color: transparent; color: #fff; }
	.btn:disabled { opacity: .5; cursor: default; }
</style>
