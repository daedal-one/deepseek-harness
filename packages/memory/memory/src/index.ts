/** Durable reviewed-memory Service Definition. @module @deepseek-ai/dsh-memory */
import { Context, Service } from '@deepseek-ai/cordis'
import type { MemoryChallenge, MemoryCheckpoint, MemoryId, MemoryProposal, MemoryProvider, MemoryQuery, MemoryQueryResult, MemoryRecord, MemoryRef, MemoryReview, MemoryScope, MemorySupersession } from './types.ts'
import { MemoryError } from './types.ts'

export * from './types.ts'

declare module '@deepseek-ai/cordis' { interface Context { memory: MemoryRuntime } }

/** Provider-selecting durable-memory runtime. */
export class MemoryRuntime extends Service {
  private readonly providers = new Map<string, MemoryProvider>()

  constructor(ctx: Context) { super(ctx, 'memory') }

  /**
   * Register one storage provider for the calling fiber.
   * @param provider - storage implementation and stable provider id.
   * @returns the effect-owned registration disposer.
   */
  registerProvider(provider: MemoryProvider): () => void {
    if (this.providers.has(provider.id)) throw new MemoryError(`memory provider "${provider.id}" is already registered`, 'MEMORY_DUPLICATE_PROVIDER')
    const providers = this.providers
    const dispose = this.ctx.effect(function* () { providers.set(provider.id, provider); yield () => providers.delete(provider.id) }, 'memory.registerProvider()')
    return () => void dispose()
  }

  /**
   * Query one explicit memory scope.
   * @param request - scoped text, statuses, temporal point, and limit.
   * @returns bounded matching records.
   */
  query(request: MemoryQuery): Promise<MemoryQueryResult> { return this.provider().query(request) }
  /**
   * Read one id only inside its explicit scope.
   * @param scope - exact project or global scope.
   * @param id - branded memory identifier.
   * @returns the record, or undefined when absent from that scope.
   */
  get(scope: MemoryScope, id: MemoryId): Promise<MemoryRecord | undefined> { return this.provider().get(scope, id) }
  /**
   * Persist an unreviewed proposal.
   * @param request - scoped statement, evidence, trust, validity, and contradictions.
   * @returns the created proposal record.
   */
  propose(request: MemoryProposal): Promise<MemoryRecord> { return this.provider().propose(request) }
  /**
   * Challenge one exact scope-bound revision.
   * @param request - compare-and-set ref, reason, and contrary evidence.
   * @returns the challenged record revision.
   */
  challenge(request: MemoryChallenge): Promise<MemoryRecord> { return this.provider().challenge(request) }
  /**
   * Accept or reject one exact scope-bound revision.
   * @param request - compare-and-set ref and reviewer decision.
   * @returns the reviewed record revision.
   */
  review(request: MemoryReview): Promise<MemoryRecord> { return this.provider().review(request) }
  /**
   * Atomically supersede one exact scope-bound revision.
   * @param request - prior ref and same-scope replacement.
   * @returns the previous and replacement records after commit.
   */
  supersede(
    request: MemorySupersession,
  ): Promise<{ readonly previous: MemoryRecord; readonly replacement: MemoryRecord }> {
    return this.provider().supersede(request)
  }
  /**
   * Checkpoint use of exact scope-bound memory revisions.
   * @param request - unique compare-and-set refs.
   * @returns the revisioned records with updated access facts.
   */
  checkpoint(request: MemoryCheckpoint): Promise<readonly MemoryRecord[]> { return this.provider().checkpoint(request) }
  /**
   * Delete one exact scope-bound revision.
   * @param ref - exact scope, id, and revision.
   * @returns whether the record was deleted.
   */
  delete(ref: MemoryRef): Promise<boolean> { return this.provider().delete(ref) }

  private provider(): MemoryProvider {
    const providers = [...this.providers.values()]
    if (providers.length === 0) throw new MemoryError('no memory provider is registered', 'MEMORY_PROVIDER_UNAVAILABLE')
    if (providers.length !== 1) throw new MemoryError(`multiple memory providers are registered (${providers.map(provider => provider.id).join(', ')})`, 'MEMORY_PROVIDER_AMBIGUOUS')
    return providers[0] as MemoryProvider
  }
}

export default MemoryRuntime
