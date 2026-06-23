// SPA mode — disable SSR so the static adapter produces a single
// index.html that hydrates on the client and routes purely in the browser.
export const ssr = false;
export const prerender = false;
export const trailingSlash = 'never';
