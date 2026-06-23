<script lang="ts">
	/**
	 * Circular avatar with the agent's profile picture if available
	 * (served by GET /api/agents/{name}/pfp), otherwise falls back to a
	 * coloured circle with the first letter — `avatar_color` provides the
	 * background, with a muted neutral as last resort.
	 */
	import { API_BASE_URL } from '$lib/api/client';

	export let name: string;
	export let displayName: string | undefined = undefined;
	export let color: string | undefined = undefined;
	export let size: number = 44;

	$: label = (displayName || name || '?').trim();
	$: initial = label.charAt(0).toUpperCase();
	$: bg = color && color.trim() ? color : '#3a3f4d';
	$: fontSize = Math.round(size * 0.42);
	$: pfpUrl = name ? `${API_BASE_URL}/api/agents/${encodeURIComponent(name)}/pfp` : '';

	// Tracciamo il fallimento del fetch per agent → reset quando cambia name.
	let pfpFailed = false;
	$: if (name) pfpFailed = false;
</script>

<span
	class="avatar"
	style:width="{size}px"
	style:height="{size}px"
	style:background={bg}
	style:font-size="{fontSize}px"
	aria-hidden="true"
>
	{#if pfpUrl && !pfpFailed}
		<img
			src={pfpUrl}
			alt=""
			width={size}
			height={size}
			loading="lazy"
			on:error={() => (pfpFailed = true)}
		/>
	{:else}
		{initial}
	{/if}
</span>

<style>
	.avatar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		color: #fff;
		font-weight: 700;
		letter-spacing: 0;
		flex: 0 0 auto;
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
		box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
		overflow: hidden;
	}

	.avatar img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
</style>
