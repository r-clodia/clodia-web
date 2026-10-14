<script lang="ts">
	// Una voce di whitelist resa leggibile (clodia-platform#424). Quando il
	// gateway manda nome e link per quella voce si mostra il nome, cliccabile,
	// e la voce canonica resta nel tooltip — è quella che si rimuove e che
	// decide, non va nascosta, va solo tradotta. Senza etichetta (gateway
	// vecchio, schema che non ne produce) la voce resta com'è.
	//
	// Il nome di ripiego non nomina più un connettore (#520): chi manda il link
	// manda anche il nome, e inventarne uno al posto suo significava indovinare
	// di CHI fosse la risorsa — giusto finché l'unico schema con un link era
	// quello di Drive.
	import type { UriLabelInfo } from '$lib/api/client';

	export let uri: string;
	export let labels: Record<string, UriLabelInfo> | undefined = undefined;

	$: info = labels?.[uri];
</script>

{#if info?.url}
	<a class="uri-label" href={info.url} target="_blank" rel="noopener noreferrer" title={uri}>
		📁 {info.name ?? uri}
	</a>
{:else}
	{uri}
{/if}

<style>
	.uri-label { color: var(--accent); text-decoration: none; overflow-wrap: anywhere; }
	.uri-label:hover { text-decoration: underline; }
</style>
