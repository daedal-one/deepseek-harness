/** Trusted artifact controls; authored bytes reach only the independent renderer. @module */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  ArtifactPending,
  ArtifactContent,
  ArtifactId,
  ArtifactPage,
  ArtifactRevision,
  ArtifactRevisionId,
  ArtifactOperationId,
} from '@deepseek-ai/dsh-artifact/types'
import type { ArtifactFrame, ArtifactRuntimeInteraction } from '@deepseek-ai/dsh-artifact-runtime/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { ArtifactPolicy } from '@deepseek-ai/dsh-api-artifacts/types'
import type {} from './locales.ts'
import css from './Body.module.css'
import { guardMutation, guardInput, guardDownload, guardAgentRequest } from './actions.ts'
import type { ArtifactActionState } from './actions.ts'
/** Plain callbacks assembled from the feature's authorized services. */
export interface ArtifactInjected {
  readonly workspaceId: WorkspaceId
  readonly close: () => void
  readonly presentation: (canShow: boolean) => void
  readonly watch: (signal: AbortSignal, changed: () => void) => Promise<void>
  readonly list: (after: ArtifactId | null) => Promise<ArtifactPage>
  readonly history: (
    artifactId: ArtifactId,
    before: ArtifactRevisionId | null,
  ) => Promise<readonly ArtifactRevision[]>
  readonly read: (revision: ArtifactRevision, name: string, signal?: AbortSignal) => Promise<ArtifactContent>
  readonly pending: () => Promise<readonly ArtifactPending[]>
  readonly reconcile: (revisionId: ArtifactRevisionId) => Promise<ArtifactRevision | null>
  readonly policy: () => Promise<ArtifactPolicy>
  readonly save: (
    revision: ArtifactRevision,
    name: string,
    content: string,
    operationId: ArtifactOperationId,
  ) => Promise<ArtifactRevision>
  readonly restore: (
    revision: ArtifactRevision,
    expectedHead: ArtifactRevisionId,
    operationId: ArtifactOperationId,
  ) => Promise<ArtifactRevision>
  readonly preview: (
    revision: ArtifactRevision,
    signal: AbortSignal,
    frame: (value: ArtifactFrame) => void,
  ) => Promise<void>
  readonly interact: (
    revision: ArtifactRevision,
    frame: ArtifactFrame,
    input: ArtifactRuntimeInteraction,
  ) => Promise<ArtifactFrame>
  readonly ask: (
    revision: ArtifactRevision,
    name: string,
    selection: string,
    instruction: string,
    signal: AbortSignal,
  ) => Promise<void>
  readonly newOperationId: () => ArtifactOperationId
}
interface ViewerBuffers {
  page: ArtifactPage
  selected: ArtifactRevision | null
  revisions: readonly ArtifactRevision[]
  content: ArtifactContent | null
  pendingSaves: readonly ArtifactPending[]
  frame: ArtifactFrame | null
  draft: string
  comparison: ArtifactContent | null
  instruction: string
  typing: string
  limitError: boolean
}
/** Root-scoped Workspace view; its content remains pinned when the selected conversation changes. */
export type ArtifactBodyProps = PropsRuntime<'rightbar.workspace'> &
  PropsLocale<'artifacts'> &
  ArtifactInjected
/**
 * @param props - geometry, framework sources, and trusted operation callbacks.
 * @returns the exact-Workspace catalogue and immutable revision viewer.
 */
