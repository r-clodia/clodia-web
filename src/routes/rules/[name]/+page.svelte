<script lang="ts">
	import { page } from '$app/stores';
	import { ApiError, getRule } from '$lib/api/client';
	import type { RuleDetail } from '$lib/api/types';
	import CatalogPackBadge from '$lib/components/CatalogPackBadge.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { renderMarkdown } from '$lib/markdown';

	type State =
		| { kind: 'idle' }
		| { kind: 'loading' }
		| { kind: 'ok'; item: RuleDetail }
		| { kind: 'error'; message: string; status?: number };

	let state: State = { kind: 'idle' };
	let loadedName = '';
	$: name = $page.params.name ?? '';

	function errorMessage(err: unknown): { message: string; status?: number } {
		if (err instanceof ApiError) return { message: err.message, status: err.status };
		if (err instanceof Error) return { message: err.message };
		return { message: String(err) };
	}

	async function load(n: string) {
		if (!n) return;
		state = { kind: 'loading' };
		try {
			state = { kind: 'ok', item: await getRule(n) };
		} catch (err) {
			state = { kind: 'error', ...errorMessage(err) };
		}
	}

	$: if (name && name !== loadedName) {
		loadedName = name;
		void load(name);
	}
</script>

<header class="head">
	<div>
		<a class="back" href="/rules">← Rules</a>
		<div class="title-row">
			<h1>{state.kind === 'ok' ? state.item.name : name}</h1>
			{#if state.kind === 'ok'}
				<CatalogPackBadge pack={state.item.pack} />
			{/if}
		</div>
		{#if state.kind === 'ok'}
			<p class="hint">{state.item.description || 'No description'}</p>
		{/if}
	</div>
	<button type="button" on:click={() => load(name)} disabled={state.kind === 'loading'}>
		{state.kind === 'loading' ? 'Loading…' : 'Reload'}
	</button>
</header>

{#if state.kind === 'loading' || state.kind === 'idle'}
	<section class="panel">
		<div class="skels">
			<Skeleton width="45%" height="18px" />
			<Skeleton width="80%" height="12px" />
			<Skeleton width="70%" height="12px" />
			<Skeleton width="90%" height="220px" />
		</div>
	</section>
{:else if state.kind === 'error'}
	<section class="status error">
		<strong>{state.status === 404 ? 'Rule not found.' : `Failed to load rule${state.status ? ` (HTTP ${state.status})` : ''}.`}</strong>
		<div class="error-msg">{state.message}</div>
		<button class="retry" type="button" on:click={() => load(name)}>Retry</button>
	</section>
{:else}
	<section class="meta panel">
		<dl>
			<dt>Path</dt>
			<dd><code>{state.item.path}</code></dd>
			<dt>Pack</dt>
			<dd><CatalogPackBadge pack={state.item.pack} compact /></dd>
			<dt>Available packs</dt>
			<dd>{state.item.available_packs.join(', ')}</dd>
			<dt>Source</dt>
			<dd>{state.item.source} ({state.item.available_in.join(', ')})</dd>
			<dt>Variants</dt>
			<dd>
				<div class="variants">
					{#each state.item.variants as variant}
						<div class="variant">
							<CatalogPackBadge pack={variant.pack} compact />
							<span>{variant.origin}</span>
							{#if variant.active}<strong>active</strong>{/if}
							<code>{variant.path}</code>
						</div>
					{/each}
				</div>
			</dd>
			<dt>Frontmatter</dt>
			<dd><pre>{JSON.stringify(state.item.frontmatter, null, 2)}</pre></dd>
		</dl>
	</section>

	<section class="panel markdown-panel">
		<div class="md">{@html renderMarkdown(state.item.body)}</div>
	</section>
{/if}

<style>
	.head {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 16px;
		margin-bottom: 18px;
		flex-wrap: wrap;
	}
	.back {
		display: inline-block;
		margin-bottom: 10px;
		font-size: 12px;
		color: var(--fg-muted);
	}
	.title-row {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}
	h1 {
		margin: 0;
	}
	.hint {
		margin: 5px 0 0;
		color: var(--fg-muted);
		font-size: 13px;
	}
	.panel {
		background: var(--card-bg);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 18px 20px;
		margin-bottom: 14px;
		min-width: 0;
	}
	.meta dl {
		display: grid;
		grid-template-columns: 130px 1fr;
		gap: 10px 18px;
		margin: 0;
	}
	.meta dt {
		color: var(--fg-muted);
		text-transform: uppercase;
		letter-spacing: 0.07em;
		font-size: 11px;
	}
	.meta dd {
		margin: 0;
		font-size: 12.5px;
		min-width: 0;
	}
	code {
		font-family: var(--mono);
		word-break: break-all;
	}
	pre {
		margin: 0;
		white-space: pre-wrap;
		font-family: var(--mono);
		font-size: 12px;
		color: var(--fg-muted);
	}
	.variants {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.variant {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
		color: var(--fg-muted);
	}
	.variant strong {
		color: var(--accent);
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.skels {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.status {
		padding: 16px 18px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--card-bg);
	}
	.status.error {
		border-color: rgba(232, 93, 117, 0.6);
		background: rgba(232, 93, 117, 0.08);
	}
	.error-msg {
		margin-top: 8px;
		font-family: var(--mono);
		font-size: 12px;
		color: var(--danger);
		white-space: pre-wrap;
		word-break: break-word;
	}
	.retry {
		margin-top: 12px;
	}
	.md {
		font-size: 13.5px;
		line-height: 1.6;
		word-wrap: break-word;
	}
	.md :global(h1),
	.md :global(h2),
	.md :global(h3),
	.md :global(h4),
	.md :global(h5),
	.md :global(h6) {
		margin: 1.4em 0 0.5em;
		line-height: 1.25;
	}
	.md :global(h1:first-child),
	.md :global(h2:first-child),
	.md :global(h3:first-child) {
		margin-top: 0;
	}
	.md :global(h1) {
		font-size: 1.5em;
	}
	.md :global(h2) {
		font-size: 1.25em;
		border-bottom: 1px solid var(--border);
		padding-bottom: 4px;
	}
	.md :global(p) {
		margin: 0.5em 0 0.9em;
	}
	.md :global(ul),
	.md :global(ol) {
		margin: 0.4em 0 0.9em;
		padding-left: 1.4em;
	}
	.md :global(blockquote) {
		border-left: 3px solid var(--accent);
		padding: 6px 12px;
		margin: 0.8em 0;
		color: var(--fg-muted);
		background: rgba(255, 107, 61, 0.04);
	}
	.md :global(code) {
		background: rgba(255, 255, 255, 0.05);
		padding: 1px 5px;
		border-radius: 3px;
		font-size: 0.9em;
	}
	.md :global(pre),
	.md :global(.md-pre) {
		background: rgba(0, 0, 0, 0.3);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 12px 14px;
		overflow: auto;
		font-size: 12px;
		line-height: 1.5;
		font-family: var(--mono);
		white-space: pre;
	}
	.md :global(pre code) {
		background: transparent;
		padding: 0;
		font-size: inherit;
	}
	.md :global(a) {
		color: #6fb6ff;
	}
</style>
