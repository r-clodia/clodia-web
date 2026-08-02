<script lang="ts">
	/**
	 * Box UNICO per agente con ragionamento + uso dei tool in sequenza
	 * (issue clodia-platform#105).
	 *
	 * Prima c'erano due blocchi distinti per ogni agente al lavoro — uno per il
	 * ragionamento, uno per i tool — quindi con N agenti attivi la chat si
	 * riempiva di 2N riquadri e seguire il singolo agente diventava impossibile.
	 * Qui il turno di un agente è **un box solo**: compatto di default, con una
	 * riga che dice cosa sta facendo *adesso*; espanso mostra il ragionamento e
	 * la sequenza delle chiamate ai tool.
	 *
	 * Lo stato aperto/chiuso è **per box**. Prima era una variabile sola
	 * condivisa da tutti gli agenti: espandere il ragionamento di uno li apriva
	 * tutti.
	 */

	/** Etichetta dell'agente (o dell'istanza multi-spawn: `fullstack-dev#2`). */
	export let agent: string;
	/** Testo di ragionamento accumulato nel turno corrente. */
	export let think: string = '';
	/** Chiamate ai tool nell'ordine in cui sono avvenute (già formattate). */
	export let tools: string[] = [];
	/** Box inizialmente espanso (default: compatto). */
	export let open: boolean = false;

	const MAX_PEEK = 90;

	/** Ultima riga non vuota del ragionamento, per l'anteprima compatta. */
	function thinkTail(t: string): string {
		const lines = (t || '').split('\n').map((l) => l.trim()).filter(Boolean);
		return lines.length ? lines[lines.length - 1] : '';
	}
	function clip(s: string): string {
		return s.length > MAX_PEEK ? s.slice(0, MAX_PEEK) + '…' : s;
	}

	// Anteprima: l'attività più recente. Il tool ha la precedenza sul
	// ragionamento — se l'agente sta chiamando qualcosa, è quello che l'utente
	// vuole vedere senza espandere.
	$: lastTool = tools.length ? tools[tools.length - 1] : '';
	$: peek = clip(lastTool || thinkTail(think));
	$: hasDetail = !!think || tools.length > 0;
</script>

<div class="live-box" class:open>
	<button
		type="button"
		class="live-head"
		aria-expanded={open}
		on:click={() => (open = !open)}
	>
		<span class="caret" class:open aria-hidden="true">▸</span>
		<span class="live-agent">{agent}</span>
		<span class="live-dot" aria-hidden="true">●</span>
		<span class="live-peek">{peek || 'al lavoro…'}</span>
		<span class="live-hint">{open ? 'comprimi' : 'espandi'}</span>
	</button>
	{#if open}
		<div class="live-body">
			{#if think}
				<pre class="live-think">{think}</pre>
			{/if}
			{#if tools.length}
				<ol class="live-steps" aria-label={`Tool usati da ${agent}`}>
					{#each tools as t, i (`${i}-${t}`)}
						<li class:current={i === tools.length - 1}>{t}</li>
					{/each}
				</ol>
			{/if}
			{#if !hasDetail}
				<p class="live-empty">Nessun dettaglio ancora.</p>
			{/if}
		</div>
	{/if}
</div>

<style>
	.live-box {
		margin: 2px 8px 6px;
		border: 1px dashed var(--border);
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.02);
	}
	.live-box.open {
		border-style: solid;
	}
	.live-head {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		min-width: 0;
		padding: 7px 10px;
		background: transparent;
		border: none;
		color: var(--fg-muted);
		font: inherit;
		font-size: 11.5px;
		text-align: left;
		cursor: pointer;
	}
	.live-head:hover {
		color: var(--fg);
	}
	.caret {
		flex: none;
		font-size: 10px;
		transition: transform 0.12s ease;
	}
	.caret.open {
		transform: rotate(90deg);
	}
	.live-agent {
		flex: none;
		font-weight: 700;
		font-size: 10px;
		letter-spacing: 0.03em;
		text-transform: uppercase;
	}
	.live-dot {
		flex: none;
		color: var(--accent);
		font-size: 9px;
		animation: live-pulse 1.2s ease-in-out infinite;
	}
	@keyframes live-pulse {
		0%,
		100% {
			opacity: 0.35;
		}
		50% {
			opacity: 1;
		}
	}
	/* Anteprima compatta: cosa sta facendo ADESSO, su una riga sola. */
	.live-peek {
		flex: 1 1 auto;
		min-width: 0;
		font-family: var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace);
		font-size: 11px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.live-hint {
		flex: none;
		font-size: 10px;
		opacity: 0.7;
	}
	.live-body {
		padding: 0 10px 10px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.live-think {
		margin: 0;
		max-height: 220px;
		overflow: auto;
		white-space: pre-wrap;
		word-break: break-word;
		font-family: var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace);
		font-size: 11.5px;
		line-height: 1.5;
		color: var(--fg-muted);
	}
	.live-steps {
		margin: 0;
		padding: 0 0 0 14px;
		display: flex;
		flex-direction: column;
		gap: 2px;
		max-height: 180px;
		overflow-y: auto;
	}
	.live-steps li {
		font-size: 11px;
		color: var(--fg-muted);
		font-family: var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace);
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.live-steps li.current {
		color: var(--fg);
	}
	.live-empty {
		margin: 0;
		font-size: 11px;
		color: var(--fg-muted);
		font-style: italic;
	}
</style>
