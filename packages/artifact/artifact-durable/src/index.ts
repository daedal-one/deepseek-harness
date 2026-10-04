/** Durable artifact provider with immutable bytes, Session publication, CAS, and retry receipts. @module */
import { createHash, randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Artifacts } from '@deepseek-ai/dsh-artifact'
import type {
  ArtifactPending,
  ArtifactAssetInput,
  ArtifactAsset,
  ArtifactContent,
  ArtifactId,
  ArtifactOperationId,
  ArtifactPage,
  ArtifactPublish,
  ArtifactRevision,
  ArtifactRevisionId,
} from '@deepseek-ai/dsh-artifact'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { SessionHandleReadResult } from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-attachment'
import type { DomainGlobal } from '@deepseek-ai/dsh-storage-domain'
import { artifactDomain } from './schema.ts'
import { validateDependencies } from './dependencies.ts'
import type { Ledger, Receipt } from './schema.ts'

/** Deployment admission and retention bounds; every value is explicit. */
export interface Config {
  /** Maximum accepted mutations, including the active operation. */
  maxQueuedOperations: number
  /** Maximum in-flight verified asset reads. */
  maxConcurrentReads: number
  /** Verified asset read deadline in milliseconds. */
  readTimeoutMs: number
  /** Maximum complete catalogue, revision or asset response bytes. */
  maxResponseBytes: number
  /** Maximum new reservations per Workspace rate interval. */
  maxRevisionsPerInterval: number
  /** Publication rate interval in milliseconds. */
  revisionIntervalMs: number
  /** Maximum decoded bytes per published asset. */
  maxAssetBytes: number
  /** Maximum complete input metadata and decoded asset bytes. */
  maxPublicationBytes: number
  /** Maximum explicit assets per revision. */
  maxAssets: number
  /** Maximum retained receipt bytes, reserved before asset capture. */
  maxMetadataBytes: number
  /** Maximum retained blob and receipt reservations per Workspace. */
  maxWorkspaceBytes: number
  /** Maximum retained blob and receipt reservations across Workspaces. */
  maxHostBytes: number
  /** Maximum retained publication reservations across Workspaces. */
  maxOperations: number
  /** Maximum committed revisions retained by one artifact. */
  maxRevisionsPerArtifact: number
  /** Maximum catalogue, history or recovery records per page. */
  pageSize: number
}
/** Positive integral deployment configuration. */
export const Config: z<Config> = z.object({
  maxQueuedOperations: z.number().step(1).min(1).required(),
  maxConcurrentReads: z.number().step(1).min(1).required(),
  readTimeoutMs: z.number().step(1).min(1).max(2147483647).required(),
  maxResponseBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
  maxRevisionsPerInterval: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
  revisionIntervalMs: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
  maxAssetBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
  maxPublicationBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
  maxAssets: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
  maxMetadataBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
  maxWorkspaceBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
  maxHostBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
  maxOperations: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
  maxRevisionsPerArtifact: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
  pageSize: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
})

const supportedTypes = new Set([
  'text/html',
  'text/markdown',
  'text/plain',
  'text/css',
  'text/javascript',
  'application/json',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'application/pdf',
  'font/woff2',
])
const hash = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex')
const jsonBytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value))

