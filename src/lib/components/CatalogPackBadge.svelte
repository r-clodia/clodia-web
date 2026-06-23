<script lang="ts">
	import type { CatalogPack } from '$lib/api/types';

	export let pack: CatalogPack;
	export let compact = false;

	$: title =
		pack === 'base-pack'
			? 'Base pack: nativo, presente in ogni installazione Clodia Agency'
			: pack === 'local-pack'
				? 'Local pack: creato, installato o modificato in questa installazione'
				: `${pack}: pack installato in questa istanza`;
</script>

<span
	class="pack"
	class:base={pack === 'base-pack'}
	class:local={pack === 'local-pack'}
	class:acme={pack === 'acme-pack'}
	class:compact
	title={title}
>
	{pack}
</span>

<style>
	.pack {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 2px 8px;
		border-radius: 999px;
		font-size: 10px;
		font-weight: 800;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		white-space: nowrap;
		border: 1px solid transparent;
		color: #d1d5db;
		background: rgba(107, 114, 128, 0.16);
		border-color: rgba(107, 114, 128, 0.5);
	}
	.pack.compact {
		padding-inline: 6px;
	}
	.base {
		color: #d1d5db;
		border-color: rgba(107, 114, 128, 0.5);
		background: rgba(107, 114, 128, 0.16);
	}
	.local {
		color: var(--accent);
		border-color: rgba(255, 107, 61, 0.5);
		background: rgba(255, 107, 61, 0.12);
	}
	.acme {
		color: #7dd3fc;
		border-color: rgba(56, 189, 248, 0.5);
		background: rgba(14, 116, 144, 0.2);
	}
</style>
