/** Explicit detail loading for compact historical Tool results. */
import { useEffect, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TrajectoryTranslate } from './locales.ts'

/**
 * Request the selected result without changing its completion status.
 * @param props - Exact result sequence, authorized reader, and locale.
 * @returns A loading action with an explicit failure and retry path.
 */
export function DeferredToolResult({ seq, loadToolResult, t }: {
  seq: number
  loadToolResult: (seq: number) => Promise<void>
  t: TrajectoryTranslate
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      await loadToolResult(seq)
    } catch (failure: unknown) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      if (mounted.current) setLoading(false)
    }
  }
  return (
    <div>
      <p>{t('record.resultNotLoaded')}</p>
      <Button size="sm" variant="outline" disabled={loading} onClick={() => { void load() }}>
        {loading ? t('record.loadingResult') : t('record.loadResult')}
      </Button>
      {error !== null && <p role="alert">{error}</p>}
    </div>
  )
}
