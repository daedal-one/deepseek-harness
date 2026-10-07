/**
 * The model-catalog capability seam: the Service Definition a routing consumer
 * injects and a provider implements.
 *
 * The seam exists so a routing decision never performs a provider network read
 * itself. A provider owns how candidates are fetched, cached, and priced, and
 * exposes them as one revisioned snapshot so a consumer can memoize a
 * resolution without re-reading anything.
 *
 * @module @deepseek-ai/dsh-model-routing/catalog
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { RoutingCandidate } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Live candidate models and prices for one provider route. */
    modelCatalog: ModelCatalog
  }
}

/** One consistent view of a provider's candidate models. */
export interface ModelCatalogSnapshot {
  /**
   * Opaque revision of the catalog contents. A consumer compares two revisions
   * to decide whether a memoized resolution still holds; any change to the
   * candidate set or its prices must produce a different value.
   */
  readonly revision: string
  /** Every candidate the provider route currently offers. */
  readonly candidates: readonly RoutingCandidate[]
}

/**
 * Service Definition for the live model catalog.
 *
 * A provider implements {@link snapshot}, which must stay cheap for a repeated
 * read of unchanged contents: the routing policy calls it on the request path
 * and relies on the provider's own caching to keep an unchanged catalog off the
 * network.
 */
export abstract class ModelCatalog extends Service {
  /**
   * @param ctx - the owning scope's context.
   */
  constructor(ctx: Context) {
    super(ctx, 'modelCatalog')
  }

  /**
   * Read the provider's current candidates and their revision.
   * @param provider - registered provider route to inspect.
   * @param signal - optional caller cancellation for a provider-owned read.
   * @returns one consistent snapshot of candidates and their revision.
   */
  abstract snapshot(provider: string, signal?: AbortSignal): Promise<ModelCatalogSnapshot>
}
