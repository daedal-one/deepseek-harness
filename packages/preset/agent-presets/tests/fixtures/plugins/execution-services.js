export const name = 'execution-services'
export function apply(ctx, config) {
  for (const name of config.services) {
    ctx.effect(() => ctx.reflect.provide(name, config.world === null ? {} : { executionWorld: Symbol.for(config.world) }))
  }
}
