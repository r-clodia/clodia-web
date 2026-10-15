<script lang="ts">
	// Libreria di GLIFI, non di connettori (clodia-platform#520).
	//
	// Prima questo componente decideva da sé quale disegno spettava a chi,
	// deducendolo dal nome del provider: sapeva che `google` è Google e che
	// `kind: 'mailbox'` vuole la busta. Un connettore arrivato con un pack non
	// aveva modo di scegliere, e per averne uno serviva un deploy di questo
	// repository.
	//
	// Ora la SCELTA arriva dal manifest (`tools_card.icon`) e qui restano solo i
	// disegni — che nel frontend ci devono stare, perché un logo è un file SVG.
	// Un nome sconosciuto ricade sul glifo generico: un pack può dichiarare
	// quello che vuole senza rompere la pagina.
	export let name: string | undefined = undefined;
	export let size = 26;

	$: key = (name ?? '').toLowerCase();
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
{:else if key === 'telegram'}
	<svg width={size} height={size} viewBox="0 0 240 240" aria-hidden="true">
		<circle cx="120" cy="120" r="120" fill="#29b6f6" />
		<path d="M180.5 72.1 156.9 172c-1.8 8-6.6 10-13.4 6.2l-37-27.3-17.9 17.2c-2 2-3.7 3.7-7.5 3.7l2.7-38 69.4-62.7c3-2.7-.7-4.2-4.6-1.5L60 130.6l-37.2-11.6c-8.1-2.5-8.2-8.1 1.7-12l145.4-56c6.7-2.5 12.6 1.6 10.6 12.1Z"
			fill="#fff" />
	</svg>
{:else if key === 'drive'}
	<svg width={size} height={size} viewBox="0 0 87.3 78" aria-hidden="true">
		<path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da" />
		<path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47" />
		<path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.5l5.85 11.5z" fill="#ea4335" />
		<path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d" />
		<path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc" />
		<path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00" />
	</svg>
{:else if key === 'github'}
	<svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
		<path fill="currentColor" d="M12 .5a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1.1-.8.1-.8.1-.8 1.2.1 1.9 1.3 1.9 1.3 1.1 1.9 2.9 1.3 3.6 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.4 5.1 18.4 5.4 18.4 5.4c.7 1.7.3 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .5Z"/>
	</svg>
{:else}
	<svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
		<rect x="3" y="3" width="18" height="18" rx="4" fill="none" stroke="currentColor" stroke-width="1.8"/>
		<circle cx="12" cy="12" r="3.5" fill="currentColor"/>
	</svg>
{/if}
