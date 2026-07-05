import { sveltekit } from '@sveltejs/kit/vite';
import type { IncomingMessage } from 'node:http';
import { defineConfig } from 'vite';

// Forward fetch/XHR (JSON) to the agent-server, but let SPA navigations
// (Accept: text/html) fall through to the static SvelteKit fallback.
// Default: Docker service name. Per dev locale: API_TARGET=http://localhost:7842
const API = process.env.API_TARGET || 'http://agent-server:7842';
// Backend UI del gateway clodia-tools (sezione Tools / connettori OAuth).
// Wire diretto webui → clodia-tools. Dev locale: TOOLS_API_TARGET=http://localhost:7849
const TOOLS_API = process.env.TOOLS_API_TARGET || 'http://clodia-tools:7849';
// Bearer opzionale: iniettato lato proxy → il token resta server-side, mai nel browser.
const TOOLS_TOKEN = process.env.CLODIA_TOOLS_UI_TOKEN;

// `/topics` is special: it is BOTH an SPA route (the Topics page) AND an API
// prefix (`/topics`, `/topics/{classification}/...`). A plain proxy shadows
// the SPA route, so a browser navigation to /topics receives raw JSON. The
// `bypass` discriminates by Accept header: HTML navigations are served the
// SPA fallback (index.html); everything else (the client's `Accept:
// application/json` fetches) is proxied.
function htmlBypass(req: IncomingMessage): string | undefined {
	const url = req.url || '';
	// Gli endpoint binari /download e /file sono SEMPRE API: anche una
	// navigazione HTML (click su un <a> → Accept: text/html) va proxata, altrimenti
	// riceve la SPA e la rotta client non esiste → 404 sul file.
	if (/\/(download|file)(\?|$)/.test(url)) {
		return undefined;
	}
	const accept = req.headers.accept || '';
	if (req.method === 'GET' && accept.includes('text/html')) {
		return req.url;
	}
	// undefined → request is proxied to `target`.
}

// La webui è servita SEMPRE dietro un reverse proxy / `tailscale serve` (accesso
// già ristretto al tailnet o al proxy). L'host-check di `vite preview` (difesa
// anti DNS-rebinding) è qui ridondante e bloccherebbe ogni host non-localhost —
// es. `*.ts.net` → "This host is not allowed". Default permissivo; restringibile
// per-istanza con CLODIA_ALLOWED_HOSTS (lista comma-separated di hostname).
const _allowed = (process.env.CLODIA_ALLOWED_HOSTS || '')
	.split(',').map((s) => s.trim()).filter(Boolean);
const ALLOWED_HOSTS = _allowed.length ? _allowed : true;

export default defineConfig({
	envPrefix: ['VITE_', 'PUBLIC_'],
	plugins: [sveltekit()],
	server: {
		port: 7843,
		strictPort: true,
		allowedHosts: ALLOWED_HOSTS
	},
	preview: {
		port: 7843,
		strictPort: true,
		host: true,
		allowedHosts: ALLOWED_HOSTS,
		proxy: {
			'/api': { target: API, changeOrigin: true },
			'/clodia': { target: API, changeOrigin: true },
			'/daemons': { target: API, changeOrigin: true },
			'/topics': { target: API, changeOrigin: true, bypass: htmlBypass },
			'/health': { target: API, changeOrigin: true },
			'/profile': { target: API, changeOrigin: true },
			'/auth': { target: API, changeOrigin: true },
			// `/tools` è SIA route SPA (pagina Tools) SIA prefisso API del gateway:
			// htmlBypass serve la SPA alle navigazioni HTML, proxa le fetch JSON.
			'/tools': {
				target: TOOLS_API,
				changeOrigin: true,
				bypass: htmlBypass,
				headers: TOOLS_TOKEN ? { Authorization: `Bearer ${TOOLS_TOKEN}` } : undefined
			}
		}
	}
});
