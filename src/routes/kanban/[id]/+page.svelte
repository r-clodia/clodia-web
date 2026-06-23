<script lang="ts">
	/**
	 * KANBAN board detail — readonly drilldown su una singola Trello board.
	 * Una card per ogni lane (ordinate per `pos` Trello), elenco completo
	 * dei task; pallino verde sui task in lavorazione (idMembers != []).
	 *
	 * Fetch lato client con polling 30s (riusa stesso pattern di /kanban).
	 * Trello resta source of truth: nessuna mutazione possibile da qui.
	 */
	import { onDestroy, onMount } from 'svelte';
	import { page } from '$app/stores';
	import { getColonyApprovals, getColonyExecutions, getKanbanDetail } from '$lib/api/client';
	import type { ColonyApproval, ColonyExecution, KanbanDetail } from '$lib/api/types';
	import AgentAvatar from '$lib/components/AgentAvatar.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';

	const POLL_MS = 30_000;
	const COLONY_POLL_MS = 20_000;

	let data: KanbanDetail | null = null;
	let loading = true;
	let error: string | null = null;
	let pollTimer: ReturnType<typeof setInterval> | null = null;
	let colonyTimer: ReturnType<typeof setInterval> | null = null;

	let executions: ReadonlyArray<ColonyExecution> = [];
	let approvals: ReadonlyArray<ColonyApproval> = [];

	$: boardId = $page.params.id;

	async function refresh() {
		if (!boardId) return;
		try {
			data = await getKanbanDetail(boardId);
			error = null;
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	async function refreshColony() {
		// Fetch indipendenti: se uno dei due endpoint non è disponibile
		// (server più vecchio) degradiamo in silenzio mantenendo l'ultimo dato.
		const [exRes, apRes] = await Promise.allSettled([
			getColonyExecutions(100),
			getColonyApprovals('pending')
		]);
		if (exRes.status === 'fulfilled') executions = exRes.value;
		if (apRes.status === 'fulfilled') approvals = apRes.value;
	}

	onMount(() => {
		refresh();
		refreshColony();
		pollTimer = setInterval(refresh, POLL_MS);
		colonyTimer = setInterval(refreshColony, COLONY_POLL_MS);
	});

	onDestroy(() => {
		if (pollTimer) clearInterval(pollTimer);
		pollTimer = null;
		if (colonyTimer) clearInterval(colonyTimer);
		colonyTimer = null;
	});

	// -------------------------------------------------------------------
	// Pallino colony per card: VERDE = ultima execution CLAIMED/RUNNING,
	// GIALLO = approval pending, ROSSO = ultima execution ESCALATED /
	// FAILED / STALE, BLU = idle / nessuna execution.
	// -------------------------------------------------------------------

	interface ColonyDot {
		color: string;
		label: string;
	}

	const COLONY_GREEN = '#10b981';
	const COLONY_YELLOW = '#f59e0b';
	const COLONY_RED = '#ef4444';
	const COLONY_BLUE = '#3b82f6';

	/** Ultima execution per card_id (le execution arrivano newest-first,
	 *  ma ordiniamo difensivamente per started_at). */
	function latestExecutionByCard(
		execs: ReadonlyArray<ColonyExecution>
	): Map<string, ColonyExecution> {
		const sorted = [...execs].sort((a, b) =>
			(a.started_at ?? '').localeCompare(b.started_at ?? '')
		);
		const map = new Map<string, ColonyExecution>();
		for (const ex of sorted) {
			if (ex.card_id) map.set(ex.card_id, ex); // l'ultima (più recente) vince
		}
		return map;
	}

	function colonyDotFor(
		cardId: string,
		latest: Map<string, ColonyExecution>,
		pendingCards: ReadonlySet<string>
	): ColonyDot {
		const ex = latest.get(cardId);
		const st = ex?.status?.toUpperCase() ?? '';
		if (st === 'CLAIMED' || st === 'RUNNING') {
			return { color: COLONY_GREEN, label: `${st} — agent ${ex?.agent ?? '?'}` };
		}
		if (pendingCards.has(cardId)) {
			return { color: COLONY_YELLOW, label: 'Approval pending — aspetta approvazione' };
		}
		if (st === 'ESCALATED' || st === 'FAILED' || st === 'STALE') {
			return { color: COLONY_RED, label: `${st} — agent ${ex?.agent ?? '?'}` };
		}
		if (ex) {
			return { color: COLONY_BLUE, label: `${st || 'idle'} — agent ${ex.agent ?? '?'}` };
		}
		return { color: COLONY_BLUE, label: 'Idle — nessuna execution' };
	}

	$: latestExec = latestExecutionByCard(executions);
	$: pendingApprovalCards = new Set(approvals.map((a) => a.card_id));

	function fmtDate(iso: string | null): string {
		if (!iso) return '';
		try {
			const d = new Date(iso);
			const now = Date.now();
			const mins = Math.round((now - d.getTime()) / 60000);
			if (mins < 1) return 'now';
			if (mins < 60) return `${mins}m`;
			const hrs = Math.round(mins / 60);
			if (hrs < 24) return `${hrs}h`;
			const days = Math.round(hrs / 24);
			return `${days}d`;
		} catch {
			return '';
		}
	}
</script>

<svelte:head>
	<title>{data?.name ?? 'Board'} — Kanban — Clodia</title>
</svelte:head>

<main class="wrap">
	<header class="head">
		<div>
			<nav class="crumbs">
				<a href="/kanban">← Kanban</a>
			</nav>
			<h1>{data?.name ?? boardId}</h1>
			{#if data?.url}
				<a class="ext" href={data.url} target="_blank" rel="noopener noreferrer">
					Apri su Trello ↗
				</a>
			{/if}
		</div>
		<button class="refresh" type="button" on:click={refresh} disabled={loading}>
			Refresh
		</button>
	</header>

	{#if error && !data}
		<div class="status error">
			<strong>Errore di caricamento</strong>
			<div class="error-msg">{error}</div>
			<button class="retry" type="button" on:click={refresh}>Retry</button>
		</div>
	{:else if !data}
		<div class="grid">
			{#each Array(4) as _}
				<div class="lane-card">
					<Skeleton height="18px" width="50%" />
					<div class="cards">
						{#each Array(3) as _}
							<Skeleton height="32px" />
						{/each}
					</div>
				</div>
			{/each}
		</div>
	{:else if data.lanes.length === 0}
		<div class="status empty">
			<strong>Nessuna lane.</strong>
		</div>
	{:else}
		<div class="grid">
			{#each data.lanes as lane (lane.id)}
				<article
					class="lane-card"
					class:notify={lane.is_notify}
					class:has-progress={(lane.in_progress ?? 0) > 0}
				>
					<header class="lane-head">
						<div class="lane-title">
							<span class="lane-name">{lane.name}</span>
							{#if lane.skill && lane.skill.trim().toLowerCase() !== lane.name.trim().toLowerCase()}
								<span class="lane-skill" title="Skill richiesta">/{lane.skill}</span>
							{:else if !lane.skill && lane.is_notify}
								<span class="lane-tag human" title="Lane umana — Telegram a owner quando arrivano card">👤 umana</span>
							{/if}
						</div>
						<span class="lane-count" class:zero={lane.count === 0}>
							{lane.count}{#if (lane.in_progress ?? 0) > 0}<span class="lane-prog-count">({lane.in_progress})</span>{/if}
						</span>
					</header>

					{#if lane.cards.length === 0}
						<p class="empty-lane">—</p>
					{:else}
						<ul class="cards">
							{#each lane.cards as card (card.id)}
								{@const st = card.state ?? (card.in_progress ? 'running' : 'idle')}
								{@const stLabel = {
									running: 'Agent al lavoro',
									await: 'Aspetta intervento umano',
									ready: 'In coda, il consumer la prenderà',
									idle: 'Parcheggiata / terminale'
								}[st]}
								{@const colony = colonyDotFor(card.id, latestExec, pendingApprovalCards)}
								<li class="card-row" class:in-progress={st === 'running'}>
									<span class="dot dot-{st}" title={stLabel} aria-label={stLabel}></span>
									{#if card.url}
										<a class="card-link" href={card.url} target="_blank" rel="noopener noreferrer">
											{card.name}
										</a>
									{:else}
										<span class="card-link">{card.name}</span>
									{/if}
									{#if st === 'running' && card.agent}
										<span class="card-agent" title="Agent al lavoro su questa card">
											<AgentAvatar
												name={card.agent.name}
												displayName={card.agent.display_name}
												size={32}
											/>
											<span class="card-agent-name">{card.agent.display_name}</span>
										</span>
									{/if}
									{#if card.dateLastActivity}
										<span class="card-time" title={card.dateLastActivity}>
											{fmtDate(card.dateLastActivity)}
										</span>
									{/if}
									<span
										class="colony-dot"
										style="background: {colony.color}"
										title={colony.label}
										aria-label={colony.label}
									></span>
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
		max-width: 1400px;
		margin: 0 auto;
	}

	.head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 24px;
		margin-bottom: 24px;
	}

	.crumbs {
		font-size: 12px;
		margin-bottom: 4px;
	}
	.crumbs a {
		color: var(--fg-muted);
		text-decoration: none;
	}
	.crumbs a:hover {
		color: var(--accent);
	}

	h1 {
		margin: 0 0 6px 0;
		font-size: 22px;
		font-weight: 600;
	}

	.ext {
		font-size: 12px;
		color: var(--fg-muted);
		text-decoration: none;
	}
	.ext:hover {
		color: var(--accent);
	}

	.refresh {
		padding: 6px 14px;
		font-size: 12px;
		background: transparent;
		color: var(--fg);
		border: 1px solid var(--border);
		border-radius: 6px;
		cursor: pointer;
		white-space: nowrap;
	}
	.refresh:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 16px;
	}

	.lane-card {
		background: var(--card-bg);
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 14px 14px 12px;
		display: flex;
		flex-direction: column;
		gap: 10px;
		min-height: 80px;
	}

	.lane-card.notify {
		border-style: dashed;
		border-color: rgba(255, 107, 61, 0.35);
	}

	.lane-card.has-progress {
		box-shadow: inset 3px 0 0 #4ade80;
	}

	.lane-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 8px;
		padding-bottom: 8px;
		border-bottom: 1px solid var(--border);
	}

	.lane-title {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
		flex: 1;
	}

	.lane-name {
		font-size: 13px;
		font-weight: 600;
		color: var(--fg);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.lane-skill {
		font-family: var(--mono);
		font-size: 10px;
		color: var(--accent);
		background: rgba(255, 107, 61, 0.1);
		padding: 1px 6px;
		border-radius: 3px;
		align-self: flex-start;
	}

	.lane-tag.human {
		font-size: 10px;
		color: var(--fg-muted);
		align-self: flex-start;
	}

	.lane-count {
		font-family: var(--mono);
		font-size: 12px;
		color: var(--fg);
		flex-shrink: 0;
	}
	.lane-count.zero {
		color: var(--fg-muted);
		opacity: 0.5;
	}

	.lane-prog-count {
		color: #4ade80;
		margin-left: 2px;
	}

	.cards {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 5px;
	}

	.card-row {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 4px 2px;
		font-size: 12.5px;
		min-width: 0;
	}

	.dot {
		display: inline-block;
		width: 9px;
		height: 9px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.dot-running {
		background: #4ade80;            /* verde — agent al lavoro */
		animation: pulse 1.8s ease-in-out infinite;
	}
	.dot-await {
		background: #f59e0b;            /* giallo — aspetta umano */
	}
	.dot-ready {
		background: #60a5fa;            /* blu — in coda per claim */
	}
	.dot-idle {
		background: transparent;
		border: 1px solid var(--border); /* grigio vuoto — parking */
	}
	@keyframes pulse {
		0%, 100% { opacity: 1; transform: scale(1); }
		50% { opacity: 0.5; transform: scale(0.85); }
	}

	.card-link {
		color: var(--fg);
		text-decoration: none;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex: 1;
		min-width: 0;
	}
	.card-link:hover {
		color: var(--accent);
	}

	.card-time {
		font-family: var(--mono);
		font-size: 10px;
		color: var(--fg-muted);
		flex-shrink: 0;
	}

	/* Pallino colony — angolo destro della card, discreto ma visibile. */
	.colony-dot {
		display: inline-block;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		flex-shrink: 0;
		margin-left: auto;
		opacity: 0.9;
	}

	.card-agent {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;
		font-size: 11px;
		color: var(--fg-muted);
	}

	.card-agent-name {
		font-family: var(--mono);
	}

	.empty-lane {
		margin: 0;
		font-size: 12px;
		color: var(--fg-muted);
		font-style: italic;
		text-align: center;
		padding: 4px 0;
	}

	.status {
		padding: 18px 20px;
		border: 1px solid var(--border);
		border-radius: 8px;
	}
	.status.error {
		border-color: rgba(232, 93, 117, 0.6);
		background: rgba(232, 93, 117, 0.08);
	}
	.status.empty {
		border-style: dashed;
		text-align: center;
		padding: 40px 24px;
	}
	.error-msg {
		margin: 8px 0;
		font-family: var(--mono);
		font-size: 12px;
		color: var(--danger);
		white-space: pre-wrap;
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
</style>
