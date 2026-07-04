<script lang="ts">
	/**
	 * La lista skills è stata assorbita dalla pagina Packs (tree pack →
	 * skills/rules/mcp). Questa route resta solo come redirect per i vecchi
	 * link; le pagine dettaglio /skills/[name] restano attive.
	 */
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';

	onMount(() => {
		void goto('/packs', { replaceState: true });
	});
</script>

<p class="redirect">Redirect a <a href="/packs">Packs</a>…</p>

<style>
	.redirect {
		color: var(--fg-muted);
		font-size: 13px;
	}
</style>
