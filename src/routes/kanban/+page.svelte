<script lang="ts">
	/**
	 * KANBAN wallboard — read-only minimal view of the Trello boards
	 * configured server-side. One card per board, one row per lane
	 * (lane name + open card count).
	 *
	 * The list is fetched via `kanbansStore` which polls every 30s and
	 * pauses when the tab is hidden. The backend caches Trello responses
	 * for 60s so we never bombard the upstream API regardless of how
	 * many tabs are open.
	 *
	 * Per-board errors (the server emits `{error: "..."}` for boards it
	 * couldn't fetch) render inline in the same card so a single bad
	 * board doesn't break the whole wallboard.
	 */
	import { onDestroy, onMount } from 'svelte';
	import { kanbansStore, startKanbansPolling, refreshKanbans } from '$lib/stores/kanbans';
	import { pauseKanban, resumeKanban } from '$lib/api/client';
	import Skeleton from '$lib/components/Skeleton.svelte';

	let pauseLoading: Record<string, boolean> = {};

	async function togglePause(boardId: string, currentlyPaused: boolean) {
		pauseLoading = { ...pauseLoading, [boardId]: true };
		try {
			if (currentlyPaused) {
				await resumeKanban(boardId);
			} else {
				await pauseKanban(boardId);
			}
			await refreshKanbans();
		} finally {
			pauseLoading = { ...pauseLoading, [boardId]: false };
		}
	}

	let releasePolling: (() => void) | null = null;

	onMount(() => {
		releasePolling = startKanbansPolling();
	});

	onDestroy(() => {
		if (releasePolling) releasePolling();
		releasePolling = null;
	});

	function totalCards(lanes: ReadonlyArray<{ count: number }>): number {
		return lanes.reduce((sum, l) => sum + l.count, 0);
	}

	function totalInProgress(lanes: ReadonlyArray<{ in_progress?: number }>): number {
		return lanes.reduce((sum, l) => sum + (l.in_progress ?? 0), 0);
	}

	type States = { running: number; await: number; ready: number; idle: number };
	const STATE_ORDER: ReadonlyArray<keyof States> = ['running', 'await', 'ready', 'idle'];
	const STATE_TITLE: Record<keyof States, string> = {
		running: 'agent al lavoro',
		await: 'aspetta intervento umano',
		ready: 'in coda per il consumer',
		idle: 'parking / terminale'
	};

	function fmtLastFetch(ts: number | null): string {
		if (!ts) return '';
		const secs = Math.round((Date.now() - ts) / 1000);
		if (secs < 5) return 'updated just now';
		if (secs < 60) return `updated ${secs}s ago`;
		const mins = Math.round(secs / 60);
		return `updated ${mins}m ago`;
	}

	$: state = $kanbansStore;
	$: kanbans = state.data ?? [];
</script>

<svelte:head>
	<title>Kanban — Clodia</title>
</svelte:head>

