<script lang="ts">
	/**
	 * «Meta» popup of a topic (clodia-platform#658).
	 *
	 * The data comes from a PLAIN READ route (`GET /api/topics/{tier}/{name}`):
	 * no agent, no model call — instant, no tokens, nothing sent to an
	 * inference provider. The next deadline is its own highlighted field: it is
	 * DERIVED from the to-do list (earliest due among open items), so it has no
	 * editor — the to-do list is the editor.
	 *
	 * Every to-do write carries the list's `todos_version`. On a 409 someone
	 * else changed the list meanwhile: we reload and say so, we never retry
	 * the write on top of a list the person has not seen.
	 */
	import { createEventDispatcher } from 'svelte';
	import Modal from './Modal.svelte';
	import {
		ApiError,
		apiErrorDetail,
		getTopicMeta,
		addTopicTodo,
		updateTopicTodo,
		removeTopicTodo
	} from '$lib/api/client';
	import type { TopicMetaView, TopicTodo, TopicTodoWrite } from '$lib/api/types';
	import { toastError, toastInfo } from '$lib/stores/toasts';

	export let open = false;
	export let tier: string;
	export let name: string;
	/** Whether the viewer may edit the list (a participant). The server
	 *  decides anyway; this only avoids showing controls that would 403. */
	export let canEdit = true;

	const dispatch = createEventDispatcher<{
		close: void;
		changed: { deadline: string | null; todos: ReadonlyArray<TopicTodo>; todos_open: number };
	}>();

	let view: TopicMetaView | null = null;
	let loading = false;
	let loadErr = '';
	let busy = false;
	let loadedFor = '';

	// New item form
	let newText = '';
	let newDue = '';
	let newAssignee = '';

	// Inline edit
	let editId: string | null = null;
	let editText = '';
	let editDue = '';
	let editAssignee = '';

	$: key = `${tier}/${name}`;
	$: if (open && loadedFor !== key) void load();
	$: if (!open) loadedFor = '';

	async function load() {
		loadedFor = key;
		loading = true;
		loadErr = '';
		try {
			view = await getTopicMeta(tier, name);
		} catch (e) {
			loadErr = apiErrorDetail(e);
			view = null;
		} finally {
			loading = false;
		}
	}

	function todayIso(): string {
		const d = new Date();
		const p = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
	}

	function isOverdue(t: TopicTodo): boolean {
		return t.status === 'open' && !!t.due && t.due < todayIso();
	}

	/** Open first (by due, undated last), then done. */
	function sorted(todos: ReadonlyArray<TopicTodo>): TopicTodo[] {
		const rank = (t: TopicTodo) => (t.status === 'open' ? 0 : 1);
		return [...todos].sort((a, b) => {
			if (rank(a) !== rank(b)) return rank(a) - rank(b);
			const da = a.due || '9999-99-99';
			const db = b.due || '9999-99-99';
			return da < db ? -1 : da > db ? 1 : 0;
		});
	}

	function fmtDate(iso?: string | null): string {
		if (!iso) return '—';
		const d = new Date(iso + 'T00:00:00');
		if (Number.isNaN(d.getTime())) return iso;
		return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' });
	}

	function participantsOf(v: TopicMetaView): string[] {
		const p = v.meta.participants;
		if (Array.isArray(p)) return p;
		if (p && typeof p === 'object') return Object.keys(p);
		return [];
	}

	function foldersOf(v: TopicMetaView): string[] {
		const out: string[] = [];
		for (const f of v.meta.drive_folders ?? []) out.push(`Drive: ${f.name || f.folder || f.id || '?'}`);
		for (const f of v.meta.local_folders ?? []) out.push(`Cartella condivisa: ${f.name}`);
		for (const l of v.links ?? []) out.push(`Topic collegato: ${l.name || l.topic || '?'}`);
		return out;
	}

	function apply(r: TopicTodoWrite) {
		if (!view) return;
		view = { ...view, todos: r.todos, deadline: r.deadline, todos_version: r.todos_version,
			meta: { ...view.meta, todos: r.todos, deadline: r.deadline } };
		dispatch('changed', {
			deadline: r.deadline,
			todos: r.todos,
			todos_open: r.todos.filter((t) => t.status === 'open').length
		});
	}

	async function write(fn: (version: string) => Promise<TopicTodoWrite>): Promise<boolean> {
		if (!view || busy) return false;
		busy = true;
		try {
			apply(await fn(view.todos_version ?? ''));
			return true;
		} catch (e) {
			if (e instanceof ApiError && e.status === 409) {
				toastInfo('La lista to-do è cambiata nel frattempo', 'Ricaricata: controlla e riprova.');
				await load();
			} else {
				toastError('To-do non aggiornato', apiErrorDetail(e));
			}
			return false;
		} finally {
			busy = false;
		}
	}

	async function add() {
		const text = newText.trim();
		if (!text) return;
		const ok = await write((v) =>
			addTopicTodo(tier, name, { text, due: newDue || null, assignee: newAssignee.trim() || null }, v)
		);
		if (ok) {
			newText = '';
			newDue = '';
			newAssignee = '';
		}
	}

	function toggle(t: TopicTodo) {
		void write((v) => updateTopicTodo(tier, name, t.id, { status: t.status === 'open' ? 'done' : 'open' }, v));
	}

	function startEdit(t: TopicTodo) {
		editId = t.id;
		editText = t.text;
		editDue = t.due ?? '';
		editAssignee = t.assignee ?? '';
	}

	async function saveEdit(t: TopicTodo) {
		const text = editText.trim();
		if (!text) return;
		const ok = await write((v) =>
			updateTopicTodo(tier, name, t.id, { text, due: editDue || null, assignee: editAssignee.trim() || null }, v)
		);
		if (ok) editId = null;
	}

	function remove(t: TopicTodo) {
		void write((v) => removeTopicTodo(tier, name, t.id, v));
	}

	function close() {
		editId = null;
		dispatch('close');
	}

	$: openCount = view ? view.todos.filter((t) => t.status === 'open').length : 0;
	$: deadlineOverdue = !!view?.deadline && view.deadline < todayIso();
