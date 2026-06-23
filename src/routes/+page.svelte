<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';

	// Root path: send the user to the only functional section so the shell
	// always lands on something useful.
	onMount(() => {
		void goto('/agents', { replaceState: true });
	});
</script>

<p style="color: var(--fg-muted)">Loading…</p>
