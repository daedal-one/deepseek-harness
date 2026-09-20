/** The sidebar namespace key union. */
export type SidebarKey = keyof typeof en

/** English copy for this feature. */
export const en = {
  'fork.name': 'Daedal Harness',
  'fork.open': 'About Daedal Harness',
  'fork.close': 'Close overview',
  'fork.eyebrow': 'THE DAEDAL FORK',
  'fork.title': 'Your agents. Your infrastructure.',
  'fork.intro': 'A Daedal fork of DeepSeek Harness, the open-source, plugin-based agent harness by DeepSeek AI.',
  'fork.changes': 'What this fork adds',
  'fork.models.title': 'Models on your terms',
  'fork.models.body': 'OpenRouter model routing and web search, Codex account sign-in, and model and reasoning controls for each agent role.',
  'fork.policy.title': 'Reviewed actions and memory',
  'fork.policy.body': 'Independent reviews of tool intent and effects, scoped MCP access, and durable project and global memory with review and approval controls.',
  'fork.workspace.title': 'Connected workspaces',
  'fork.workspace.body': 'Forge-managed sessions and Code workspaces, with attributable actions through Forge Intellect.',
  'fork.language.title': 'A consistent working environment',
  'fork.language.body': 'English product copy and documentation, an optional English-output guard, searchable plugin details, and output rates measured over the full request.',
  'fork.source': 'Explore this fork',
  'fork.upstream': 'DeepSeek upstream',
  'session.new': 'New Session',
  'session.new.label': 'New session',
  'toggle.open': 'Open sidebar',
  'toggle.collapse': 'Collapse sidebar',
  'panels.label': 'Global panels',
} satisfies Record<string, string>
