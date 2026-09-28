<script lang="ts">
	// Una voce di whitelist resa leggibile (clodia-platform#424). Per una
	// cartella Drive (`gdrive:folder/<id>`) il gateway manda nome e link: si
	// mostra il nome, cliccabile, e la voce canonica resta nel tooltip — è
	// quella che si rimuove e che decide, non va nascosta, va solo tradotta.
	// Senza etichetta (altri schemi, gateway vecchio) la voce resta com'è.
	import type { UriLabelInfo } from '$lib/api/client';

	export let uri: string;
	export let labels: Record<string, UriLabelInfo> | undefined = undefined;

	$: info = labels?.[uri];
</script>

{#if info?.url}
	<a class="uri-label" href={info.url} target="_blank" rel="noopener noreferrer" title={uri}>
		📁 {info.name ?? 'Cartella Drive'}
	</a>
{:else}
	{uri}
{/if}

<style>
	.uri-label { color: var(--accent); text-decoration: none; overflow-wrap: anywhere; }
	.uri-label:hover { text-decoration: underline; }
</style>
