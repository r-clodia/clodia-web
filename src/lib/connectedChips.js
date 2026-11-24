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

/** `SEAL-2/moneyviz-2026` → `moneyviz-2026`.
 * @param {string} topic */
function codeName(topic) {
	const i = topic.indexOf('/');
	return i >= 0 ? topic.slice(i + 1) : topic;
}

/**
 * The name a person reads for an imported resource. A topic's RAG index
 * (`topic-fee7cb30`) reads as that topic's CODE NAME: this topic's own when it
 * is its index, the catalog's `topic` for another topic's index (admins get
 * it). Anything else: the short data name.
 * @param {{ kind: string, name: string }} imp
 * @param {Record<string, { topic?: string }>} byName  catalog entries by name
 * @param {string} ownIndex   this topic's own index collection
 * @param {string} ownName    this topic's code name
 */
export function importLabel(imp, byName, ownIndex, ownName) {
	if (imp.kind === 'rag' && ownIndex && imp.name === ownIndex && ownName) return ownName;
	const e = byName[imp.name];
	if (imp.kind === 'rag' && e && e.topic) return codeName(e.topic);
	return shortDataName(imp.name);
}

/**
 * @param {{ mcp?: Record<string, unknown>, mcp_catalogue?: Record<string, { label?: string }> } | null} box
 * @param {ReadonlyArray<{ kind: string, name: string }> | null | undefined} imports
 * @param {ReadonlyArray<{ name: string, topic?: string }>} [catalog]  the data catalog entries
 * @param {string} [ownIndex]  this topic's own index collection
 * @param {string} [ownName]   this topic's code name
 * @returns {Chip[]}
 */
export function connectedChips(box, imports, catalog, ownIndex = '', ownName = '') {
	/** @type {Record<string, { topic?: string }>} */
	const byName = {};
	for (const e of catalog || []) byName[e.name] = e;
	/** @type {Chip[]} */
	const out = [];
	const cat = (box && box.mcp_catalogue) || {};
	for (const id of Object.keys((box && box.mcp) || {}).sort()) {
		const label = (cat[id] && cat[id].label) || id;
		out.push({ kind: 'mcp', id, label, title: `${KIND.mcp} · ${label}`, icon: ICON.mcp });
	}
	/** @type {Chip[]} */
	const data = [];
	for (const i of imports || []) {
		const kind = i.kind === 'rag' ? 'rag' : 'datastore';
		const label = importLabel(i, byName, ownIndex, ownName);
		const title = label === shortDataName(i.name) ? `${KIND[kind]} · ${i.name}`
			: `${KIND[kind]} · indice del topic ${label} (${i.name})`;
		data.push({ kind, id: i.name, label, title, icon: ICON[kind] });
	}
	// By the name a person reads, not by the technical id.
	data.sort((a, b) => a.label.localeCompare(b.label));
	return [...out, ...data];
}