/** Root-owned provider; no artifact code receives this service. */
export class DurableArtifacts extends Artifacts {
  static inject = ['storageDomain', 'attachments', 'sessions', 'sessionPersistence', 'workspaceRegistry']
  static Config = Config
  private global?: DomainGlobal<Ledger>
  private tail: Promise<void> = Promise.resolve()
  private closing = false
  private queued = 0
  private readonly readers = new Map<Promise<ArtifactContent>, AbortController>()
  /**
   * @param ctx - durable storage, Workspace, and live Session owners.
   * @param config - explicit complete-result bounds.
   */
  constructor(
    ctx: Context,
    private readonly config: Config,
  ) {
    super(ctx)
  }
  /** Open the ledger and recover only publications already present in durable Session history. */
  protected async [Service.init](): Promise<void> {
    if (
      this.config.maxAssetBytes > this.config.maxPublicationBytes ||
      this.config.maxPublicationBytes > this.config.maxWorkspaceBytes ||
      this.config.maxWorkspaceBytes > this.config.maxHostBytes
    )
      throw new Error('Artifact byte limits must increase from asset to publication to Workspace to Host.')
    const domain = await this.ctx.storageDomain.open(artifactDomain)
    this.global = domain.global
    this.ctx.effect(
      () => async () => {
        this.closing = true
        for (const controller of this.readers.values()) controller.abort()
        await Promise.allSettled(this.readers.keys())
        await this.tail
        await domain.close()
      },
      'artifacts.durableClose',
    )
    this.validateLedger()
    for (const receipt of this.state().operations) {
      if (receipt.abandoned || receipt.revision === null) continue
      if ((await this.ctx.sessionPersistence.stat(receipt.sessionId)) === undefined) {
        if (receipt.committed)
          throw new Error('Committed artifact publication has no durable Session evidence.')
        continue
      }
      const handle = await this.ctx.sessionPersistence.open(receipt.sessionId, 'read')
      let stored: SessionHandleReadResult
      try {
        stored = await handle.read()
      } finally {
        await handle.close()
      }
      const event = stored.events.find(
        (item): item is SessionEvent<'artifact/published'> =>
          item.type === 'artifact/published' && item.data.revision.revisionId === receipt.revisionId,
      )
      if (event !== undefined) {
        if (hash(JSON.stringify(event.data.revision)) !== hash(JSON.stringify(receipt.revision)))
          throw new Error('Artifact durable evidence conflicts with its manifest.')
        if (!receipt.committed) await this.commit(receipt)
      } else if (receipt.committed)
        throw new Error('Committed artifact publication is absent from durable Session history.')
    }
    this.validateLedger()
  }
  /** @inheritdoc */
  async pending(workspaceId: WorkspaceId): Promise<readonly ArtifactPending[]> {
    await this.tail
    this.requireWorkspace(workspaceId)
    const result = this.state()
      .operations.filter(item => item.workspaceId === workspaceId && !item.committed && !item.abandoned)
      .slice(0, this.config.pageSize)
      .map(({ artifactId, revisionId, sessionId, operationId, createdAt }) => ({
        artifactId,
        revisionId,
        sessionId,
        operationId,
        createdAt,
      }))
    this.boundResult(result)
    return result
  }
  /** @inheritdoc */
  reconcile(workspaceId: WorkspaceId, revisionId: ArtifactRevisionId): Promise<ArtifactRevision | null> {
    return this.enqueue(async () => {
      this.requireWorkspace(workspaceId)
      const receipt = this.state().operations.find(
        item => item.workspaceId === workspaceId && item.revisionId === revisionId,
      )
      if (receipt === undefined) throw new Error('Interrupted publication is absent from this Workspace.')
      if (receipt.abandoned) return null
      if (receipt.committed) return receipt.revision
      const live = this.ctx.sessions.get(receipt.sessionId)
      let events: readonly SessionEvent[]
      if (live !== undefined) {
        await this.checkpoint(live)
        events = live.snapshotEvents()
      } else if ((await this.ctx.sessionPersistence.stat(receipt.sessionId)) !== undefined) {
        const handle = await this.ctx.sessionPersistence.open(receipt.sessionId, 'read')
        try {
          events = (await handle.read()).events
        } finally {
          await handle.close()
        }
      } else events = []
      this.requireWorkspace(workspaceId)
      const event = events.find(
        (item): item is SessionEvent<'artifact/published'> =>
          item.type === 'artifact/published' && item.data.revision.revisionId === receipt.revisionId,
      )
      if (event !== undefined) {
        if (
          receipt.revision === null ||
          hash(JSON.stringify(event.data.revision)) !== hash(JSON.stringify(receipt.revision))
        )
          throw new Error('Interrupted publication conflicts with durable Session history.')
        await this.commit(receipt)
        return receipt.revision
      }
      // Serialized reconciliation proves no owned publication event can be appended concurrently.
      await this.replace({ ...receipt, abandoned: true })
      return null
    })
  }
  /** @inheritdoc */
  publish(session: Session, request: ArtifactPublish): Promise<ArtifactRevision> {
    return this.enqueue(() => this.publishOwned(session, request, null))
  }
  /** @inheritdoc */
  async list(workspaceId: WorkspaceId, after: ArtifactId | null): Promise<ArtifactPage> {
    await this.tail
    this.requireWorkspace(workspaceId)
    const heads = this.heads(workspaceId).sort((a, b) => a.artifactId.localeCompare(b.artifactId))
    if (after !== null && !heads.some(head => head.artifactId === after))
      throw new Error('Artifact catalogue cursor is outside this Workspace.')
    const start = after === null ? 0 : heads.findIndex(head => head.artifactId === after) + 1
    const selected = heads.slice(start, start + this.config.pageSize)
    const items = selected.map(head => ({
      head,
      revisionCount: this.revisions(workspaceId, head.artifactId).length,
    }))
    const result = {
      items,
      next:
        start + selected.length < heads.length
          ? selected.reduce<ArtifactId | null>((_, head) => head.artifactId, null)
          : null,
    }
    this.boundResult(result)
    return result
  }
  /** @inheritdoc */
  async history(
    workspaceId: WorkspaceId,
    artifactId: ArtifactId,
    before: ArtifactRevisionId | null,
  ): Promise<readonly ArtifactRevision[]> {
    await this.tail
    const revisions = this.revisionsOwned(workspaceId, artifactId).toReversed()
    const index = before === null ? -1 : revisions.findIndex(revision => revision.revisionId === before)
    if (before !== null && index === -1) throw new Error('Artifact history cursor is outside this artifact.')
    const result = revisions.slice(index + 1, index + 1 + this.config.pageSize)
    this.boundResult(result)
    return result
  }
  /** @inheritdoc */
  read(
    workspaceId: WorkspaceId,
    artifactId: ArtifactId,
    revisionId: ArtifactRevisionId,
    name: string,
    signal?: AbortSignal,
  ): Promise<ArtifactContent> {
    if (this.closing || this.readers.size >= this.config.maxConcurrentReads)
      return Promise.reject(new Error('Artifact reader is closing or at its concurrency limit.'))
    const controller = new AbortController()
    const deadline = setTimeout(() => {
      controller.abort(new Error('Artifact read exceeded its deadline.'))
    }, this.config.readTimeoutMs)
    const stopped = signal === undefined ? controller.signal : AbortSignal.any([signal, controller.signal])
    const result = (async () => {
      stopped.throwIfAborted()
      const revision = this.revisionOwned(workspaceId, artifactId, revisionId)
      const asset = revision.assets.find(item => item.name === name)
      if (asset === undefined) throw new Error('Asset is absent from this immutable revision.')
      const data = await this.verifiedFile(asset, stopped)
      this.requireWorkspace(workspaceId)
      const content = { revision, asset, data: data.toString('base64') }
      this.boundResult(content)
      return content
    })().finally(() => {
      clearTimeout(deadline)
      this.readers.delete(result)
    })
    this.readers.set(result, controller)
    return result
  }
  private async verifiedFile(asset: ArtifactAsset, signal: AbortSignal): Promise<Buffer> {
    const chunks: Buffer[] = []
    let bytes = 0
    for await (const chunk of this.ctx.attachments.readFileStream(asset.file, signal)) {
      signal.throwIfAborted()
      bytes += chunk.byteLength
      if (bytes > this.config.maxAssetBytes || bytes > asset.file.bytes)
        throw new Error('Artifact asset exceeds its immutable length or current admission limit.')
      chunks.push(Buffer.from(chunk))
    }
    signal.throwIfAborted()
    const data = Buffer.concat(chunks)
    if (bytes !== asset.file.bytes || hash(data) !== asset.sha256)
      throw new Error('Artifact asset integrity verification failed.')
    return data
  }
  /** @inheritdoc */
  restore(
    session: Session,
    artifactId: ArtifactId,
    revisionId: ArtifactRevisionId,
    expectedHead: ArtifactRevisionId,
    operationId: ArtifactOperationId,
  ): Promise<ArtifactRevision> {
    return this.enqueue(async () => {
      const workspaceId = this.workspaceOf(session)
      const revision = this.revisionOwned(workspaceId, artifactId, revisionId)
      const assets: ArtifactAssetInput[] = []
      for (const asset of revision.assets)
        assets.push({
          name: asset.name,
          mediaType: asset.mediaType,
          data: (await this.read(workspaceId, artifactId, revisionId, asset.name)).data,
        })
      return this.publishOwned(
        session,
        {
          artifactId,
          expectedHead,
          operationId,
          title: revision.title,
          entry: revision.entry,
          profile: revision.profile,
          assets,
        },
        revisionId,
      )
    })
  }
  private async publishOwned(
    session: Session,
    request: ArtifactPublish,
    restoredFrom: ArtifactRevisionId | null,
  ): Promise<ArtifactRevision> {
    const workspaceId = this.workspaceOf(session)
    const admitted = this.admit(request)
    await this.checkpoint(session)
    const fingerprint = hash(JSON.stringify({ request, restoredFrom }))
    let receipt = this.state().operations.find(
      item => item.sessionId === session.id && item.operationId === request.operationId,
    )
    if (receipt !== undefined) {
      if (receipt.abandoned)
        throw new Error('Artifact operation was reconciled without publication; use a new retry identity.')
      if (receipt.fingerprint !== fingerprint || receipt.workspaceId !== workspaceId)
        throw new Error('Artifact operation identity was reused with different input.')
      if (receipt.committed && receipt.revision !== null) return receipt.revision
    } else {
      const head =
        request.artifactId === null ? undefined : this.revisionsOwned(workspaceId, request.artifactId).at(-1)
      if ((head?.revisionId ?? null) !== request.expectedHead)
        throw new Error('Artifact head changed. Reload and reconcile the conflicting revision.')
      const operations = this.state().operations
      if (
        operations.some(
          item => !item.committed && !item.abandoned && item.artifactId === request.artifactId,
        )
      )
        throw new Error('Artifact has an unresolved publication; retry its operation before editing.')
      if (
        operations.length >= this.config.maxOperations ||
        (head !== undefined &&
          this.revisions(workspaceId, head.artifactId).length >= this.config.maxRevisionsPerArtifact)
      )
        throw new Error('Artifact revision admission limit reached; retained history is preserved.')
      if (
        operations.filter(
          item =>
            item.workspaceId === workspaceId &&
            Date.parse(item.createdAt) > Date.now() - this.config.revisionIntervalMs,
        ).length >= this.config.maxRevisionsPerInterval
      )
        throw new Error('Artifact publication rate limit reached.')
      // Reserve the complete retained receipt cap before capturing any blob.
      const chargedBytes =
        admitted.reduce((sum, item) => sum + item.bytes.byteLength, 0) + this.config.maxMetadataBytes
      if (
        operations.reduce((sum, item) => sum + item.chargedBytes, 0) + chargedBytes >
          this.config.maxHostBytes ||
        operations
          .filter(item => item.workspaceId === workspaceId)
          .reduce((sum, item) => sum + item.chargedBytes, 0) +
          chargedBytes >
          this.config.maxWorkspaceBytes
      )
        throw new Error('Artifact storage admission limit reached; retained revisions are preserved.')
      receipt = {
        artifactId: request.artifactId ?? (randomUUID() as ArtifactId),
        revisionId: randomUUID() as ArtifactRevisionId,
        workspaceId,
        sessionId: session.id,
        operationId: request.operationId,
        fingerprint,
        createdAt: new Date().toISOString(),
        chargedBytes,
        revision: null,
        committed: false,
        abandoned: false,
      }
      if (jsonBytes(receipt) > this.config.maxMetadataBytes)
        throw new Error('Complete artifact reservation exceeds the receipt admission limit.')
      await this.replace(receipt)
    }
    if (receipt.revision === null) {
      const assets: ArtifactAsset[] = []
      for (const item of admitted)
        assets.push({
          name: item.input.name,
          mediaType: item.input.mediaType,
          sha256: hash(item.bytes),
          file: await this.ctx.attachments.saveFile({
            data: item.bytes,
            name: item.input.name.slice(item.input.name.lastIndexOf('/') + 1),
          }),
        })
      const revision: ArtifactRevision = {
        artifactId: receipt.artifactId,
        revisionId: receipt.revisionId,
        workspaceId,
        sessionId: session.id,
        operationId: request.operationId,
        parent: request.expectedHead,
        restoredFrom,
        title: request.title,
        entry: request.entry,
        profile: request.profile,
        capabilities:
          request.profile === 'document' ? ['published-assets'] : ['published-assets', 'transient-input'],
        assets,
        createdAt: receipt.createdAt,
      }
      this.boundResult(revision)
      receipt = { ...receipt, revision }
      if (jsonBytes(receipt) > this.config.maxMetadataBytes)
        throw new Error('Complete artifact receipt exceeds the metadata admission limit.')
      await this.replace(receipt)
    }
    const revision = this.requireManifest(receipt)
    if (this.workspaceOf(session) !== workspaceId)
      throw new Error('Artifact Workspace attachment was revoked during publication.')
    for (const asset of revision.assets)
      await this.verifiedFile(asset, AbortSignal.timeout(this.config.readTimeoutMs))
    const prior = session
      .snapshotEvents()
      .find(
        (event): event is SessionEvent<'artifact/published'> =>
          event.type === 'artifact/published' && event.data.revision.revisionId === revision.revisionId,
      )
    if (prior === undefined) session.append('artifact/published', { revision })
    else if (hash(JSON.stringify(prior.data.revision)) !== hash(JSON.stringify(revision)))
      throw new Error('Artifact publication event conflicts with its durable receipt.')
    await this.checkpoint(session)
    if (this.workspaceOf(session) !== workspaceId)
      throw new Error('Artifact Workspace attachment was revoked before catalogue acknowledgement.')
    await this.commit(receipt)
    return revision
  }
  private admit(request: ArtifactPublish): { input: ArtifactAssetInput; bytes: Buffer }[] {
    if (!/^[a-f0-9-]{36}$/u.test(request.operationId))
      throw new Error('Artifact operation identity must be a UUID.')
    const profile: string = request.profile
    if (profile !== 'document' && profile !== 'interactive-local')
      throw new Error('Unsupported artifact profile.')
    if ((request.artifactId === null) !== (request.expectedHead === null))
      throw new Error('New artifacts require a null head; updates require an exact head.')
    if (
      request.title.trim().length === 0 ||
      request.assets.length === 0 ||
      request.assets.length > this.config.maxAssets
    )
      throw new Error('Artifact requires a title and a bounded nonempty explicit asset manifest.')
    const seen = new Set<string>()
    let bytes = 0
    const inputs = request.assets.map((input) => {
      if (
        !input.name.split('/').every(segment => /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/u.test(segment)) ||
        seen.has(input.name)
      )
        throw new Error(
          'Artifact asset names must be unique canonical relative paths without traversal or URL encoding.',
        )
      seen.add(input.name)
      if (!supportedTypes.has(input.mediaType)) throw new Error('Unsupported artifact media type.')
      if (
        input.data.length > Math.ceil(this.config.maxAssetBytes / 3) * 4 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(input.data)
      )
        throw new Error('Artifact asset encoding is invalid or exceeds admission limits.')
      const data = Buffer.from(input.data, 'base64')
      if (data.byteLength > this.config.maxAssetBytes || data.toString('base64') !== input.data)
        throw new Error('Artifact asset exceeds admission limits or is not canonical base64.')
      bytes += data.byteLength
      return { input, bytes: data }
    })
    if (!seen.has(request.entry)) throw new Error('Artifact entry must name one explicit asset.')
    const metadataBytes = jsonBytes({
      ...request,
      assets: request.assets.map(({ name, mediaType }) => ({ name, mediaType })),
    })
    if (
      metadataBytes > this.config.maxMetadataBytes ||
      bytes + metadataBytes > this.config.maxPublicationBytes
    )
      throw new Error('Complete artifact publication exceeds admission limits.')
    validateDependencies(inputs)
    return inputs
  }
  private async checkpoint(session: Session): Promise<void> {
    if (!(await this.ctx.sessions.flush(session)))
      throw new Error('Artifact publication durability is uncertain: no persistence acknowledgement.')
  }
  private workspaceOf(session: Session): WorkspaceId {
    if (this.ctx.sessions.get(session.id) !== session)
      throw new Error('Artifact publication requires its exact live Session.')
    const matches = this.ctx.workspaceRegistry
      .list()
      .filter(workspace => workspace.sessionIds.includes(session.id))
    const workspace = matches[0]
    if (matches.length !== 1 || workspace === undefined)
      throw new Error('Artifact publication requires exactly one durable Workspace attachment.')
    return workspace.id
  }
  private requireWorkspace(id: WorkspaceId): void {
    if (this.ctx.workspaceRegistry.get(id) === undefined) throw new Error('Unknown artifact Workspace.')
  }
  private activeGlobal(): DomainGlobal<Ledger> {
    if (this.global === undefined) throw new Error('Artifact ledger is not active.')
    return this.global
  }
  private state(): Ledger {
    return this.activeGlobal().get()
  }
  private requireManifest(receipt: Receipt): ArtifactRevision {
    if (receipt.revision === null) throw new Error('Committed artifact has no manifest.')
    return receipt.revision
  }
  private async replace(receipt: Receipt): Promise<void> {
    const global = this.activeGlobal()
    const operations = global.get().operations.filter(item => item.revisionId !== receipt.revisionId)
    operations.push(receipt)
    await global.set({ operations })
    if (receipt.committed) this.ctx.emit('artifact/changed', receipt.workspaceId)
  }
  private commit(receipt: Receipt): Promise<void> {
    return this.replace({ ...receipt, committed: true })
  }
  private revisions(workspaceId: WorkspaceId, artifactId: ArtifactId): ArtifactRevision[] {
    return this.state()
      .operations.filter(
        item => item.committed && item.workspaceId === workspaceId && item.artifactId === artifactId,
      )
      .map(item => this.requireManifest(item))
  }
  private revisionsOwned(workspaceId: WorkspaceId, artifactId: ArtifactId): ArtifactRevision[] {
    this.requireWorkspace(workspaceId)
    const revisions = this.revisions(workspaceId, artifactId)
    if (revisions.length === 0) throw new Error('Artifact is absent from this Workspace.')
    return revisions
  }
  private revisionOwned(
    workspaceId: WorkspaceId,
    artifactId: ArtifactId,
    revisionId: ArtifactRevisionId,
  ): ArtifactRevision {
    const revision = this.revisionsOwned(workspaceId, artifactId).find(
      item => item.revisionId === revisionId,
    )
    if (revision === undefined) throw new Error('Revision is absent from this Workspace artifact.')
    return revision
  }
  private heads(workspaceId: WorkspaceId): ArtifactRevision[] {
    const heads = new Map<ArtifactId, ArtifactRevision>()
    for (const item of this.state().operations)
      if (item.committed && item.workspaceId === workspaceId)
        heads.set(item.artifactId, this.requireManifest(item))
    return [...heads.values()]
  }
  private boundResult(value: unknown): void {
    if (jsonBytes(value) > this.config.maxResponseBytes)
      throw new Error('Complete artifact response exceeds the configured transfer limit.')
  }
  private validateLedger(): void {
    const ids = new Set<string>()
    const revisions = new Set<ArtifactRevisionId>()
    const heads = new Map<ArtifactId, ArtifactRevisionId>()
    const owners = new Map<ArtifactId, WorkspaceId>()
    for (const receipt of this.state().operations) {
      const key = receipt.sessionId + '/' + receipt.operationId
      if (ids.has(key)) throw new Error('Artifact ledger contains duplicate operation identities.')
      ids.add(key)
      if (revisions.has(receipt.revisionId))
        throw new Error('Artifact ledger repeats an immutable revision identity.')
      revisions.add(receipt.revisionId)
      if (owners.has(receipt.artifactId) && owners.get(receipt.artifactId) !== receipt.workspaceId)
        throw new Error('Artifact ledger contains conflicting Workspace ownership.')
      owners.set(receipt.artifactId, receipt.workspaceId)
      if (receipt.abandoned && receipt.committed)
        throw new Error('Abandoned artifact operation cannot be committed.')
      const revision = receipt.committed ? this.requireManifest(receipt) : receipt.revision
      const blobBytes = revision?.assets.reduce((sum, asset) => sum + asset.file.bytes, 0) ?? 0
      if (receipt.chargedBytes < blobBytes + jsonBytes(receipt))
        throw new Error('Artifact reservation understates its retained receipt and blob bytes.')
      if (revision === null) {
        continue
      }
      if (
        revision.artifactId !== receipt.artifactId ||
        revision.revisionId !== receipt.revisionId ||
        revision.workspaceId !== receipt.workspaceId ||
        revision.sessionId !== receipt.sessionId ||
        revision.operationId !== receipt.operationId ||
        revision.createdAt !== receipt.createdAt
      )
        throw new Error('Artifact receipt and manifest identities diverge.')
      if (receipt.committed) {
        if ((heads.get(receipt.artifactId) ?? null) !== revision.parent)
          throw new Error('Artifact revision chain is inconsistent.')
        heads.set(receipt.artifactId, receipt.revisionId)
      }
    }
  }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing || this.queued >= this.config.maxQueuedOperations)
      return Promise.reject(new Error('Artifact provider is closing or its operation queue is full.'))
    this.queued++
    const result = this.tail.then(operation).finally(() => {
      this.queued--
    })
    this.tail = result.then(
      () => {},
      () => {},
    )
    return result
  }
}
export default DurableArtifacts
