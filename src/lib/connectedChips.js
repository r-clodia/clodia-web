/**
 * What a room has connected through 🔌 — its authorised MCPs and the data
 * imported into the topic — as the chips of the chat input's button row
 * (owner, 24 Nov 2026). Pure, in `.js` so the guard script can execute it.
 */

/** @typedef {{ kind: 'mcp' | 'rag' | 'datastore', id: string, label: string, title: string, icon: string }} Chip */

const ICON = { mcp: '🧩', rag: '📚', datastore: '🗄' };
const KIND = { mcp: 'MCP', rag: 'RAG', datastore: 'DB' };

/** `assetti-contabili/contabilita:studio-davidecarboni` → `studio-davidecarboni`;
 *  `tomato-pack/clienti` → `clienti`: the part a person recognises.
 * @param {string} name */
export function shortDataName(name) {
	const n = String(name || '');
	const afterColon = n.includes(':') ? n.slice(n.lastIndexOf(':') + 1) : n;
	return afterColon.includes('/') ? afterColon.slice(afterColon.lastIndexOf('/') + 1) : afterColon;
}

/**
 * @param {{ mcp?: Record<string, unknown>, mcp_catalogue?: Record<string, { label?: string }> } | null} box
 * @param {ReadonlyArray<{ kind: string, name: string }> | null | undefined} imports
 * @returns {Chip[]}
 */
export function connectedChips(box, imports) {
	/** @type {Chip[]} */
	const out = [];
	const cat = (box && box.mcp_catalogue) || {};
	for (const id of Object.keys((box && box.mcp) || {}).sort()) {
		const label = (cat[id] && cat[id].label) || id;
		out.push({ kind: 'mcp', id, label, title: `${KIND.mcp} · ${label}`, icon: ICON.mcp });
	}
	for (const i of [...(imports || [])].sort((a, b) => String(a.name).localeCompare(String(b.name)))) {
		const kind = i.kind === 'rag' ? 'rag' : 'datastore';
		out.push({ kind, id: i.name, label: shortDataName(i.name), title: `${KIND[kind]} · ${i.name}`, icon: ICON[kind] });
	}
	return out;
}
