<script lang="ts">
	import { page } from '$app/stores';
	import { theme, fontScale, toggleTheme, incFont, decFont } from '$lib/stores/prefs';
	import { session, logout as sessionLogout } from '$lib/auth/session';

	// `disabled` = funzione disattivata in questa fase (kanban + colony parcheggiati):
	// la voce resta visibile ma in grigio e non cliccabile.
	const items = [
		{ href: '/agents', label: 'AGENTS' },
		{ href: '/activity', label: 'ACTIVITY' },
		{ href: '/jobs', label: 'JOBS' },
		{ href: '/skills', label: 'SKILLS' },
		{ href: '/rules', label: 'RULES' },
		{ href: '/topics', label: 'TOPICS' },
		{ href: '/kanban', label: 'KANBAN', disabled: true },
		{ href: '/tools', label: 'INTEGRATIONS' },
		{ href: '/providers', label: 'PROVIDERS' }
	];

	function isActive(href: string, pathname: string): boolean {
		if (href === '/') return pathname === '/';
		return pathname === href || pathname.startsWith(href + '/');
	}
</script>

<aside class="sidebar">
	<div class="brand">
		<span class="brand-mark">●</span>
		<span class="brand-name">Clodia</span>
		<span class="brand-tag">v2</span>
	</div>

	<nav class="nav" aria-label="Primary">
		{#each items as item}
			{#if item.disabled}
				<span class="nav-item disabled" aria-disabled="true" title="Coming soon">
					{item.label}<span class="soon">soon</span>
				</span>
			{:else}
				<a
					class="nav-item"
					class:active={isActive(item.href, $page.url.pathname)}
					href={item.href}
					aria-current={isActive(item.href, $page.url.pathname) ? 'page' : undefined}
				>
					{item.label}
				</a>
			{/if}
		{/each}
	</nav>

	<div class="spacer"></div>

	{#if $session}
		<div class="account" aria-label="Utente connesso">
			<span class="acct-who" title={`Connesso come ${$session.principal}`}>👤 {$session.principal}</span>
			<button class="acct-btn" type="button" on:click={sessionLogout}>Esci</button>
		</div>
	{/if}

	<div class="prefs" aria-label="Preferenze aspetto">
		<button
			class="pref-btn"
			type="button"
			on:click={toggleTheme}
			title={$theme === 'dark' ? 'Passa al tema diurno' : 'Passa al tema notturno'}
			aria-label="Cambia tema"
		>
			{$theme === 'dark' ? '☀' : '☾'}
		</button>
		<div class="font-ctl" title="Dimensione testo ({Math.round($fontScale * 100)}%)">
			<button class="pref-btn" type="button" on:click={decFont} aria-label="Riduci testo">Aa−</button>
			<button class="pref-btn" type="button" on:click={incFont} aria-label="Aumenta testo">Aa+</button>
		</div>
	</div>

</aside>

<style>
	.account { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 8px; margin-bottom: 8px; font-size: 12px; }
	.acct-who { color: var(--sidebar-fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.acct-btn { background: transparent; border: 1px solid var(--border); color: var(--sidebar-fg); font: inherit; font-size: 11px; padding: 3px 9px; border-radius: 6px; cursor: pointer; }
	.acct-btn:hover { border-color: var(--accent); color: var(--accent); }
	.sidebar {
		display: flex;
		flex-direction: column;
		width: var(--sidebar-width);
		height: 100vh;
		background: var(--sidebar-bg);
		color: var(--sidebar-fg);
		padding: 18px 12px;
		border-right: 1px solid var(--border);
		position: sticky;
		top: 0;
	}

	.brand {
		display: flex;
		align-items: baseline;
		gap: 8px;
		padding: 4px 10px 18px;
		border-bottom: 1px solid var(--border);
		margin-bottom: 14px;
	}
	.brand-mark {
		color: var(--accent);
		font-size: 16px;
		line-height: 1;
	}
	.brand-name {
		font-weight: 600;
		letter-spacing: 0.02em;
	}
	.brand-tag {
		font-size: 11px;
		color: var(--sidebar-fg-muted);
		text-transform: uppercase;
	}

	.nav {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.nav-item {
		display: block;
		padding: 9px 12px;
		border-radius: 6px;
		color: var(--sidebar-fg);
		font-size: 12.5px;
		font-weight: 500;
		letter-spacing: 0.06em;
		transition: background 0.12s ease, color 0.12s ease;
	}
	.nav-item:hover {
		background: rgba(255, 255, 255, 0.04);
		color: #fff;
	}
	.nav-item.active {
		background: var(--accent);
		color: var(--accent-fg);
		font-weight: 700;
	}
	.nav-item.disabled {
		opacity: 0.4;
		cursor: not-allowed;
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.nav-item.disabled:hover {
		background: transparent;
		color: var(--sidebar-fg);
	}
	.soon {
		font-size: 8.5px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		border: 1px solid currentColor;
		border-radius: 999px;
		padding: 0 5px;
		opacity: 0.8;
	}
	.spacer {
		flex: 1 1 auto;
	}

	.prefs {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
		padding: 8px 4px 0;
		border-top: 1px solid var(--border);
	}
	.font-ctl {
		display: inline-flex;
		gap: 4px;
	}
	.pref-btn {
		min-width: 32px;
		height: 30px;
		padding: 0 8px;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: transparent;
		color: var(--sidebar-fg);
		font-size: 13px;
		cursor: pointer;
		transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
	}
	.pref-btn:hover {
		background: rgba(255, 255, 255, 0.06);
		border-color: var(--accent);
		color: var(--accent);
	}

</style>
