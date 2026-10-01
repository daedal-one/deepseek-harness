export const name = 'maintenance-fixture-tool'
export const inject = ['tools']
export function apply(ctx) {
  ctx.effect(() => ctx.tools.register({
    name: 'inspect_host_fixture', description: 'Report fixture host readiness.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: { schema: { type: 'string' }, render: (_args, result) => [{ type: 'text', text: result }] },
    execute: async () => 'ready',
  }))
}
