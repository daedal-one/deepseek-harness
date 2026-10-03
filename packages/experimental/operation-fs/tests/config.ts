import type { Config } from '../src/config.ts'

export function configFor(root: string): Config {
  return {
    approvedRoots: [root], maxPathBytes: 4096, maxPatternBytes: 256,
    readMaxLines: 20, readMaxLineLength: 80, readMaxBytes: 4096, readStreamMinSize: 4096,
    globMaxResults: 1, sampleOverCapGlobResults: false,
    grepMaxMatches: 1, grepMaxLineBytes: 8, searchMetaMaxBytes: 2048,
    rawOutputMaxBytes: 32768, graceMs: 100, stderrMaxBytes: 1024, timeoutMs: 5000,
  }
}
