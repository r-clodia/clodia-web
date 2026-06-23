<script lang="ts">
	export let title: string;
	export let description: string = 'Coming soon.';
</script>

<header class="head">
	<h1>{title}</h1>
</header>

<div class="card">
	<p>{description}</p>
	<p class="hint">This section is a placeholder in the v2 scaffold. Wiring lands in a later task.</p>
</div>

<style>
	.head {
		margin-bottom: 20px;
	}
	.card {
		padding: 18px 20px;
		border: 1px dashed var(--border);
		border-radius: 8px;
		background: var(--card-bg);
		color: var(--fg-muted);
	}
	.card p {
		margin: 0 0 6px;
	}
	.hint {
		font-size: 12px;
	}
</style>