</script>

<Modal {open} maxWidth={640} on:close={close}>
	<h2 slot="title">Meta · {view?.meta?.title || name}</h2>

	{#if loading && !view}
		<p class="muted">Caricamento…</p>
	{:else if loadErr}
		<p class="err">{loadErr}</p>
	{:else if view}
		<div class="deadline-box" class:overdue={deadlineOverdue} class:none={!view.deadline}>
			<span class="dl-label">Prossima scadenza</span>
			<span class="dl-value">{view.deadline ? fmtDate(view.deadline) : 'nessuna'}</span>
			<span class="dl-hint">derivata dalla lista to-do (la data più vicina fra le voci aperte)</span>
		</div>

		<dl class="fields">
			<dt>Titolo</dt><dd>{view.meta.title || view.name}</dd>
			<dt>Livello</dt><dd>{view.tier}{view.tier_name ? ` · ${view.tier_name}` : ''}</dd>
			<dt>Stato</dt><dd>{view.meta.status || 'active'}</dd>
			<dt>Owner</dt><dd>{view.meta.owner || '—'}</dd>
			<dt>Partecipanti</dt><dd>{participantsOf(view).join(', ') || '—'}</dd>
			<dt>Agente di contatto</dt><dd>{view.meta.contact_agent || 'clodia'}</dd>
			<dt>Tag</dt><dd>{(view.meta.tags ?? []).join(', ') || '—'}</dd>
			<dt>Cartelle collegate</dt>
			<dd>
				{#if foldersOf(view).length}
					{#each foldersOf(view) as f}<span class="chip">{f}</span>{/each}
				{:else}—{/if}
			</dd>
		</dl>

		<section class="todos">
			<h3>To-do <span class="count">{openCount} aperte</span></h3>
			{#if view.todos.length === 0}
				<p class="muted">Nessuna voce.</p>
			{:else}
				<ul>
					{#each sorted(view.todos) as t (t.id)}
						<li class:done={t.status === 'done'} class:overdue={isOverdue(t)}>
							{#if editId === t.id}
								<div class="edit-row">
									<input class="grow" type="text" bind:value={editText} maxlength="500" aria-label="Testo" />
									<input type="date" bind:value={editDue} aria-label="Scadenza" />
									<input class="who" type="text" bind:value={editAssignee} maxlength="64" placeholder="assegnatario" aria-label="Assegnatario" />
									<button type="button" disabled={busy || !editText.trim()} on:click={() => saveEdit(t)}>Salva</button>
									<button type="button" class="ghost" disabled={busy} on:click={() => (editId = null)}>Annulla</button>
								</div>
							{:else}
								<input type="checkbox" checked={t.status === 'done'} disabled={!canEdit || busy}
									aria-label={t.status === 'done' ? 'Riapri' : 'Segna come fatta'}
									on:change={() => toggle(t)} />
								<span class="text">{t.text}</span>
								{#if t.due}
									<span class="due" title={isOverdue(t) ? 'Scaduta' : 'Scadenza'}>
										{isOverdue(t) ? '⚠ ' : ''}{fmtDate(t.due)}
									</span>
								{/if}
								{#if t.assignee}<span class="who-chip">@{t.assignee}</span>{/if}
								{#if canEdit}
									<button type="button" class="icon" title="Modifica" disabled={busy} on:click={() => startEdit(t)}>✎</button>
									<button type="button" class="icon" title="Rimuovi" disabled={busy} on:click={() => remove(t)}>×</button>
								{/if}
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
			{#if canEdit}
				<form class="add-row" on:submit|preventDefault={add}>
					<input class="grow" type="text" bind:value={newText} maxlength="500" placeholder="Nuova voce…" aria-label="Nuova voce" />
					<input type="date" bind:value={newDue} aria-label="Scadenza" />
					<input class="who" type="text" bind:value={newAssignee} maxlength="64" placeholder="assegnatario" aria-label="Assegnatario" />
					<button type="submit" disabled={busy || !newText.trim()}>Aggiungi</button>
				</form>
			{/if}
		</section>

		{#if view.is_admin}
			<details class="raw">
				<summary>meta.json (admin)</summary>
				<pre>{JSON.stringify(view.meta, null, 2)}</pre>
			</details>
		{/if}
	{/if}
</Modal>

<style>
	.muted { color: var(--fg-muted); font-size: 13px; }
	.err { color: #ef4444; font-size: 13px; }
	.deadline-box {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 2px 12px;
		align-items: baseline;
		padding: 10px 14px;
		border-radius: 8px;
		border: 1px solid var(--accent);
		background: rgba(199, 154, 46, 0.08);
		margin-bottom: 14px;
	}
	.deadline-box.overdue { border-color: #ef4444; background: rgba(239, 68, 68, 0.1); }
	.deadline-box.none { border-color: var(--border); background: transparent; }
	.dl-label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--fg-muted); }
	.dl-value { font-size: 18px; font-weight: 700; }
	.deadline-box.overdue .dl-value { color: #ef4444; }
	.dl-hint { grid-column: 1 / -1; font-size: 11px; color: var(--fg-muted); }
	.fields {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 6px 14px;
		margin: 0 0 16px;
		font-size: 13px;
	}
	.fields dt { color: var(--fg-muted); }
	.fields dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
	.chip, .who-chip {
		display: inline-block;
		font-size: 11px;
		padding: 1px 6px;
		margin: 0 4px 2px 0;
		border-radius: 4px;
		border: 1px solid var(--border);
		color: var(--fg-muted);
	}
	.todos h3 { font-size: 13px; margin: 0 0 8px; display: flex; gap: 8px; align-items: baseline; }
	.count { font-weight: 400; color: var(--fg-muted); font-size: 12px; }
	.todos ul { list-style: none; margin: 0 0 10px; padding: 0; }
	.todos li {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 5px 0;
		border-bottom: 1px solid var(--border);
		font-size: 13px;
	}
	.todos li .text { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
	.todos li.done .text { text-decoration: line-through; color: var(--fg-muted); }
	.todos li.overdue .due { color: #ef4444; font-weight: 600; }
	.due { font-size: 12px; color: var(--fg-muted); white-space: nowrap; }
	.icon {
		border: none;
		background: transparent;
		color: var(--fg-muted);
		cursor: pointer;
		padding: 0 4px;
		font-size: 14px;
	}
	.icon:hover:not(:disabled) { color: var(--fg); }
	.add-row, .edit-row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; width: 100%; }
	.grow { flex: 1 1 180px; min-width: 0; }
	.who { width: 120px; }
	.ghost { background: transparent; }
	.raw { margin-top: 16px; font-size: 12px; }
	.raw pre { max-height: 260px; overflow: auto; font-size: 11px; }
</style>
