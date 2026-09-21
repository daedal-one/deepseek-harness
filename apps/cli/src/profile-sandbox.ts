/** Host-maintenance defaults applied after every authored launch-profile layer. */

import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { composeEntries } from '@deepseek-ai/dsh-app-boot'

/** Require a static configuration object before preserving its unrelated fields. */
function configObject(value: unknown): Record<string, unknown> {
  if (value === undefined) return {}
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('dsh: sandbox: false requires object configurations for host policy rows')
  }
  return value as Record<string, unknown>
}

/**
 * Select unconfined host defaults without changing execution providers or existing Session permissions.
 * @param sandbox - the launch-profile setting, frozen until relaunch.
 * @param patches - complete authored patch stack, including command-line overlays.
 * @returns final patches selecting full-access sandbox, approval, and new-session defaults.
 * @throws when the composition does not contain the standard host providers and policy rows.
 */
export function profileSandboxPatches(sandbox: boolean | undefined, patches: readonly PatchOptions[]): PatchOptions[] {
  if (sandbox !== false) return []
  const entries = composeEntries([[...patches]])
  const rows = new Map(entries.map(row => [row.id, row]))
  const requireRow = (id: string, name: string): EntryOptions => {
    const row = rows.get(id)
    if (row?.name !== `@deepseek-ai/dsh-${name}` || row.disabled !== undefined && row.disabled !== false) {
      throw new Error(`dsh: sandbox: false requires the enabled host row ${id} (${name}); launch a separate host profile based on headless or web instead of switching a container or remote profile`)
    }
    return row
  }
  requireRow('subprocess', 'subprocess-local')
  requireRow('fs-sandbox', 'fs-sandbox')
  const policy = requireRow('sandbox-policy', 'sandbox-policy')
  const approval = requireRow('approval', 'user-approval')
  const permission = requireRow('permission', 'permission-presets')
  const permissionConfig = configObject(permission.config)
  return [
    { id: policy.id, config: { ...configObject(policy.config), mode: 'danger-full-access' } },
    { id: approval.id, config: { ...configObject(approval.config), policy: 'never' } },
    {
      id: permission.id,
      config: {
        ...permissionConfig,
        defaultPreset: 'danger-full-access',
        presets: {
          ...configObject(permissionConfig['presets']),
          'danger-full-access': { sandbox: 'danger-full-access', approval: 'never' },
        },
      },
    },
  ]
}
