/**
 * Asset di brand serviti dalla WebUI.
 *
 * Il lockup del logo è disegnato per fondo scuro: la wordmark è crema, che su
 * bianco dà ~1.2:1 di contrasto. La pipeline `scripts/gen-brand-assets.py`
 * genera quindi due varianti del banner dallo stesso master, e qui scegliamo
 * quella giusta in base al tema attivo (vedi `$lib/stores/prefs`).
 */
import type { Theme } from '$lib/stores/prefs';

export function brandBanner(theme: Theme): string {
	return theme === 'light' ? '/clodia-brand-banner-light.png' : '/clodia-brand-banner.png';
}
