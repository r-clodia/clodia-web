<script lang="ts">
	import { onMount } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/stores';
	import { getTopics } from '$lib/api/client';
	import type { Topic } from '$lib/api/types';
	import { theme, fontScale, toggleTheme, incFont, decFont } from '$lib/stores/prefs';
	import { session, logout as sessionLogout } from '$lib/auth/session';
	import { instanceProfile, ensureProfileLoaded, singleTopicHref, term } from '$lib/stores/instance';
	import { API_BASE_URL } from '$lib/api/client';

	// Icone Unicode per ogni route
	const ICONS: Record<string, string> = {
		'/agents':    '⬡',
		'/activity':  '≋',
		'/jobs':      '◷',
		'/packs':     '❖',
		'/workflows': '⇄',
		'/tools':     '⨄',
		'/providers': '⛽︎',
		'/settings':  '⚙',
		'/topics':    '▤',
	};

	// Navigazione derivata dal profilo d'istanza (Modular Distro F2): il
	// backend è la fonte di verità, feature spenta = voce assente. Con profilo
	// FULL la lista è identica a quella storica. `disabled` = funzione
	type NavItem = { href: string; label: string; icon: string; disabled?: boolean };
	$: prof = $instanceProfile;
	$: items = [
		{ href: '/agents',    label: term(prof, 'agent', 'AGENTS', { plural: true, upper: true }),             icon: ICONS['/agents'] },
		...(prof.features.activity   ? [{ href: '/activity',  label: 'ACTIVITY',                                                                              icon: ICONS['/activity']  }] : []),
		...(prof.features.jobs       ? [{ href: '/jobs',      label: term(prof, 'job',         'JOBS',         { plural: true, upper: true }), icon: ICONS['/jobs']      }] : []),
		...(prof.features.packs_ui   ? [{ href: '/packs',     label: 'PACKS',                                                                                 icon: ICONS['/packs']     }] : []),
		...(prof.features.workflows  ? [{ href: '/workflows', label: 'WORKFLOWS',                                                                              icon: ICONS['/workflows'] }] : []),
		...(prof.features.integrations !== 'off' ? [{ href: '/tools',     label: term(prof, 'integration', 'INTEGRATIONS', { plural: true, upper: true }), icon: ICONS['/tools']     }] : []),
		...(prof.features.providers_ui ? [{ href: '/providers', label: term(prof, 'provider', 'PROVIDERS', { plural: true, upper: true }),                   icon: ICONS['/providers'] }] : []),
		{ href: '/settings',  label: 'SETTINGS',                                                                                                               icon: ICONS['/settings']  },
		...(prof.features.topics === 'off'
			? []
			: [{
					href: prof.features.topics === 'single' ? singleTopicHref(prof) : '/topics',
					label: term(prof, 'topic', 'TOPICS', { plural: true, upper: true }),
					icon: ICONS['/topics']
				}])
	] as NavItem[];

	// Branding: solo per le edizioni custom (full = aspetto storico invariato).
	$: brandName = prof.edition !== 'full' && prof.branding.name ? prof.branding.name : 'Clodia';
	$: brandLogo = prof.edition !== 'full' && prof.branding.logo ? `${API_BASE_URL}/profile/logo` : '';
	$: if (typeof document !== 'undefined' && prof.edition !== 'full' && prof.branding.name) {
		document.title = prof.branding.name;
	}
	$: if (typeof document !== 'undefined') {
		if (prof.edition !== 'full' && prof.branding.accent) {
			document.documentElement.style.setProperty('--accent', prof.branding.accent);
		}
	}

	// Stato collapsed — persistito in localStorage
	let collapsed = false;

	function toggleCollapse() {
		collapsed = !collapsed;
		try { localStorage.setItem('sidebar-collapsed', collapsed ? '1' : '0'); } catch {}
	}

	let recentTopics: Topic[] = [];

	function topicHref(t: Topic): string {
		return `/topics/${encodeURIComponent(t.tier)}/${encodeURIComponent(t.name)}`;
	}

	function topicTime(t: Topic): number {
		const raw = t.last_accessed || t.last_commit || '';
		const ms = Date.parse(raw);
		return Number.isNaN(ms) ? 0 : ms;
	}

	async function loadRecentTopics() {
		if ($instanceProfile.features.topics === 'off') {
			recentTopics = [];
			return;
		}
		try {
			recentTopics = (await getTopics())
				.filter((t) => t.kind !== 'dm')
				.toSorted((a, b) => topicTime(b) - topicTime(a))
				.slice(0, 5);
		} catch {
			recentTopics = [];
		}
	}

	onMount(() => {
		try { collapsed = localStorage.getItem('sidebar-collapsed') === '1'; } catch {}
		void ensureProfileLoaded().then(loadRecentTopics);
	});
	// Al login/claim la sessione compare senza reload di pagina: il primo
	// fetch di /profile può essere avvenuto dietro il bootstrap gate (423,
	// → fallback FULL). Alla comparsa della sessione si riprova.
	$: if ($session) void ensureProfileLoaded().then(loadRecentTopics);
	afterNavigate(() => {
		void loadRecentTopics();
	});

	function isActive(href: string, pathname: string): boolean {
		if (href === '/') return pathname === '/';
		// Le pagine dettaglio skill/rule appartengono alla sezione Packs.
		if (href === '/packs' && (pathname.startsWith('/skills') || pathname.startsWith('/rules')))
			return true;
		return pathname === href || pathname.startsWith(href + '/');
	}
	// Versione di piattaforma (tag collettivo). Override a build-time via
	// PUBLIC_APP_VERSION; fallback al tag corrente.
	const APP_VERSION = (import.meta.env.PUBLIC_APP_VERSION as string | undefined) || 'v6.0';
