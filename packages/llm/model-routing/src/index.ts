/**
 * Task-class model routing: resolve a declared class of work into a concrete
 * provider route by ranking the live catalog.
 *
 * @module @deepseek-ai/dsh-model-routing
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { rankTaskClass } from './rank.ts'
import { TASK_CLASS_SPEC_SCHEMA, assertTaskClasses, taskClassId } from './spec.ts'
import type { TaskClassTable } from './spec.ts'
import type { RoutingResult, TaskClassId, TaskClassSpec } from './types.ts'

export type * from './types.ts'
export type * from './catalog.ts'
export * from './rank.ts'
export * from './spec.ts'
export { ModelCatalog } from './catalog.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Deployment-declared task classes and their resolution policy. */
    modelRouting: ModelRouting
  }
}

/** Composition fields of the routing policy. */
export interface Config {
  /** Declared task classes keyed by id. */
  classes?: TaskClassTable
}

/** One memoized resolution and the catalog revision it was computed from. */
interface MemoEntry {
  readonly revision: string
  readonly result: RoutingResult
}

/**
 * Owns the deployment's declared task classes and resolves one into a route.
 *
 * Resolution is a function of the declared class and one catalog snapshot, so
 * the same inputs always produce the same route. A result is memoized against
 * the catalog revision it was computed from, which keeps a repeated step of one
 * turn from re-ranking an unchanged catalog.
 *
 * The service selects within the provider route it is asked about and never
 * reaches for another: provider choice stays a deployment decision.
 */
export class ModelRouting extends Service {
  static inject = ['modelCatalog']

  static Config: z<Config> = z.object({
    classes: z.dict(TASK_CLASS_SPEC_SCHEMA).default({}),
  })

  private readonly classes: Readonly<Record<TaskClassId, TaskClassSpec>>
  private readonly memo = new Map<string, MemoEntry>()

  /**
   * @param ctx - the owning scope's context.
   * @param config - declared task classes.
   * @throws {TypeError} for a class id that is not lowercase kebab-case.
   * @throws {Error} for a class whose tiers or cost basis cannot express a preference.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'modelRouting')
    // Cordis supplies the schema default; the fallback also covers direct construction.
    /* v8 ignore next */
    this.classes = assertTaskClasses(config.classes ?? {})
  }

  /**
   * List the declared class ids in stable order.
   * @returns the ids, sorted ascending.
   */
  classIds(): readonly TaskClassId[] {
    return (Object.keys(this.classes) as TaskClassId[]).sort()
  }

  /**
   * Read one declared class.
   * @param id - the class to read.
   * @returns the declared class.
   * @throws {Error} naming an undeclared class.
   */
  specOf(id: TaskClassId): TaskClassSpec {
    const spec = this.classes[id]
    if (spec === undefined) throw new Error(`model routing: unknown task class "${String(id)}"`)
    return spec
  }

  /**
   * Resolve one declared class against a provider route's live catalog.
   * @param id - the declared class to resolve.
   * @param provider - the deployment-authorized provider route to select within.
   * @param signal - optional caller cancellation for the catalog read.
   * @returns the selected route with its evidence, or an unsatisfied outcome naming the cause.
   * @throws {Error} when the class is not declared.
   */
  async resolve(id: TaskClassId, provider: string, signal?: AbortSignal): Promise<RoutingResult> {
    const spec = this.specOf(id)
    const snapshot = await this.ctx.modelCatalog.snapshot(provider, signal)
    const key = `${provider}\u0000${String(id)}`
    const cached = this.memo.get(key)
    if (cached !== undefined && cached.revision === snapshot.revision) return cached.result
    const result = rankTaskClass(id, spec, snapshot.candidates)
    this.memo.set(key, { revision: snapshot.revision, result })
    return result
  }

  /**
   * Drop every memoized resolution. A caller uses this after changing the
   * declared classes at runtime; a catalog change needs no call because the
   * revision comparison already invalidates it.
   */
  invalidate(): void {
    this.memo.clear()
  }

  /**
   * Read one declared class by its raw id, for a caller that holds an
   * unvalidated string from configuration or a tool argument.
   * @param value - candidate class id.
   * @returns the validated id.
   * @throws {TypeError} when the value is not lowercase kebab-case.
   */
  static idOf(value: string): TaskClassId {
    return taskClassId(value)
  }
}

export default ModelRouting
