<script lang="ts">
	/**
	 * Generic modal shell. Renders a centered card with a backdrop,
	 * traps focus while open, and dismisses on backdrop click / Esc.
	 *
	 * Slot contract:
	 *   <Modal open={open} on:close={...}>
	 *     <h2 slot="title">Title</h2>
	 *     <p>Body</p>
	 *     <div slot="actions">
	 *       <button>Cancel</button><button>OK</button>
	 *     </div>
	 *   </Modal>
	 *
	 * The parent controls `open` and listens for the `close` event for
	 * dismissal. Bodies are scrollable when content overflows the
	 * viewport.
	 */
	import { createEventDispatcher, onDestroy } from 'svelte';

	export let open: boolean = false;
	/** Set to false to disable backdrop-click + Esc dismissal (forces explicit close). */
	export let dismissable: boolean = true;
	/** Max-width of the modal in pixels. Defaults to 560 (form-friendly). */
	export let maxWidth: number = 560;

	const dispatch = createEventDispatcher<{ close: void }>();

	function close() {
		if (!dismissable) return;
		dispatch('close');
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && open && dismissable) {
			e.preventDefault();
			close();
		}
	}

	let prevBodyOverflow = '';
	$: if (typeof document !== 'undefined') {
		if (open) {
			prevBodyOverflow = document.body.style.overflow;
			document.body.style.overflow = 'hidden';
		} else if (prevBodyOverflow !== undefined) {
			document.body.style.overflow = prevBodyOverflow;
			prevBodyOverflow = '';
		}
	}

	onDestroy(() => {
		if (typeof document !== 'undefined' && prevBodyOverflow !== undefined) {
			document.body.style.overflow = prevBodyOverflow;
		}
	});
</script>

<svelte:window on:keydown={onKeydown} />

{#if open}
	<div
		class="backdrop"
		role="presentation"
		on:click={close}
		on:keydown={(e) => {
			if (e.key === 'Escape' && dismissable) close();
		}}
	>
		<div
			class="card"
			role="dialog"
			aria-modal="true"
			tabindex="-1"
			style="max-width: {maxWidth}px"
			on:click|stopPropagation
			on:keydown|stopPropagation
		>
			{#if $$slots.title}
				<header class="card-head">
					<slot name="title" />
					{#if dismissable}
						<button type="button" class="x" aria-label="Close" on:click={close}>×</button>
					{/if}
				</header>
			{/if}
			<div class="card-body">
				<slot />
			</div>
			{#if $$slots.actions}
				<footer class="card-actions">
					<slot name="actions" />
				</footer>
			{/if}
		</div>
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgba(5, 6, 10, 0.55);
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding: 60px 24px;
		z-index: 900;
		overflow-y: auto;
		animation: fade 140ms ease-out;
	}

	@keyframes fade {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	.card {
		background: var(--card-bg);
		border: 1px solid var(--border);
		border-radius: 12px;
		box-shadow: 0 12px 36px rgba(0, 0, 0, 0.45);
		width: 100%;
		display: flex;
		flex-direction: column;
		max-height: calc(100vh - 120px);
		animation: pop 160ms ease-out;
	}

	@keyframes pop {
		from {
			opacity: 0;
			transform: translateY(-6px) scale(0.985);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	.card-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 16px 20px;
		border-bottom: 1px solid var(--border);
	}

	.card-head :global(h1),
	.card-head :global(h2),
	.card-head :global(h3) {
		margin: 0;
		font-size: 15px;
		font-weight: 700;
		letter-spacing: 0.02em;
	}

	.x {
		border: none;
		background: transparent;
		color: var(--fg-muted);
		font-size: 22px;
		line-height: 1;
		padding: 2px 8px;
		cursor: pointer;
		border-radius: 4px;
	}
	.x:hover {
		color: var(--fg);
		background: rgba(255, 255, 255, 0.05);
	}

	.card-body {
		padding: 18px 20px;
		overflow-y: auto;
		flex: 1 1 auto;
	}

	.card-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		padding: 12px 20px 16px;
		border-top: 1px solid var(--border);
	}
</style>