export function ArtifactBody({
  workspaceId,
  width,
  viewportWidth,
  canShow,
  useWorkspaces,
  close,
  presentation,
  list,
  watch,
  history,
  read,
  pending,
  reconcile,
  policy,
  save,
  restore,
  preview,
  interact,
  ask,
  newOperationId,
  t,
}: ArtifactBodyProps) {
  const workspace = useWorkspaces(state => state.items.find(item => item.workspaceId === workspaceId))
  const [buffers, setBuffers] = useState<ViewerBuffers>({
    page: { items: [], next: null },
    selected: null,
    revisions: [],
    content: null,
    pendingSaves: [],
    frame: null,
    draft: '',
    comparison: null,
    instruction: '',
    typing: '',
    limitError: false,
  })
  const { page, selected, revisions, content, pendingSaves, frame, draft, comparison, instruction, typing } =
    buffers
  const [head, setHead] = useState<ArtifactRevisionId | null>(null)
  const [limits, setLimits] = useState<ArtifactPolicy | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<'source' | 'preview'>('source')
  const [editing, setEditing] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const source = useRef<HTMLTextAreaElement>(null)
  const request = useRef(0)
  const mutation = useRef<{ id: ArtifactOperationId; kind: string; content: string } | null>(null)
  const lifetime = useRef(new AbortController())
  const activeRead = useRef<AbortController | null>(null)
  const activePreview = useRef<AbortController | null>(null)
  const admitBuffers = (
    previous: ViewerBuffers,
    updates: Partial<ViewerBuffers>,
    caps = limits,
  ): ViewerBuffers => {
    const next = { ...previous, ...updates, limitError: false }
    const retained =
      new TextEncoder().encode(JSON.stringify(next)).byteLength * 2 +
      (next.content?.asset.file.bytes ?? 0) * 2 +
      (next.comparison?.asset.file.bytes ?? 0) * 2 +
      (next.frame === null ? 0 : next.frame.width * next.frame.height * 4)
    return caps !== null && retained > caps.maxRetainedBytes ? { ...previous, limitError: true } : next
  }
  const put = <K extends keyof ViewerBuffers>(
    key: K,
    value: ViewerBuffers[K] | ((previous: ViewerBuffers[K]) => ViewerBuffers[K]),
    caps = limits,
  ): void => {
    setBuffers(previous =>
      admitBuffers(previous, { [key]: typeof value === 'function' ? value(previous[key]) : value }, caps),
    )
  }
  const setPage = (value: ArtifactPage, caps = limits): void => {
    put('page', value, caps)
  }
  const setRevisions = (
    value:
      readonly ArtifactRevision[] | ((previous: readonly ArtifactRevision[]) => readonly ArtifactRevision[]),
  ): void => {
    put('revisions', value)
  }
  const setPendingSaves = (value: readonly ArtifactPending[], caps = limits): void => {
    put('pendingSaves', value, caps)
  }
  const setFrame = (value: ArtifactFrame | null): void => {
    put('frame', value)
  }
  const setDraft = (value: string): void => {
    put('draft', value)
  }
  const setComparison = (value: ArtifactContent | null): void => {
    put('comparison', value)
  }
  const setInstruction = (value: string): void => {
    put('instruction', value)
  }
  const setTyping = (value: string): void => {
    put('typing', value)
  }
  const sourceText = useMemo(() => (content === null ? null : decodeText(content)), [content])
  const comparisonName = content?.asset.name ?? selected?.entry ?? ''
  const comparisonSignal = activeRead.current?.signal
  const actionState = (): ArtifactActionState => ({
    selected,
    content,
    head,
    frame,
    busy,
    sourceText,
    source: source.current,
    signal: lifetime.current.signal,
  })
  const fail = (reason: unknown): void => {
    if (!lifetime.current.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
  }
  useEffect(() => {
    presentation(canShow)
  }, [presentation, canShow])
  useEffect(() => {
    lifetime.current = new AbortController()
    return () => {
      lifetime.current.abort()
      activePreview.current?.abort()
      activeRead.current?.abort()
    }
  }, [])
  useEffect(() => {
    if (workspace === undefined) close()
  }, [workspace, close])
  useEffect(() => {
    const own = lifetime.current
    void Promise.all([list(null), policy(), pending()]).then(
      ([items, caps, saves]) => {
        if (own.signal.aborted) return
        setLimits(caps)
        setPage(items, caps)
        setPendingSaves(saves, caps)
        setLoading(false)
      },
      (reason: unknown) => {
        setLoading(false)
        fail(reason)
      },
    )
  }, [list, policy, pending])
  useEffect(() => {
    const controller = new AbortController()
    let loading = false
    let again = false
    const changed = (): void => {
      again = true
      if (loading) return
      loading = true
      void (async () => {
        while (again) {
          controller.signal.throwIfAborted()
          again = false
          const value = await list(null)
          if (controller.signal.aborted) return
          setPage(value)
          const current = value.items.find(item => item.head.artifactId === selected?.artifactId)
          if (current !== undefined) setHead(current.head.revisionId)
        }
      })()
        .catch(fail)
        .finally(() => {
          loading = false
        })
    }
    if (limits !== null)
      void watch(controller.signal, changed).catch((reason: unknown) => {
        if (!controller.signal.aborted) fail(reason)
      })
    return () => {
      controller.abort()
    }
  }, [watch, list, limits, selected?.artifactId])
  const openRevision = async (revision: ArtifactRevision, name = revision.entry): Promise<void> => {
    const current = ++request.current
    activeRead.current?.abort()
    const controller = new AbortController()
    activeRead.current = controller
    activePreview.current?.abort()
    setFrame(null)
    setComparison(null)
    setEditing(false)
    mutation.current = null
    setBuffers(previous =>
      admitBuffers(previous, { selected: revision, content: null, draft: '', frame: null, comparison: null }),
    )
    setError(null)
    try {
      const value = await read(revision, name, controller.signal)
      if (current !== request.current || lifetime.current.signal.aborted) return
      setBuffers(previous =>
        previous.selected?.revisionId !== value.revision.revisionId
          ? previous
          : admitBuffers(previous, { content: value, draft: decodeText(value) ?? '' }),
      )
    } catch (reason) {
      if (current === request.current) fail(reason)
    }
  }
  useEffect(() => {
    if (selected === null || mode !== 'preview' || limits?.previewAvailable !== true) return
    const controller = new AbortController()
    activePreview.current?.abort()
    activePreview.current = controller
    setFrame(null)
    void preview(selected, controller.signal, (value) => {
      if (!controller.signal.aborted) setFrame(value)
    }).then(
      () => {
        if (!controller.signal.aborted) {
          setFrame(null)
          setError(t('ended'))
        }
      },
      (reason: unknown) => {
        if (!controller.signal.aborted) fail(reason)
      },
    )
    return () => {
      controller.abort()
    }
  }, [selected, mode, limits?.previewAvailable, preview, t])
  const mutate = guardMutation(actionState, async (kind, selected, content, head) => {
    if (
      kind === 'save' &&
      limits !== null &&
      new TextEncoder().encode(draft).byteLength > limits.maxEditBytes
    ) {
      setError(t('editTooLarge'))
      return
    }
    const existing = mutation.current
    if (existing !== null && existing.kind !== kind) return
    const pending = existing ?? { id: newOperationId(), kind, content: draft }
    mutation.current = pending
    setBusy(true)
    setError(null)
    try {
      const next =
        kind === 'save'
          ? await save(selected, content.asset.name, pending.content, pending.id)
          : await restore(selected, head, pending.id)
      lifetime.current.signal.throwIfAborted()
      mutation.current = null
      setHead(next.revisionId)
      setPage(await list(null))
      await openRevision(next)
      setRevisions(await history(next.artifactId, null))
    } catch (reason) {
      fail(reason)
    } finally {
      if (!lifetime.current.signal.aborted) setBusy(false)
    }
  })
  const sendInput = guardInput(actionState, async (input, selected, frame) => {
    const generation = activePreview.current
    setBusy(true)
    try {
      const next = await interact(selected, frame, input)
      if (generation !== null && generation === activePreview.current && !generation.signal.aborted)
        setFrame(next)
    } catch (reason) {
      fail(reason)
    } finally {
      if (!lifetime.current.signal.aborted) setBusy(false)
    }
  })
  const download = guardDownload(actionState, (content) => {
    const bytes = Uint8Array.from(atob(content.data), c => c.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: content.asset.mediaType }))
    const link = document.createElement('a')
    link.href = url
    link.download = content.asset.name.split('/').slice(-1).join('')
    link.click()
    queueMicrotask(() => {
      URL.revokeObjectURL(url)
    })
  })
  const askAgent = guardAgentRequest(actionState, async (selected, content, sourceText, source) => {
    const selection = sourceText.slice(source.selectionStart, source.selectionEnd)
    if (selection.length === 0 || instruction.trim().length === 0) {
      setError(t('selectionRequired'))
      return
    }
    if (
      limits !== null &&
      new TextEncoder().encode(JSON.stringify({ selection, instruction })).byteLength >
        limits.maxSelectionBytes
    ) {
      setError(t('requestTooLarge'))
      return
    }
    setBusy(true)
    try {
      await ask(selected, content.asset.name, selection, instruction, lifetime.current.signal)
      if (!lifetime.current.signal.aborted) setMessage(t('requestSent'))
    } catch (reason) {
      fail(reason)
    } finally {
      if (!lifetime.current.signal.aborted) setBusy(false)
    }
  })
  return (
    <aside
      className={css.panel}
      style={{ width: canShow ? width : viewportWidth }}
      data-artifacts-panel=""
      aria-label={t('artifacts')}
    >
      <header className={css.header}>
        <strong>{t('artifacts')}</strong>
        <span>{workspace?.title}</span>
        <button onClick={close} aria-label={t('close')}>
          {t('close')}
        </button>
      </header>
      <div className={css.body}>
        {message !== null && <p role="status">{message}</p>}
        {buffers.limitError && <p role="status">{t('viewerTooLarge')}</p>}
        {pendingSaves.length > 0 && (
          <section>
            <h2>{t('interrupted')}</h2>
            {pendingSaves.map(item => (
              <button
                key={item.revisionId}
                disabled={busy}
                onClick={() => {
                  setBusy(true)
                  void reconcile(item.revisionId)
                    .then(async () => {
                      const [items, saves] = await Promise.all([list(null), pending()])
                      if (!lifetime.current.signal.aborted) {
                        setPage(items)
                        setPendingSaves(saves)
                        mutation.current = null
                      }
                    }, fail)
                    .finally(() => {
                      if (!lifetime.current.signal.aborted) setBusy(false)
                    })
                }}
              >
                {t('recover')} · {item.createdAt}
              </button>
            ))}
          </section>
        )}
        {error !== null && <p role="status">{t('failed', { message: error })}</p>}
        <button
          disabled={busy}
          onClick={() => {
            setLoading(true)
            void list(null).then(
              (value) => {
                if (!lifetime.current.signal.aborted) {
                  setPage(value)
                  const current = value.items.find(item => item.head.artifactId === selected?.artifactId)
                  if (current !== undefined) setHead(current.head.revisionId)
                  setLoading(false)
                }
              },
              (reason: unknown) => {
                setLoading(false)
                fail(reason)
              },
            )
          }}
        >
          {t('reload')}
        </button>
        {loading ? (
          <p>{t('loading')}</p>
        ) : page.items.length === 0 ? (
          <p>{t('empty')}</p>
        ) : (
          <ul className={css.catalogue}>
            {page.items.map(item => (
              <li key={item.head.artifactId}>
                <button
                  disabled={busy}
                  onClick={() => {
                    setHead(item.head.revisionId)
                    setHistoryOpen(false)
                    void openRevision(item.head)
                  }}
                >
                  {item.head.title}
                </button>
                <dl className={css.metadata}>
                  <dt>{t('type')}</dt>
                  <dd>
                    {item.head.assets
                      .filter(asset => asset.name === item.head.entry)
                      .map(asset => asset.mediaType)
                      .join('')}
                  </dd>
                  <dt>{t('profile')}</dt>
                  <dd>{t(item.head.profile === 'document' ? 'document' : 'interactive')}</dd>
                  <dt>{t('origin')}</dt>
                  <dd>{item.head.sessionId}</dd>
                  <dt>{t('revision')}</dt>
                  <dd>{item.head.revisionId}</dd>
                  <dt>{t('updated')}</dt>
                  <dd>
                    <time dateTime={item.head.createdAt}>
                      {new Date(item.head.createdAt).toLocaleString()}
                    </time>
                  </dd>
                </dl>
              </li>
            ))}
          </ul>
        )}
        {page.next !== null && (
          <button
            onClick={() => {
              void list(page.next).then((value) => {
                if (!lifetime.current.signal.aborted)
                  setPage({ items: [...page.items, ...value.items], next: value.next })
              }, fail)
            }}
          >
            {t('more')}
          </button>
        )}
        {selected !== null && (
          <section>
            <h2>{selected.title}</h2>
            <p>
              {t('origin')} · {selected.sessionId}
            </p>
            <p>
              <small>{selected.revisionId}</small> ·{' '}
              {t(selected.revisionId === head ? 'current' : 'historical')}
            </p>
            <details>
              <summary>{t('policy')}</summary>
              <p>{t(selected.profile === 'document' ? 'document' : 'interactive')}</p>
              <p>{t('denied')}</p>
              <dl>
                <dt>{t('capabilities')}</dt>
                <dd>{selected.capabilities.join(', ')}</dd>
              </dl>
            </details>
            <nav className={css.controls}>
              <button
                aria-pressed={mode === 'source'}
                onClick={() => {
                  setMode('source')
                }}
              >
                {t('source')}
              </button>
              <button
                aria-pressed={mode === 'preview'}
                onClick={() => {
                  setMode('preview')
                }}
              >
                {t('preview')}
              </button>
              <button
                onClick={() => {
                  setHistoryOpen(true)
                  const generation = request.current
                  void history(selected.artifactId, null).then((values) => {
                    if (generation === request.current && !lifetime.current.signal.aborted)
                      setRevisions(values)
                  }, fail)
                }}
              >
                {t('history')}
              </button>
              <button disabled={content === null} title={t('downloadHint')} onClick={download}>
                {t('download')}
              </button>
            </nav>
            {historyOpen && (
              <div className={css.history}>
                {revisions.map(revision => (
                  <div key={revision.revisionId}>
                    <button
                      disabled={busy}
                      onClick={() => {
                        void openRevision(revision)
                      }}
                    >
                      {revision.createdAt} · {revision.revisionId.slice(0, 8)}
                    </button>
                    <button
                      disabled={content === null}
                      onClick={() => {
                        const generation = request.current
                        void read(revision, comparisonName, comparisonSignal).then((value) => {
                          if (generation === request.current && !lifetime.current.signal.aborted)
                            setComparison(value)
                        }, fail)
                      }}
                    >
                      {t('compare')}
                    </button>
                  </div>
                ))}
                {revisions.at(-1) !== undefined && (
                  <button
                    onClick={() => {
                      const cursor = revisions.reduce<ArtifactRevision>((_, value) => value, selected)
                      const generation = request.current
                      void history(selected.artifactId, cursor.revisionId).then((values) => {
                        if (generation === request.current && !lifetime.current.signal.aborted)
                          setRevisions(current => [
                            ...current,
                            ...values.filter(
                              value => !current.some(item => item.revisionId === value.revisionId),
                            ),
                          ])
                      }, fail)
                    }}
                  >
                    {t('more')}
                  </button>
                )}
              </div>
            )}
            {selected.revisionId !== head && (
              <button
                disabled={busy}
                onClick={() => {
                  void mutate('restore')
                }}
              >
                {t('restore')}
              </button>
            )}
            {content !== null && (
              <label>
                {t('name')}
                <select
                  value={content.asset.name}
                  disabled={busy}
                  onChange={(event) => {
                    void openRevision(selected, event.target.value)
                  }}
                >
                  {selected.assets.map(asset => (
                    <option key={asset.name}>{asset.name}</option>
                  ))}
                </select>
              </label>
            )}
            {mode === 'source' &&
              (sourceText === null ? (
                <p>{t('noText')}</p>
              ) : (
                <>
                  <textarea
                    className={css.source}
                    ref={source}
                    aria-label={t('source')}
                    readOnly={!editing || busy || mutation.current !== null}
                    value={editing ? draft : sourceText}
                    onChange={(event) => {
                      setDraft(event.target.value)
                    }}
                  />
                  {comparison !== null && (
                    <div>
                      <h3>{t('previous')}</h3>
                      <textarea
                        className={css.source}
                        readOnly
                        aria-label={t('comparison')}
                        value={decodeText(comparison) ?? t('noText')}
                      />
                    </div>
                  )}
                  <div className={css.controls}>
                    <button
                      onClick={() => {
                        void navigator.clipboard.writeText(sourceText).catch(fail)
                      }}
                    >
                      {t('copy')}
                    </button>
                    {selected.revisionId === head && (
                      <button
                        disabled={
                          busy ||
                          limits === null ||
                          new TextEncoder().encode(sourceText).byteLength > limits.maxEditBytes
                        }
                        onClick={() => {
                          setEditing(true)
                        }}
                      >
                        {t('edit')}
                      </button>
                    )}
                    {editing && (
                      <>
                        <button
                          disabled={busy}
                          onClick={() => {
                            void mutate('save')
                          }}
                        >
                          {t('save')}
                        </button>
                        <button
                          disabled={busy || mutation.current !== null}
                          onClick={() => {
                            setEditing(false)
                            setDraft(sourceText)
                          }}
                        >
                          {t('cancel')}
                        </button>
                      </>
                    )}
                  </div>
                  {!editing && (
                    <div>
                      <p>{t('selection')}</p>
                      <input
                        value={instruction}
                        aria-label={t('instruction')}
                        onChange={(event) => {
                          setInstruction(event.target.value)
                        }}
                      />
                      <button
                        disabled={busy}
                        onClick={() => {
                          void askAgent()
                        }}
                      >
                        {t('request')}
                      </button>
                    </div>
                  )}
                </>
              ))}
            {mode === 'preview' &&
              (limits?.previewAvailable !== true ? (
                <p>{t('unavailable')}</p>
              ) : frame === null ? (
                <p>{t('loading')}</p>
              ) : (
                <>
                  <img
                    className={css.preview}
                    src={'data:image/png;base64,' + frame.png}
                    alt={t('accessibility')}
                    onClick={(event) => {
                      if (selected.profile !== 'interactive-local') return
                      const box = event.currentTarget.getBoundingClientRect()
                      void sendInput({
                        type: 'pointer',
                        x: ((event.clientX - box.left) * frame.width) / box.width,
                        y: ((event.clientY - box.top) * frame.height) / box.height,
                      })
                    }}
                  />
                  <pre className={css.accessible}>{frame.text}</pre>
                  {selected.profile === 'interactive-local' && (
                    <div>
                      <input
                        value={typing}
                        aria-label={t('assetInput')}
                        onChange={(event) => {
                          setTyping(event.target.value)
                        }}
                      />
                      <button
                        disabled={busy}
                        onClick={() => {
                          void sendInput({ type: 'text', text: typing })
                          setTyping('')
                        }}
                      >
                        {t('sendInput')}
                      </button>
                      {(['Tab', 'Enter', 'Backspace', 'ArrowUp', 'ArrowDown'] as const).map(key => (
                        <button
                          key={key}
                          disabled={busy}
                          onClick={() => {
                            void sendInput({ type: 'key', key })
                          }}
                        >
                          {t(
                            ('key.' + key) as
                              'key.Tab' | 'key.Enter' | 'key.Backspace' | 'key.ArrowUp' | 'key.ArrowDown',
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ))}
          </section>
        )}
      </div>
    </aside>
  )
}
/** Decode text only when its immutable media type and bytes admit a UTF-8 source view. */
function decodeText(content: ArtifactContent): string | null {
  if (
    !content.asset.mediaType.startsWith('text/') &&
    content.asset.mediaType !== 'application/json' &&
    content.asset.mediaType !== 'image/svg+xml'
  )
    return null
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(
      Uint8Array.from(atob(content.data), c => c.charCodeAt(0)),
    )
  } catch {
    /* Invalid UTF-8 has no text editing view. */ return null
  }
}
