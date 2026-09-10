import type {
  DiffBlockLabels,
  JsonTreeLabels,
  MarkdownLabels,
  ReadBlockLabels,
  SearchBlockLabels,
  TerminalBlockLabels,
  WebBlockLabels,
} from '../src/index.ts'

export const markdownLabels: MarkdownLabels = {
  code: { copyLabel: 'Copy', copiedLabel: 'Copied' },
  footnotes: 'Footnotes',
}

export const diffBlockLabels: DiffBlockLabels = {
  copy: 'Copy', copied: 'Copied', collapseAria: 'Collapse diff',
  expandAria: hidden => `Show ${hidden} more diff lines`,
  collapse: 'Collapse', expand: hidden => `… ${hidden} more lines`,
  files: count => `${count} ${count === 1 ? 'file' : 'files'}`,
}

export const readBlockLabels: ReadBlockLabels = {
  window: (shown, total) => `Showing ${shown} / ${total} lines`,
  copy: 'Copy', copied: 'Copied', collapseAria: 'Collapse content',
  expandAria: hidden => `Show ${hidden} more lines`,
  collapse: 'Collapse', expand: hidden => `… ${hidden} more lines`,
}

export const searchBlockLabels: SearchBlockLabels = {
  pathsSummary: (shown, total, truncated) => truncated
    ? `Showing ${shown} of ${total} paths`
    : `${shown} paths`,
  matchesSummary: (shown, total, files, truncated) => truncated
    ? `Showing ${shown} of ${total} matches · ${files} ${files === 1 ? 'file' : 'files'}`
    : `${shown} matches · ${files} files`,
  copy: 'Copy', copied: 'Copied', noResults: 'No results',
  collapseAria: 'Collapse results',
  expandAria: hidden => `Show ${hidden} more results`,
  collapse: 'Collapse', expand: hidden => `… ${hidden} more rows`,
}

export const terminalBlockLabels: TerminalBlockLabels = {
  signal: signal => `Signal ${signal}`,
  exitCode: code => `Exit code ${code}`,
  running: 'Running', failed: 'Failed', done: 'Done',
  copy: 'Copy', copied: 'Copied', noOutput: 'No output',
  collapseAria: 'Collapse output', collapse: 'Collapse',
  expandAria: hidden => `Show ${hidden} more output lines`,
  expand: hidden => `… ${hidden} more lines`,
}

export const jsonTreeLabels: JsonTreeLabels = {
  copyValue: 'Copy value', copyJson: 'Copy JSON', copyPath: 'Copy property path',
  copyPrettyJson: 'Copy pretty JSON', copyCompactJson: 'Copy compact JSON',
  copied: 'Copied', copyFailed: 'Copy failed',
  collapseNode: 'Collapse JSON node', expandNode: 'Expand JSON node',
  copyButtonTitle: action => `${action}; right-click for copy options`,
}

export const webBlockLabels: WebBlockLabels = {
  noResults: 'No results found', sourcesTruncated: 'Source list truncated',
  http: 'HTTP', contentTruncated: 'Content truncated', markdown: markdownLabels,
}
