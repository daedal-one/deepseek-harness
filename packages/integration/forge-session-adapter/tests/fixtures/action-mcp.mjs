import { createInterface } from 'node:readline'

const tools = [
  'workspace_read',
  'workspace_apply',
  'workspace_run',
  'workspace_reconcile',
  'workspace_watermarks',
].map(name => ({
  name,
  description: `fixture ${name}`,
  inputSchema: { type: 'object', additionalProperties: true },
}))

for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line)
  if (request.id === undefined) continue
  let result
  if (request.method === 'initialize') {
    result = {
      protocolVersion: '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'fixture-action-mcp', version: '1' },
    }
  } else if (request.method === 'tools/list') {
    result = { tools }
  } else if (request.method === 'tools/call') {
    result = {
      content: [{ type: 'text', text: JSON.stringify({ protocol_version: 'forge-intellect-action-tools/v1' }) }],
      structuredContent: {
        protocol_version: 'forge-intellect-action-tools/v1',
        action_id: '00000000-0000-4000-8000-000000000001',
        watermarks: { ledger_sequence: 1, tree_digest: 'fixture-tree' },
      },
      isError: false,
    }
  } else {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'not found' } })}\n`)
    continue
  }
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`)
}
