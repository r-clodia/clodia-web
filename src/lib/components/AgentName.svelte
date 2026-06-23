<script lang="ts">
	/**
	 * Render del nome di un agent con evidenziazione della particella "ia" / "ai".
	 *
	 * Convenzione naming agent (giugno 2026): aida, elia, giaime, ian, jair.
	 * Tutti contengono "ia" o "ai" — la particella allude all'AI/IA che alimenta
	 * l'agent. Resa grafica: la particella è colorata `--accent`.
	 *
	 * Case-insensitive: la prima occorrenza fra "ai" e "ia" viene evidenziata
	 * (entrambe sono trattate come uguali). Se il nome non contiene né l'una né
	 * l'altra, viene reso tale e quale.
	 */
	export let name: string;
	/** Variante "tono soft" per contesti dove l'accent sarebbe troppo forte. */
	export let muted = false;

	function split(n: string): { pre: string; ia: string; post: string } | null {
		if (!n) return null;
		const lower = n.toLowerCase();
		let idx = -1;
		let len = 2;
		const iaIdx = lower.indexOf('ia');
		const aiIdx = lower.indexOf('ai');
		if (iaIdx === -1 && aiIdx === -1) return null;
		if (iaIdx === -1) idx = aiIdx;
		else if (aiIdx === -1) idx = iaIdx;
		else idx = Math.min(iaIdx, aiIdx);
		return {
			pre: n.slice(0, idx),
			ia: n.slice(idx, idx + len),
			post: n.slice(idx + len)
		};
	}

	$: parts = split(name);
</script>

{#if parts}<span class="agent-name" class:muted
		>{parts.pre}<span class="ia">{parts.ia}</span>{parts.post}</span
	>{:else}<span class="agent-name" class:muted>{name}</span>{/if}

<style>
	.agent-name {
		display: inline;
	}
	.ia {
		color: var(--accent);
		font-weight: 600;
	}
	.muted .ia {
		opacity: 0.7;
	}
</style>
