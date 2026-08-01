<script lang="ts">
	/**
	 * Danger score «lethal trifecta» del contesto (issue clodia-platform#77).
	 *
	 * Sempre visibile accanto al titolo del topic: 0-1/3 ✅ · 2/3 ⚠️ · 3/3 🚨.
	 * Il numero da solo non è azionabile — il tooltip lo scompone per lato e
	 * per agente («legge il web: clodia · dati privati: ophelia · può inviare:
	 * messaggero»), perché è quella l'informazione che serve a decidere.
	 *
	 * Il punteggio è di MISURA, non di enforcement: nessuna azione è bloccata.
	 */
	import type { TrifectaProfile, TrifectaLeg } from '$lib/api/client';

	export let profile: TrifectaProfile | null | undefined = null;

	const LEG_LABEL: Record<TrifectaLeg, string> = {
		private_data: 'dati privati',
		untrusted_input: 'contenuto non fidato',
		egress: 'uscita verso l’esterno'
	};
	const LEGS: TrifectaLeg[] = ['private_data', 'untrusted_input', 'egress'];

	$: score = profile?.score ?? 0;
	$: level = score >= 3 ? 'high' : score === 2 ? 'mid' : 'low';
	$: direct = profile?.direct;
	// Il canale arriva a 3 solo perché qualcuno può invitare altri agenti:
	// va detto, altrimenti il numero sembra descrivere i presenti.
	$: byInvitation = !!direct && direct.score < score && (profile?.expanded_by?.length ?? 0) > 0;
	// La shell va attribuita a chi è davvero nel canale, non a chi è invitabile.
	$: directShell = direct?.shell_agents ?? profile?.shell_agents ?? [];
	$: names = (leg: TrifectaLeg) =>
		(direct?.by_leg?.[leg] ?? profile?.by_leg?.[leg] ?? []).join(', ');
</script>

{#if profile}
	<!-- button e non span: il tooltip dev'essere raggiungibile da tastiera -->
	<button type="button" class="trifecta {level}"
		aria-label="Danger score trifecta {profile.label}">
		<span class="sym" aria-hidden="true">{profile.symbol}</span>
		<span class="val">{profile.label}</span>
		{#if profile.shell}<span class="shell" aria-hidden="true">⛨</span>{/if}
		<span class="tip">
			<strong>Trifecta {profile.label}</strong> — lati presenti in questo topic:
			<ul>
				{#each LEGS as leg}
					<li class:on={profile.legs[leg]}>
						{profile.legs[leg] ? '•' : '◦'} {LEG_LABEL[leg]}
						{#if names(leg)}<span class="who">{names(leg)}</span>{/if}
					</li>
				{/each}
			</ul>
			{#if byInvitation}
				<p class="note">
					Fra i soli partecipanti è {direct?.label}: sale a {profile.label} perché
					{profile.expanded_by?.join(', ')} può aggiungere altri agenti.
				</p>
			{/if}
			{#if directShell.length}
				<p class="note">
					⛨ {directShell.join(', ')}: shell attiva, i controlli del gateway sono
					aggirabili (curl non passa dal gateway).
				</p>
			{:else if profile.shell}
				<p class="note">
					⛨ Nessun presente ha la shell, ma fra gli agenti invitabili sì
					({profile.shell_agents?.join(', ')}).
				</p>
			{/if}
			{#if profile.unknown_participants?.length}
				<p class="note">Partecipanti non registrati, non valutati: {profile.unknown_participants.join(', ')}.</p>
			{/if}
			<p class="note dim">
				3/3 = dati privati + contenuto non fidato + uscita nello stesso contesto.
				Misura, non blocco (issue #77).
			</p>
		</span>
	</button>
{/if}

<style>
	.trifecta {
		position: relative; display: inline-flex; align-items: center; gap: 4px;
		font: inherit; font-size: 11px; line-height: 1.6; background: transparent;
		border: 1px solid var(--border); border-radius: 999px; padding: 1px 8px;
		cursor: help; color: var(--fg-muted);
	}
	.trifecta:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
	.trifecta.mid { border-color: var(--warn, #e0a800); color: var(--warn, #e0a800); }
	.trifecta.high { border-color: var(--danger); color: var(--danger); }
	.sym { font-size: 10px; }
	.val { font-variant-numeric: tabular-nums; }
	.shell { opacity: .8; }
	.tip {
		position: absolute; left: 0; top: calc(100% + 6px); z-index: 30; display: none;
		width: min(320px, 80vw); padding: 8px 10px; border: 1px solid var(--border);
		border-radius: 6px; background: var(--card-bg); color: var(--fg);
		box-shadow: 0 6px 18px rgba(0, 0, 0, .28); font-size: 12px; font-weight: 400;
		white-space: normal; text-align: left;
	}
	.trifecta:hover .tip, .trifecta:focus .tip, .trifecta:focus-within .tip { display: block; }
	.tip ul { list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
	.tip li { color: var(--fg-muted); }
	.tip li.on { color: var(--fg); }
	.tip .who { color: var(--fg-muted); font-size: 11px; }
	.tip .who::before { content: '— '; }
	.tip .note { margin: 6px 0 0; color: var(--fg-muted); font-size: 11px; }
	.tip .note.dim { opacity: .75; }
</style>
