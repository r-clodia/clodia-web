<script lang="ts">
	/**
	 * "Strutture dati" of one pack (clodia-platform#688): each datastore
	 * structure the pack declares (name, purpose, PII, schema version) with its
	 * instances — name, tier, scopes importing it, link to the instance's
	 * Databases page. A pack declares structures, never databases: installing
	 * it creates nothing, an instance exists only once someone creates it, so
	 * an admin gets a "Crea db" button per structure (`create` event).
	 */
	import { createEventDispatcher } from 'svelte';
	import type { DatastoreStructure } from '$lib/api/client';
	import { datastoreHref, scopeHref } from '$lib/databases.js';

	export let structures: DatastoreStructure[] = [];
	export let admin = false;
	/** Id of an instance just created here, highlighted until the next one. */
	export let highlight = '';

	const dispatch = createEventDispatcher<{ create: DatastoreStructure }>();

	function piiLabel(v: boolean | null | undefined): string {
		return v ? 'PII' : '';
	}
</script>

{#if structures.length}
	<div class="pd-label">Strutture dati</div>
	<div class="pd-list">
		{#each structures as s (s.id)}
			<div class="pd-struct">
				<div class="pd-head">
					<span class="pd-kind">struttura</span>
					<span class="pd-name" title={s.id}>{s.name}</span>
					{#if s.schema_version !== undefined && s.schema_version !== null && s.schema_version !== ''}
						<span class="pd-tag" title="Versione dello schema (ultima migrazione)">schema v{s.schema_version}</span>
					{/if}
					{#if piiLabel(s.pii)}<span class="pd-tag pii">PII</span>{/if}
					<span class="pd-desc">{s.purpose || '—'}</span>
					{#if admin}
						<button type="button" class="pd-create" on:click={() => dispatch('create', s)}
							title="Crea un database vuoto con lo schema di questa struttura">＋ Crea db</button>
					{/if}
				</div>
				{#if s.instances.length}
					<ul class="pd-instances">
						{#each s.instances as i (i.id)}
							<li class:pd-new={i.id === highlight}>
								<a class="pd-inst" href={datastoreHref(i.id)} title="Apri {i.id} in Databases">
									<span class="pd-inst-name">{s.name} · {i.name}</span>
								</a>
								<span class="pd-tag tier">{i.tier}</span>
								{#if i.status && i.status !== 'active'}<span class="pd-tag warn">{i.status}</span>{/if}
								{#if i.id === highlight}<span class="pd-tag ok">nuovo</span>{/if}
								<span class="pd-scopes">
									{#each i.imported_by_scopes ?? [] as sc (sc)}
										<a href={scopeHref(sc)} title="importato in {sc}">{sc}</a>
									{:else}
										<span class="pd-muted">nessuno spazio lo importa</span>
									{/each}
								</span>
							</li>
						{/each}
					</ul>
				{:else}
					<div class="pd-muted pd-none">Nessun db: {admin ? 'creane uno con «Crea db».' : 'un admin può crearne uno.'}</div>
				{/if}
			</div>
		{/each}
	</div>
{/if}

<style>
	.pd-list { margin: 4px 0; display: flex; flex-direction: column; gap: 6px; }
	.pd-struct { border: 1px solid var(--border); border-radius: 8px; padding: 6px 10px; }
	.pd-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; font-size: 13px; }
	.pd-label { margin-top: 8px; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--fg-muted); }
	.pd-kind { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; padding: 1px 6px; border-radius: 999px;
		border: 1px solid rgba(14, 165, 233, 0.5); color: #0ea5e9; flex-shrink: 0; }
	.pd-name { font-family: var(--mono); font-weight: 600; }
	.pd-desc { color: var(--fg-muted); font-size: 12px; flex: 1; min-width: 120px; }
	.pd-tag { font-size: 10.5px; padding: 1px 6px; border: 1px solid var(--border); border-radius: 999px; white-space: nowrap; }
	.pd-tag.tier { font-family: var(--mono); }
	.pd-tag.pii, .pd-tag.warn { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 50%, var(--border)); }
	.pd-tag.ok { color: var(--success); border-color: color-mix(in srgb, var(--success) 50%, var(--border)); }
	.pd-create { font-size: 12px; padding: 3px 9px; white-space: nowrap; }
	.pd-instances { list-style: none; margin: 6px 0 0; padding: 0 0 0 12px; display: flex; flex-direction: column; gap: 4px; }
	.pd-instances li { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12px; min-width: 0; }
	.pd-instances li.pd-new { background: color-mix(in srgb, var(--success) 8%, transparent); border-radius: 6px; }
	.pd-inst { font-family: var(--mono); }
	.pd-inst:hover { text-decoration: underline; }
	.pd-scopes { display: flex; gap: 4px; flex-wrap: wrap; font-size: 11px; }
	.pd-scopes a { font-family: var(--mono); padding: 1px 6px; border: 1px solid var(--border); border-radius: 999px; }
	.pd-scopes a:hover { border-color: var(--fg-muted); }
	.pd-muted { color: var(--fg-muted); font-size: 11px; }
	.pd-none { margin: 4px 0 0 12px; }
</style>