<main class="wrap">
	<header class="head">
		<div>
			<h1>Kanban</h1>
			<p class="hint">
				Wallboard di sola lettura delle Trello board configurate. Click sul titolo per
				aprire la board su Trello.
			</p>
		</div>
		<div class="head-meta">
			{#if state.loading && !state.data}
				<span class="spinner" aria-label="loading"></span>
			{:else if state.lastFetchTs}
				<span class="last-fetch">{fmtLastFetch(state.lastFetchTs)}</span>
			{/if}
			<button class="refresh" type="button" on:click={() => refreshKanbans()} disabled={state.loading}>
				Refresh
			</button>
		</div>
	</header>

	{#if state.error && !state.data}
		<div class="status error">
			<strong>Errore di caricamento</strong>
			<div class="error-msg">{state.error}</div>
			<button class="retry" type="button" on:click={() => refreshKanbans()}>Retry</button>
		</div>
	{:else if !state.data}
		<div class="grid">
			{#each Array(2) as _}
				<div class="card">
					<Skeleton height="20px" width="60%" />
					<div class="lanes">
						{#each Array(4) as _}
							<div class="row-skel"><Skeleton height="14px" /></div>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	{:else if kanbans.length === 0}
		<div class="status empty">
			<strong>Nessuna board configurata.</strong>
			<p class="hint">
				Aggiungere voci a <code>kanbans.boards</code> in
				<code>tools/system/agent-server/config.yaml</code> e riavviare il server.
			</p>
		</div>
	{:else}
		<div class="grid">
			{#each kanbans as kb (kb.id)}
				<article class="card" class:errored={!!kb.error}>
					<header class="card-head">
						<a
							class="card-title"
							href={'/kanban/' + encodeURIComponent(kb.id)}
							title="Apri vista board"
						>
							{kb.name ?? kb.id}
						</a>
						{#if !kb.error}
							<span class="total" title="card aperte totali">{totalCards(kb.lanes)}</span>
							{#if kb.states}
								<span class="state-breakdown">
									{#each STATE_ORDER as st}
										{#if kb.states[st] > 0}
											<span class="sb sb-{st}" title="{kb.states[st]} {STATE_TITLE[st]}">
												<span class="sb-dot"></span>{kb.states[st]}
											</span>
										{/if}
									{/each}
								</span>
							{/if}
							<button
								class="pause-btn"
								class:paused={!!kb.paused}
								disabled={!!pauseLoading[kb.id]}
								title={kb.paused ? "Pipeline in pausa — clicca per riprendere" : "Metti in pausa la pipeline"}
								on:click|stopPropagation={() => togglePause(kb.id, !!kb.paused)}
							>
								{#if pauseLoading[kb.id]}<span class="spinner" aria-label="loading"></span>{:else if kb.paused}▶{:else}⏸{/if}
							</button>
							{#if kb.url}
								<a
									class="ext"
									href={kb.url}
									target="_blank"
									rel="noopener noreferrer"
									title="Apri su Trello"
									aria-label="Apri su Trello"
								>↗</a>
							{/if}
						{/if}
					</header>

					{#if kb.error}
						<div class="card-error">
							<strong>Impossibile leggere la board.</strong>
							<div class="error-msg">{kb.error}</div>
						</div>
					{:else if kb.lanes.length === 0}
						<p class="empty-lanes">Nessuna lane aperta.</p>
					{:else}
						<ul class="lanes">
							{#each kb.lanes as lane (lane.name)}
								<li class="lane">
									<span class="lane-name">{lane.name}</span>
									{#if lane.skill && lane.skill.trim().toLowerCase() !== lane.name.trim().toLowerCase()}
										<span
											class="lane-skill"
											title="Skill richiesta per questa lane"
											>/{lane.skill}</span
										>
									{/if}
									<span class="lane-count" class:zero={lane.count === 0}>
										{lane.count}
									</span>
									{#if lane.states && lane.count > 0}
										<span class="state-breakdown small">
											{#each STATE_ORDER as st}
												{#if lane.states[st] > 0}
													<span class="sb sb-{st}" title="{lane.states[st]} {STATE_TITLE[st]}">
														<span class="sb-dot"></span>{lane.states[st]}
													</span>
												{/if}
											{/each}
										</span>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</article>
			{/each}
		</div>
	{/if}
</main>

<style>
	.wrap {
		padding: 24px 28px;
		max-width: 1200px;
		margin: 0 auto;
	}

	.head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 24px;
		margin-bottom: 24px;
	}

	h1 {
		margin: 0 0 4px 0;
		font-size: 22px;
		font-weight: 600;
	}

	.hint {
		margin: 0;
		color: var(--fg-muted);
		font-size: 13px;
		max-width: 540px;
	}

	.head-meta {
		display: flex;
		align-items: center;
		gap: 12px;
		font-size: 12px;
		color: var(--fg-muted);
		white-space: nowrap;
	}

	.refresh {
		padding: 6px 14px;
		font-size: 12px;
		background: transparent;
		color: var(--fg);
		border: 1px solid var(--border);
		border-radius: 6px;
		cursor: pointer;
	}
	.refresh:hover:not(:disabled) {
		border-color: var(--fg-muted);
	}
	.refresh:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
		gap: 18px;
	}

	.card {
		background: var(--card-bg);
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 16px 18px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.card.errored {
		border-color: rgba(232, 93, 117, 0.4);
	}

	.card-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 12px;
		padding-bottom: 10px;
		border-bottom: 1px solid var(--border);
	}

	.card-title {
		font-size: 15px;
		font-weight: 600;
		color: var(--fg);
		text-decoration: none;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex: 1;
		min-width: 0;
	}
	.card-title:hover {
		color: var(--accent);
	}
	.card-title.muted {
		color: var(--fg-muted);
	}

	.total {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 28px;
		height: 22px;
		padding: 0 8px;
		font-size: 12px;
		font-weight: 600;
		font-family: var(--mono);
		color: var(--fg-muted);
		background: rgba(255, 255, 255, 0.04);
		border-radius: 11px;
	}

	.lanes {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.lane {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		padding: 6px 4px;
		font-size: 13px;
	}

	.lane-name {
		color: var(--fg);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex: 1;
		min-width: 0;
	}

	.lane-count {
		font-family: var(--mono);
		font-size: 12px;
		color: var(--fg);
		min-width: 28px;
		text-align: right;
	}
	.lane-count.zero {
		color: var(--fg-muted);
		opacity: 0.55;
	}

	.lane-skill {
		font-family: var(--mono);
		font-size: 11px;
		color: var(--accent);
		background: rgba(255, 107, 61, 0.1);
		padding: 1px 7px;
		border-radius: 4px;
		white-space: nowrap;
		flex-shrink: 0;
	}

	@keyframes pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.4; }
	}

	.state-breakdown {
		display: inline-flex;
		gap: 6px;
		align-items: center;
		flex-wrap: wrap;
		flex-shrink: 0;
		font-family: var(--mono);
		font-size: 11px;
		color: var(--fg-muted);
	}
	.state-breakdown.small { font-size: 10px; gap: 4px; }
	.sb {
		display: inline-flex;
		align-items: center;
		gap: 2px;
	}
	.sb-dot {
		display: inline-block;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.sb-running .sb-dot { background: #4ade80; animation: pulse 1.8s ease-in-out infinite; }
	.sb-await .sb-dot   { background: #f59e0b; }
	.sb-ready .sb-dot   { background: #60a5fa; }
	.sb-idle .sb-dot    { background: transparent; border: 1px solid var(--border); }

	.ext {
		font-size: 13px;
		color: var(--fg-muted);
		text-decoration: none;
		flex-shrink: 0;
		padding: 0 4px;
	}
	.ext:hover {
		color: var(--accent);
	}

	.pause-btn {
		background: transparent;
		border: 1px solid var(--border);
		border-radius: 5px;
		color: var(--fg-muted);
		cursor: pointer;
		font-size: 12px;
		padding: 2px 7px;
		flex-shrink: 0;
		transition: border-color 0.15s, color 0.15s;
	}
	.pause-btn:hover:not(:disabled) {
		border-color: var(--fg-muted);
		color: var(--fg);
	}
	.pause-btn.paused {
		border-color: #f59e0b;
		color: #f59e0b;
	}
	.pause-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.empty-lanes {
		margin: 0;
		font-size: 13px;
		color: var(--fg-muted);
		font-style: italic;
	}

	.card-error {
		font-size: 12px;
		color: var(--danger);
	}

	.status {
		padding: 18px 20px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--card-bg);
	}
	.status.error {
		border-color: rgba(232, 93, 117, 0.6);
		background: rgba(232, 93, 117, 0.08);
	}
	.status.empty {
		border-style: dashed;
		text-align: center;
		padding: 40px 24px;
		display: flex;
		flex-direction: column;
		gap: 10px;
		align-items: center;
	}
	.status.empty code {
		font-family: var(--mono);
		font-size: 12px;
		color: var(--fg);
		background: rgba(255, 255, 255, 0.05);
		padding: 1px 6px;
		border-radius: 4px;
	}
	.error-msg {
		margin: 8px 0;
		font-family: var(--mono);
		font-size: 12px;
		color: var(--danger);
		white-space: pre-wrap;
		word-break: break-word;
	}
	.retry {
		margin-top: 8px;
		padding: 6px 14px;
		font-size: 12px;
		background: transparent;
		color: var(--fg);
		border: 1px solid var(--border);
		border-radius: 6px;
		cursor: pointer;
	}

	.row-skel {
		padding: 6px 0;
	}

	.spinner {
		width: 11px;
		height: 11px;
		border-radius: 50%;
		border: 2px solid currentColor;
		border-right-color: transparent;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.last-fetch {
		font-size: 11px;
		opacity: 0.7;
	}
</style>
