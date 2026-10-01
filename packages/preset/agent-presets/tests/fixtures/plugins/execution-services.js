export const name = 'execution-services'
export function apply(ctx, config) {
  for (const name of config.services) {
    ctx.effect(() => ctx.reflect.provide(name, { executionWorld: Symbol.for(config.world) }))
  }
}
