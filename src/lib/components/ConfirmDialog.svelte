<script lang="ts">
	/**
	 * Confirmation dialog — wraps `Modal` to provide a yes/no question with
	 * danger styling for destructive actions.
	 *
	 * Usage:
	 *   <ConfirmDialog
	 *     open={pendingDelete}
	 *     title="Eliminare job?"
	 *     message="L'azione non è reversibile."
	 *     confirmLabel="Elimina"
	 *     destructive
	 *     loading={deleting}
	 *     on:confirm={onConfirmDelete}
	 *     on:cancel={() => (pendingDelete = false)}
	 *   />
	 *
	 * The parent owns the open/loading state; the dialog only fires events.
	 */
	import { createEventDispatcher } from 'svelte';
	import Modal from './Modal.svelte';

	export let open: boolean = false;
	export let title: string = 'Confermare azione?';
	export let message: string = '';
	export let confirmLabel: string = 'Conferma';
	export let cancelLabel: string = 'Annulla';
	/** Adds danger styling to the confirm button (red). */
	export let destructive: boolean = false;
	/** Disables both buttons + shows a spinner on confirm while true. */
	export let loading: boolean = false;

	const dispatch = createEventDispatcher<{ confirm: void; cancel: void }>();

	function onConfirm() {
		if (loading) return;
		dispatch('confirm');
	}
	function onCancel() {
		if (loading) return;
		dispatch('cancel');
	}
</script>

<Modal {open} dismissable={!loading} on:close={onCancel} maxWidth={420}>
	<h2 slot="title">{title}</h2>
	{#if message}
		<p class="msg">{message}</p>
	{/if}
	<slot />
	<svelte:fragment slot="actions">
		<button type="button" class="btn-secondary" on:click={onCancel} disabled={loading}>
			{cancelLabel}
		</button>
		<button
			type="button"
			class="btn-primary"
			class:destructive
			on:click={onConfirm}
			disabled={loading}
		>
			{#if loading}
				<span class="spinner" aria-hidden="true"></span>
				…
			{:else}
				{confirmLabel}
			{/if}
		</button>
	</svelte:fragment>
</Modal>

<style>
	.msg {
		margin: 0 0 6px;
		color: var(--fg);
		font-size: 13.5px;
		line-height: 1.5;
	}

	.btn-secondary {
		background: transparent;
	}

	.btn-primary {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--accent-fg);
		font-weight: 700;
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.btn-primary:hover:not(:disabled) {
		background: #ff7e55;
	}
	.btn-primary.destructive {
		background: var(--danger);
		border-color: var(--danger);
	}
	.btn-primary.destructive:hover:not(:disabled) {
		background: #f06d83;
	}
	.btn-primary:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.spinner {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		border: 2px solid currentColor;
		border-right-color: transparent;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
