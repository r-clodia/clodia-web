<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import { renderMarkdown } from '$lib/markdown';
	import AgentAvatar from '$lib/components/AgentAvatar.svelte';
	import { session } from '$lib/auth/session';
	import {
		createChannel, getChannelMessages, postChannelMessage,
		type ChannelMessage
	} from '$lib/api/client';

	// Widget chat flottante (stile customer-care) verso un agente su un topic
	// dedicato — non fa uscire dalla pagina corrente.
	export let agent = 'wainston';
	export let tier = 'SEAL-1';
	export let name = 'helpdesk';
	export let title = 'Assistenza';
	export let initialMessage = '';
	export let launcherLabel = '💬 Aiuto — parla con Wainston';

	let open = false;
	let started = false;
	let messages: ChannelMessage[] = [];
	let draft = '';
	let sending = false;
	let err = '';
	let poll: ReturnType<typeof setInterval> | null = null;
	let streamEl: HTMLDivElement;

	const _CH_RE = /<!--\s*choices(-multi)?\s*=(.*?)-->/i;
	const me = () => $session?.principal ?? '';
	function stripChoices(t: string) { return (t || '').replace(_CH_RE, '').trim(); }
	function choices(t: string): string[] {
		const m = (t || '').match(_CH_RE);
		return m ? m[2].split(/[,;|]/).map((s) => s.trim()).filter(Boolean) : [];
	}

	async function ensureTopic() {
		// contact_agent = l'agent del widget → è lui a rispondere nel canale di help
		await createChannel({ name, tier, title, type: 'infra', contact_agent: agent });
	}
	async function refresh() {
		try { messages = await getChannelMessages(tier, name); } catch (e) { err = String(e); }
	}
	async function scrollDown() { await tick(); if (streamEl) streamEl.scrollTop = streamEl.scrollHeight; }

	async function toggle() {
		open = !open;
		if (open && !started) {
			started = true;
			try {
				await ensureTopic();
				await refresh();
				if (initialMessage && messages.length === 0) {
					await postChannelMessage(tier, name, initialMessage);
					await refresh();
				}
				await scrollDown();
				poll = setInterval(async () => { await refresh(); }, 4000);
			} catch (e) { err = String(e); }
		}
	}

	async function send(text?: string) {
		const body = (text ?? draft).trim();
		if (!body || sending) return;
		sending = true; draft = '';
		try {
			await postChannelMessage(tier, name, body);
			await refresh(); await scrollDown();
		} catch (e) { err = String(e); draft = body; }
		finally { sending = false; }
	}

	onDestroy(() => poll && clearInterval(poll));
	$: lastId = messages.length ? messages[messages.length - 1].id : null;
	$: lastId, scrollDown();
</script>

{#if open}
	<div class="cw-panel">
		<header class="cw-head">
			<AgentAvatar name={agent} size={22} />
			<span class="cw-title">{title}</span>
			<button class="cw-x" on:click={toggle} aria-label="Chiudi">×</button>
		</header>
		<div class="cw-stream" bind:this={streamEl}>
			{#if err}<div class="cw-err">{err}</div>{/if}
			{#each messages as m (m.id)}
				<div class="cw-msg" class:mine={m.author === me()}>
					<div class="cw-author">{m.author}</div>
					<div class="cw-body">{@html renderMarkdown(stripChoices(m.text))}</div>
					{#if choices(m.text).length && m.id === lastId}
						<div class="cw-pills">
							{#each choices(m.text) as c}
								<button class="cw-pill" on:click={() => send(c)} disabled={sending}>{c}</button>
							{/each}
						</div>
					{/if}
				</div>
			{:else}
				<p class="cw-empty">Avvio la conversazione…</p>
			{/each}
		</div>
		<div class="cw-composer">
			<textarea bind:value={draft} rows="1" placeholder="Scrivi a {agent}…"
				on:keydown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}></textarea>
			<button class="cw-send" on:click={() => send()} disabled={sending || !draft.trim()}>➤</button>
		</div>
	</div>
{/if}

<button class="cw-launcher" class:open on:click={toggle}>
	{open ? '× Chiudi' : launcherLabel}
</button>

<style>
	.cw-launcher {
		position: fixed; right: 20px; bottom: 20px; z-index: 60;
		background: var(--accent); color: #1a1208; border: none; border-radius: 999px;
		padding: 11px 18px; font-weight: 700; font-size: 13px; cursor: pointer;
		box-shadow: 0 8px 24px rgba(0,0,0,.35);
	}
	.cw-launcher.open { background: var(--card-bg); color: var(--fg); border: 1px solid var(--border); }
	.cw-panel {
		position: fixed; right: 20px; bottom: 74px; z-index: 60;
		width: min(380px, calc(100vw - 40px)); height: min(540px, calc(100vh - 120px));
		display: flex; flex-direction: column; background: var(--bg);
		border: 1px solid var(--border); border-radius: 14px; overflow: hidden;
		box-shadow: 0 18px 50px rgba(0,0,0,.45);
	}
	.cw-head { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 10px 12px;
		background: var(--card-bg); border-bottom: 1px solid var(--border); }
	.cw-title { font-weight: 700; font-size: 14px; flex: 1 1 auto; }
	.cw-x { background: transparent; border: none; color: var(--fg-muted); font-size: 20px; cursor: pointer; line-height: 1; }
	.cw-stream { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
	.cw-err { color: #e85d75; font-size: 12px; }
	.cw-empty { color: var(--fg-muted); font-size: 13px; text-align: center; margin-top: 20px; }
	.cw-msg { max-width: 88%; background: var(--card-bg); border: 1px solid var(--border); border-radius: 10px; padding: 7px 10px; align-self: flex-start; }
	.cw-msg.mine { align-self: flex-end; background: rgba(255,107,61,.10); border-color: rgba(255,107,61,.3); }
	.cw-author { font-size: 11px; font-weight: 700; color: var(--fg-muted); margin-bottom: 2px; }
	.cw-body { font-size: 13.5px; line-height: 1.5; }
	.cw-body :global(p) { margin: 0 0 .4em; }
	.cw-body :global(p:last-child) { margin-bottom: 0; }
	.cw-body :global(table) { font-size: 12px; border-collapse: collapse; }
	.cw-body :global(td), .cw-body :global(th) { border: 1px solid var(--border); padding: 2px 6px; }
	.cw-body :global(code) { background: rgba(0,0,0,.25); padding: 0 4px; border-radius: 3px; }
	.cw-pills { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
	.cw-pill { background: transparent; border: 1px solid rgba(255,107,61,.5); color: var(--fg); font-size: 12px; padding: 4px 10px; border-radius: 999px; cursor: pointer; }
	.cw-composer { flex: 0 0 auto; display: flex; gap: 8px; padding: 8px 10px; border-top: 1px solid var(--border); }
	.cw-composer textarea { flex: 1 1 auto; background: rgba(0,0,0,.25); border: 1px solid var(--border); color: var(--fg); border-radius: 10px; padding: 8px 10px; font: inherit; font-size: 13px; resize: none; max-height: 100px; }
	.cw-send { background: var(--accent); border: none; color: #1a1208; font-weight: 700; width: 38px; border-radius: 10px; cursor: pointer; }
	.cw-send:disabled { opacity: .5; }
</style>
