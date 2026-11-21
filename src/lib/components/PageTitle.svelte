<script lang="ts">
	// This page's part of the document title (clodia-platform#510): composed
	// with the brand by `$lib/stores/pageTitle`, the title's only owner.
	import { onDestroy } from 'svelte';
	import { setPagePart } from '$lib/stores/pageTitle';

	export let part: string | null | undefined = '';

	let clear: () => void = () => {};
	$: {
		clear();
		clear = setPagePart(part);
	}
	onDestroy(() => clear());
</script>
