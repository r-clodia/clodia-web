<script lang="ts">
	/**
	 * Toast container — rendered once by the root layout. It subscribes to
	 * the global toast store and stacks notifications at the bottom-right
	 * of the viewport. Each toast carries a kind (success/error/info) that
	 * controls its color band, plus an × button to dismiss before the TTL.
	 *
	 * Visual design follows the rest of the WebUI v2: dark card surface,
	 * single 1px border, accent color band on the left for kind. No
	 * animation library; CSS transitions handle the slide-in.
	 *
	 * Accessibility: each toast carries `role="status"` (or `alert` for
	 * errors) so screen-readers announce them politely. The × button has
	 * an `aria-label`.
	 */
	import { toasts, dismissToast, type Toast } from '$lib/stores/toasts';

	function ariaRoleFor(t: Toast): 'alert' | 'status' {
		return t.kind === 'error' ? 'alert' : 'status';
	}

	function iconFor(t: Toast): string {
		if (t.kind === 'success') return '✓';
		if (t.kind === 'error') return '!';
		return 'i';
	}
</script>

<div class="toaster" aria-live="polite" aria-atomic="false">
	{#each $toasts as t (t.id)}
		<div class="toast toast-{t.kind}" role={ariaRoleFor(t)}>
			<span class="icon" aria-hidden="true">{iconFor(t)}</span>
			<div class="body">
				<div class="msg">{t.message}</div>
				{#if t.hint}
					<div class="hint">{t.hint}</div>
				{/if}
			</div>
			<button
				type="button"
				class="close"
				on:click={() => dismissToast(t.id)}
				aria-label="Dismiss"
			>
				×
			</button>
		</div>
	{/each}
</div>

<style>
	.toaster {
		position: fixed;
		bottom: 18px;
		right: 18px;
		display: flex;
		flex-direction: column;
		gap: 10px;
		z-index: 1000;
		pointer-events: none;
		max-width: min(420px, calc(100vw - 36px));
	}

	.toast {
		pointer-events: auto;
		display: flex;
		gap: 10px;
		align-items: flex-start;
		padding: 12px 12px 12px 0;
		background: var(--card-bg);
		border: 1px solid var(--border);
		border-radius: 8px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
		min-width: 220px;
		animation: slide-in 160ms ease-out;
	}

	@keyframes slide-in {
		from {
			opacity: 0;
			transform: translateX(20px);
		}
		to {
			opacity: 1;
			transform: translateX(0);
		}
	}

	.icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		flex: 0 0 28px;
		align-self: stretch;
		font-weight: 700;
		font-size: 13px;
		border-radius: 8px 0 0 8px;
		margin-left: -1px; /* sit on top of the border */
	}

	.toast-success .icon {
		background: rgba(92, 184, 138, 0.18);
		color: var(--success);
	}
	.toast-success {
		border-color: rgba(92, 184, 138, 0.45);
	}

	.toast-error .icon {
		background: rgba(232, 93, 117, 0.18);
		color: var(--danger);
	}
	.toast-error {
		border-color: rgba(232, 93, 117, 0.55);
	}

	.toast-info .icon {
		background: rgba(111, 182, 255, 0.16);
		color: #6fb6ff;
	}
	.toast-info {
		border-color: rgba(111, 182, 255, 0.45);
	}

	.body {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding-top: 1px;
	}

	.msg {
		color: var(--fg);
		font-size: 13px;
		line-height: 1.4;
		word-break: break-word;
	}

	.hint {
		color: var(--fg-muted);
		font-size: 11.5px;
		line-height: 1.4;
		word-break: break-word;
		font-family: var(--mono);
	}

	.close {
		flex: 0 0 auto;
		border: none;
		background: transparent;
		color: var(--fg-muted);
		font-size: 18px;
		line-height: 1;
		padding: 0 10px;
		margin: -4px -4px -4px 0;
		cursor: pointer;
		border-radius: 4px;
	}
	.close:hover {
		color: var(--fg);
		background: rgba(255, 255, 255, 0.05);
	}
</style>
