/**
 * Resolve a workspace-relative path into the Host-facing spelling used by openPath.
 * @param cwd - session workspace root, when known.
 * @param path - absolute or workspace-relative path.
 * @returns an absolute path when a workspace root is available, otherwise the original path.
 */
export function resolveWorkspacePath(cwd: string | undefined, path: string): string {
  if (path.startsWith('/') || /^[A-Za-z]:[/\\]/.test(path) || path.startsWith('\\\\')) return path
  if (cwd === undefined || cwd === '') return path
  const base = cwd.replace(/[/\\]+$/, '')
  const rel = path.replace(/^[/\\]+/, '')
  return `${base}/${rel}`
}

/**
 * Read an optional registered-workspace deep link from a browser location.
 * Relative values are ignored because initial selection must never reinterpret
 * a project identifier against the browser's own URL path.
 * @param pageLocation - browser location; absent outside a browser.
 * @returns the exact absolute Host path requested by `?workspace=`, when valid.
 */
export function requestedWorkspacePath(
  pageLocation: Pick<Location, 'search'> | undefined = typeof location === 'undefined' ? undefined : location,
): string | undefined {
  if (pageLocation === undefined) return undefined
  const value = new URLSearchParams(pageLocation.search).get('workspace')
  if (value === null || value === '') return undefined
  if (value.startsWith('/') || /^[A-Za-z]:[/\\]/.test(value) || value.startsWith('\\\\')) return value
  return undefined
}
