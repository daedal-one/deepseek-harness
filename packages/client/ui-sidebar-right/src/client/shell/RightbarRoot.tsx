/** Root-scoped controller for the right Sidebar's Workspace or Session content. */
import type {
  PropsHooks,
  HostObservable,
  PropsRenderSlots,
  PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '../contract/slots.ts'

/** Occupancy source for a root-scoped Workspace view. */
export interface RightbarRootInjected {
  hooks: { workspacePanel: HostObservable<boolean> }
}

/**
 * Render the Workspace view or current Session Sidebar while the Conversation is selected.
 * @param props - frame geometry, panel selection, and the authorized Session renderer.
 * @returns the Workspace view, current Session Sidebar, or no content for a global panel.
 */
export function RightbarRoot({
  usePanelInfo,
  useWorkspacePanel,
  SessionProvider,
  renderSlot,
  width,
  viewportWidth,
  canShow,
}: PropsRuntime<'rightbar'> &
  PropsRenderSlots<'rightbar.session' | 'rightbar.workspace'> &
  PropsHooks<RightbarRootInjected['hooks']>) {
  const visible = usePanelInfo(info => info.activePanelId === null)
  const workspacePanel = useWorkspacePanel(occupied => occupied)
  if (!visible) return null
  if (workspacePanel) return renderSlot('rightbar.workspace', { width, viewportWidth, canShow })
  return (
    <SessionProvider>{renderSlot('rightbar.session', { width, viewportWidth, canShow })}</SessionProvider>
  )
}
