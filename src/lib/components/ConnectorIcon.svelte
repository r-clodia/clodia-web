<script lang="ts">
	// Icona rappresentativa di un connettore in base al provider/kind.
	export let provider: string | undefined = undefined;
	export let kind: string | undefined = undefined;
	export let mcp = false;
	export let size = 26;

	$: key = mcp ? 'mcp' : (kind === 'mailbox' ? 'email' : (provider ?? '').toLowerCase());
</script>

{#if key === 'google'}
	<svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
		<path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 5.1 29.3 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21 21-9.4 21-21c0-1.4-.1-2.5-.4-3.5z"/>
		<path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 5.1 29.3 3 24 3 16 3 9.1 7.6 6.3 14.7z"/>
		<path fill="#4CAF50" d="M24 45c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.9 26.7 37 24 37c-5.2 0-9.6-3.3-11.2-7.9l-6.5 5C9.1 40.3 16 45 24 45z"/>
		<path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.6l6.2 5.2C39.9 36.6 45 31 45 24c0-1.4-.1-2.5-.4-3.5z"/>
	</svg>
{:else if key === 'openai'}
	<svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
		<path fill="currentColor" d="M22.28 9.82a5.98 5.98 0 0 0-.52-4.91 6.05 6.05 0 0 0-6.51-2.9A6 6 0 0 0 4.98 4.18a5.98 5.98 0 0 0-3.997 2.9 6.05 6.05 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071.006l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071-.005l4.83 2.785a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zM8.31 12.863l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v3l-2.597 1.5-2.607-1.5z"/>
	</svg>
{:else if key === 'trello'}
	<svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
		<rect x="2" y="2" width="20" height="20" rx="3" fill="#0079BF"/>
		<rect x="4.7" y="4.7" width="5.6" height="13" rx="1" fill="#fff"/>
		<rect x="13.2" y="4.7" width="5.6" height="8" rx="1" fill="#fff"/>
	</svg>
{:else if key === 'email'}
	<svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
		<rect x="2.5" y="4.5" width="19" height="15" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/>
		<path d="M3.5 6.5l8.5 6 8.5-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
	</svg>
{:else if key === 'storage'}
	<svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
		<ellipse cx="12" cy="5.5" rx="7.5" ry="3" fill="none" stroke="currentColor" stroke-width="1.8"/>
		<path d="M4.5 5.5v13c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3v-13" fill="none" stroke="currentColor" stroke-width="1.8"/>
		<path d="M4.5 12c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3" fill="none" stroke="currentColor" stroke-width="1.8"/>
	</svg>
{:else if key === 'mcp'}
	<svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
		<path d="M9 2v6M15 2v6M7 8h10v3a5 5 0 0 1-10 0V8zM12 16v6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
	</svg>
{:else}
	<svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
		<rect x="3" y="3" width="18" height="18" rx="4" fill="none" stroke="currentColor" stroke-width="1.8"/>
		<circle cx="12" cy="12" r="3.5" fill="currentColor"/>
	</svg>
{/if}
