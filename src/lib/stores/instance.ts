/**
 * Store del profilo d'istanza (Modular Distro F2).
 *
 * La webui NON decide nulla da sola: legge `GET /profile` dal backend e
 * deriva navigazione, branding e modalità (topics single, integrations
 * fixed). Fallback: finché il profilo non è caricato — o se l'endpoint non
 * è raggiungibile (backend pre-6.60) — si assume il profilo FULL, cioè il
 * comportamento storico della webui.
 */
import { writable, type Readable } from 'svelte/store';
import { getInstanceProfile } from '$lib/api/client';
import type { InstanceProfile } from '$lib/api/types';

export const FULL_PROFILE: InstanceProfile = {
	edition: 'full',
	features: {
		jobs: true,
		topics: 'full',
		rag: 'full',
		integrations: 'full',
		channels: true,
		packs_ui: true,
		providers_ui: true,
		activity: true,
		pwa: true,
		helpdesk: true,
		kanban: false,
		colony: false
	},
	branding: { name: 'Clodia Agency', logo: '', accent: '' },
	rag: {},
	helpdesk: { agent: 'wainston' },
	vocabulary: {},
	integrations: { allow_manual_mcp: false },
	topics_single: {},
	topics_defaults: {}
};

const _store = writable<InstanceProfile>(FULL_PROFILE);
export const instanceProfile: Readable<InstanceProfile> = { subscribe: _store.subscribe };

let _loaded = false;
let _inflight: Promise<void> | null = null;

/** Carica il profilo una sola volta (idempotente; riusa la richiesta in volo). */
export function ensureProfileLoaded(): Promise<void> {
	if (_loaded) return Promise.resolve();
	if (_inflight) return _inflight;
	_inflight = getInstanceProfile()
		.then((p) => {
			// merge difensivo: campi mancanti (backend più vecchio) → default full
			_store.set({
				...FULL_PROFILE,
				...p,
				features: { ...FULL_PROFILE.features, ...(p.features || {}) },
				branding: { ...FULL_PROFILE.branding, ...(p.branding || {}) }
			});
			_loaded = true;
		})
		.catch(() => {
			// endpoint assente/errore → profilo FULL (comportamento storico)
			_store.set(FULL_PROFILE);
		})
		.finally(() => {
			_inflight = null;
		});
	return _inflight;
}

/** Href del topic-workspace unico (modalità topics: single). */
export function singleTopicHref(p: InstanceProfile): string {
	const tier = p.topics_single?.tier || 'SEAL-1';
	const name = p.topics_single?.name || 'workspace';
	return `/topics/${encodeURIComponent(tier)}/${encodeURIComponent(name)}`;
}

/**
 * Vocabolario dell'edizione (white-label cosmetico). `term()` risolve un
 * termine canonico nelle forme del cliente; senza mapping ritorna il
 * default passato (= stringa storica → zero cambiamenti).
 */
export function term(
	p: InstanceProfile,
	key: string,
	fallback: string,
	opts: { plural?: boolean; upper?: boolean; cap?: boolean } = {}
): string {
	const v = p.vocabulary?.[key];
	let out = '';
	if (typeof v === 'string') out = v;
	else if (v && typeof v === 'object') {
		out = (opts.plural ? v.plurale || v.singolare : v.singolare) || '';
	}
	if (!out) out = fallback;
	if (opts.upper) out = out.toUpperCase();
	else if (opts.cap && out) out = out.charAt(0).toUpperCase() + out.slice(1);
	return out;
}
