/**
 * Starter templates shown in the "+ New agent" form.
 *
 * The agent-server does NOT expose `/api/agents/templates` today; the list
 * lives client-side and ships three opinionated starting points:
 *
 *  - `empty`       — bare minimum, no skills.
 *  - `interactive` — a chat-first agent intended for direct conversations
 *                    via /chats.
 *
 * Each template's `defaults` populates the form fields; `systemPromptBody`
 * is used as a starting prompt body that the user can edit before submit.
 */

import type { AgentTemplate } from './api/types';

export const AGENT_TEMPLATES: ReadonlyArray<AgentTemplate> = [
	{
		id: 'empty',
		label: 'Empty',
		description: 'Bare minimum — name, description, model. No skills or Trello binding.',
		defaults: {
			name: '',
			description: '',
			model: 'claude-opus-4-7',
			avatar_color: '#888888',
			skills: [],
			can_delegate_to: []
		},
		systemPromptBody:
			'# Agent\n\nDescrivi qui il ruolo e i compiti dell\'agente.\n'
	},
	{
		id: 'interactive',
		label: 'Interactive',
		description: 'Chat-first — risponde direttamente nelle chat (/clodia/chats). Nessuna lane Trello.',
		defaults: {
			name: '',
			description: '',
			model: 'claude-opus-4-7',
			avatar_color: '#4a6cff',
			skills: [],
			can_delegate_to: []
		},
		systemPromptBody:
			'# Agent\n\nSei un agente conversazionale. Rispondi in tono diretto e professionale. Quando hai bisogno di chiarimenti, chiedi prima di assumere.\n'
	}
];