</script>

<aside class="sidebar" class:collapsed>
	{#if collapsed}
		<button
			class="reopen-btn"
			type="button"
			on:click={toggleCollapse}
			title="Espandi navigazione"
			aria-label="Espandi navigazione"
		>
			▤
		</button>
	{:else}
	<div class="brand">
		{#if brandLogo}
			<img class="brand-logo" src={brandLogo} alt={brandName} />
		{:else}
			<span class="brand-mark">●</span>
		{/if}
		<span class="brand-name">{brandName}</span>
		<span class="brand-tag">{APP_VERSION}</span>
		<button
			class="collapse-btn"
			type="button"
			on:click={toggleCollapse}
			title="Comprimi navigazione"
			aria-label="Comprimi navigazione"
		>
			‹
		</button>
	</div>

	<nav class="nav" aria-label="Primary">
		{#each items as item}
			{#if item.disabled}
				<span class="nav-item disabled" aria-disabled="true" title="Coming soon">
					<span class="nav-icon">{item.icon}</span>
					<span class="nav-label">{item.label}</span>
					<span class="soon">soon</span>
				</span>
			{:else}
				<a
					class="nav-item"
					class:active={isActive(item.href, $page.url.pathname)}
					href={item.href}
					aria-current={isActive(item.href, $page.url.pathname) ? 'page' : undefined}
				>
					<span class="nav-icon">{item.icon}</span>
					<span class="nav-label">{item.label}</span>
				</a>
			{/if}
		{/each}
	</nav>

	{#if recentTopics.length}
		<section class="recent" aria-label="Topic recenti">
			<div class="recent-title">{term($instanceProfile, 'topic', '', { plural: true, upper: true }) ? `${term($instanceProfile, 'topic', '', { plural: true, upper: true })} RECENTI` : 'RECENT TOPICS'}</div>
			<div class="recent-list">
				{#each recentTopics as t (`${t.tier}/${t.name}`)}
					<a
						class="recent-topic"
						class:active={isActive(topicHref(t), $page.url.pathname)}
						href={topicHref(t)}
						title={t.title || t.name}
					>
						<span class="recent-name">{t.title || t.name}</span>
						<span class="recent-tier">{t.tier}</span>
					</a>
				{/each}
			</div>
		</section>
	{/if}

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
	{/if}

</aside>

<style>
	.account { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 8px; margin-bottom: 8px; font-size: 11px; }
	.acct-who { color: var(--sidebar-fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.acct-btn { background: transparent; border: 1px solid var(--border); color: var(--sidebar-fg); font: inherit; font-size: 11px; padding: 3px 9px; border-radius: 6px; cursor: pointer; white-space: nowrap; }
	.acct-btn:hover { border-color: var(--accent); color: var(--accent); }

	.sidebar {
		display: flex;
		flex-direction: column;
		/* flex-basis fisso + flex-shrink:0: la sidebar non cede mai alla
		   compressione del sibling `.main`. Senza, un contenuto largo nel main
		   (es. chat di topic con canvas/preview o blocchi di codice) scaricava
		   l'overflow orizzontale sulla sidebar, restringendola sotto
		   --sidebar-width e troncando le label (overflow:hidden). */
		flex: 0 0 var(--sidebar-width);
		width: var(--sidebar-width);
		height: 100%;
		min-height: 0;
		background: var(--sidebar-bg);
		color: var(--sidebar-fg);
		padding: 18px 10px;
		border-right: 1px solid var(--border);
		position: sticky;
		top: 0;
		transition: width 0.2s ease;
		overflow: hidden;
	}
	.sidebar.collapsed {
		flex: 0 0 48px;
		width: 48px;
		padding: 14px 6px;
		align-items: center;
	}

	.reopen-btn {
		background: transparent;
		border: 1px solid var(--border);
		color: var(--sidebar-fg-muted);
		border-radius: 6px;
		width: 34px;
		height: 34px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 17px;
		line-height: 1;
		cursor: pointer;
		padding: 0;
		transition: border-color 0.12s, color 0.12s;
	}
	.reopen-btn:hover { border-color: var(--accent); color: var(--accent); }

	.brand {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 2px 6px 16px;
		border-bottom: 1px solid var(--border);
		margin-bottom: 12px;
		min-width: 0;
	}
	.brand-logo { width: 20px; height: 20px; flex-shrink: 0; object-fit: contain; border-radius: 4px; }
	.brand-mark {
		color: var(--accent);
		font-size: 15px;
		line-height: 1;
		flex-shrink: 0;
	}
	.brand-name {
		font-weight: 600;
		font-size: 13px;
		letter-spacing: 0.02em;
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.brand-tag {
		font-size: 10px;
		color: var(--sidebar-fg-muted);
		text-transform: uppercase;
		white-space: nowrap;
	}
	.collapse-btn {
		margin-left: auto;
		flex-shrink: 0;
		background: transparent;
		border: 1px solid var(--border);
		color: var(--sidebar-fg-muted);
		border-radius: 4px;
		width: 22px;
		height: 22px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 14px;
		cursor: pointer;
		line-height: 1;
		padding: 0;
		transition: border-color 0.12s, color 0.12s;
	}
	.collapse-btn:hover { border-color: var(--accent); color: var(--accent); }

	.nav {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex: 0 0 auto;
		min-height: 0;
	}

	.nav-item {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 10px;
		border-radius: 6px;
		color: var(--sidebar-fg);
		font-size: 11.5px;
		font-weight: 500;
		letter-spacing: 0.06em;
		transition: background 0.12s ease, color 0.12s ease;
		white-space: nowrap;
		overflow: hidden;
		position: relative;
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
	}
	.nav-item.disabled:hover {
		background: transparent;
		color: var(--sidebar-fg);
	}

	.nav-icon {
		flex-shrink: 0;
		font-size: 14px;
		width: 18px;
		text-align: center;
		line-height: 1;
	}
	.nav-label {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* In collapsed mode i nav-item mostrano il tooltip via title nativo del browser. */

	.soon {
		font-size: 8.5px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		border: 1px solid currentColor;
		border-radius: 999px;
		padding: 0 5px;
		opacity: 0.8;
		margin-left: auto;
	}

	.recent {
		margin: 12px 0 0;
		padding: 10px 0 0;
		border-top: 1px solid var(--border);
		min-height: 0;
	}
	.recent-title {
		padding: 0 8px 5px;
		color: var(--sidebar-fg-muted);
		font-size: 9.5px;
		font-weight: 700;
		letter-spacing: 0.08em;
	}
	.recent-list {
		display: flex;
		flex-direction: column;
		gap: 3px;
		max-height: 190px;
		overflow-y: auto;
	}
	.recent-topic {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 8px 6px 10px;
		border-radius: 6px;
		color: var(--sidebar-fg);
		font-size: 11px;
		text-decoration: none;
	}
	.recent-topic:hover {
		background: rgba(255, 255, 255, 0.04);
		color: #fff;
	}
	.recent-topic.active {
		background: rgba(255, 107, 61, 0.12);
		color: var(--accent);
	}
	.recent-name {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.recent-tier {
		flex: 0 0 auto;
		color: var(--sidebar-fg-muted);
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.04em;
	}
	.spacer {
		flex: 1 1 auto;
		min-height: 10px;
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
		min-width: 30px;
		height: 28px;
		padding: 0 7px;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: transparent;
		color: var(--sidebar-fg);
		font-size: 12px;
		cursor: pointer;
		transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
	}
	.pref-btn:hover {
		background: rgba(255, 255, 255, 0.06);
		border-color: var(--accent);
		color: var(--accent);
	}
</style>
