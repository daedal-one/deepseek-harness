/** Forge-only model commands: registered workspace reads and writes under Landlock. */
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { tmpdir } from 'node:os'
import { grantArgs, launcherPath, probeConfidential } from '@deepseek-ai/node-addon-landlock-run'
import { defineTool, type ToolGuard, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'

const TOOL_NAMES = new Set(['forge_shell', 'forge_push_branch', 'forge_fetch'])
/**
 * Monotonic dispatch guard shared by every Forge model session and preset.
 * @param exec - The pending model tool dispatch.
 * @returns A denial for every unconfined tool name, otherwise undefined.
 */
export const confidentialToolGuard: ToolGuard = exec => TOOL_NAMES.has(exec.name)
  ? undefined : 'Forge Code uses forge_shell for repository inspection, searches, edits and tests; other model tools are disabled.'
const OUTPUT_LIMIT = 256 * 1024
const TIMEOUT_MS = 60_000
const MAX_TIMEOUT_MS = 600_000

/** Validated, deployment-owned immutable runtime roots for confined commands. */
export interface ConfidentialToolsConfig {
  readRoots: string[]
  workspaceRoot: string
  privateStateFile: string
}

/**
 * Register Forge's exclusive model tool set. Global monotonic guards also cover
 * native, Code Mode and scoped preset dispatch; unconfined alternatives cannot run.
 * @param ctx - Forge plugin context owning registration and teardown.
 * @param config - Trusted deployment roots, never model or repository arguments.
 * @param boundWorkspace - Resolve the session's persisted repository association.
 */
export async function registerConfidentialTools(
  ctx: Context, config: ConfidentialToolsConfig, boundWorkspace: (agent: Agent) => string,
): Promise<void> {
  const tools = ctx.get('tools')
  const subprocess = ctx.get('subprocess')
  if (tools === undefined || subprocess === undefined) throw new Error('Forge confidential tools require tools and subprocess services')
  if (process.platform !== 'linux' || !probeConfidential()) throw new Error('Forge confidential tools require Linux filesystem and socket-denial enforcement')
  const roots = await Promise.all(config.readRoots.map(async (path) => {
    if (!isAbsolute(path) || path === '/') throw new Error('Forge tool read roots must be absolute, bounded directories or files')
    return realpath(path)
  }))
  const protectedPaths = [await realpath(config.workspaceRoot), await realpath(dirname(config.privateStateFile)),
    ...process.env.DSH_HOME === undefined ? [] : [await realpath(process.env.DSH_HOME)], '/proc', '/sys', '/root']
  if (roots.length === 0 || roots.some(root => root === '/' || protectedPaths.some(path => path === root || path.startsWith(`${root}/`) || root.startsWith(`${path}/`)))) {
    throw new Error('Forge tool runtime reads must exclude managed workspace parents and private Harness state')
  }
  const shutdown = new AbortController()
  ctx.effect(() => () => { shutdown.abort() }, 'forgeConfidentialTools.shutdown')
  ctx.effect(() => tools.register(createConfidentialShellTool(subprocess, roots, boundWorkspace, shutdown.signal)), 'forgeConfidentialTools.shell')
}

/**
 * Construct the runtime tool definition; schema harvest never invokes its body.
 * @param subprocess - Process-tree owner used by the validated composition.
 * @param roots - Canonical immutable read grants validated before registration.
 * @param boundWorkspace - Resolve persisted session authority for each command.
 * @param shutdown - Abort every live command when its plugin is disposed.
 * @returns The exact model schema and confined command implementation.
 */
export function createConfidentialShellTool(
  subprocess: SubprocessRuntime, roots: string[], boundWorkspace: (agent: Agent) => string, shutdown: AbortSignal,
): ToolDefinition {
  return defineTool({
    name: 'forge_shell',
    description: 'Run a bounded Bash command in this session’s registered Forge repository. Use cat, grep, find and standard command-line tools to inspect, search, edit, test and commit. The command can read its repository and immutable installed tools, and write only its repository and private temporary files. Harness credentials, other projects and parent processes are inaccessible. Commands default to 60 seconds and may request up to 10 minutes; output is limited to 256 KiB per stream. No background sessions or permission escalation. Use forge_fetch to refresh registered remote branches, and forge_push_branch after tests and a clean development-branch commit to request publication approval.',
    parameters: { command: { type: 'string', description: 'Bash command to execute in the registered repository.', required: true }, timeout_ms: { type: 'integer', description: 'Optional command deadline in milliseconds: 1–600000; default 60000. Use a longer bound for builds.' } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        stdout: { type: 'string', required: true }, stderr: { type: 'string', required: true },
        exitCode: { type: 'integer', required: true }, truncated: { type: 'boolean', required: true },
      } },
      render: (_args, value) => [{ type: 'text', text: `Exit code: ${String(value.exitCode)}${value.truncated ? ' (output truncated)' : ''}\n${value.stdout}${value.stderr}` }],
    },
    async execute(args, exec) {
      if (Object.keys(args).some(key => key !== 'command' && key !== 'timeout_ms') || !args.command.trim() || args.command.length > 16000) {
        throw new Error('forge_shell requires a nonempty command of at most 16000 characters and an optional timeout_ms')
      }
      const timeoutMs = args.timeout_ms ?? TIMEOUT_MS
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) throw new Error('timeout_ms must be an integer from 1 to 600000')
      if (exec.agent === undefined) throw new Error('forge_shell requires a registered Forge session')
      const workspace = boundWorkspace(exec.agent)
      if (await realpath(workspace) !== workspace) throw new Error('Forge workspace identity changed through a symlink')
      const temporary = await realpath(await mkdtemp(join(tmpdir(), 'forge-command-')))
      const timeout = new AbortController()
      const timer = setTimeout(() => { timeout.abort() }, timeoutMs)
      const signal = AbortSignal.any([exec.signal, shutdown, timeout.signal])
      try {
        const env: NodeJS.ProcessEnv = Object.fromEntries(Object.keys(process.env).map(key => [key, undefined]))
        Object.assign(env, { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: temporary, TMPDIR: temporary, TMP: temporary, TEMP: temporary,
          GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' })
        const handle = subprocess.spawn({
          argv: [launcherPath(), ...grantArgs({ confidential: true, readOnly: roots, readWrite: [workspace, temporary, '/dev/null'] }), '--', 'bash', '--noprofile', '--norc', '-c', args.command],
          cwd: workspace, env, signal, graceMs: 1000,
          stdio: { stdin: 'ignore', stdout: { maxBytes: OUTPUT_LIMIT }, stderr: { maxBytes: OUTPUT_LIMIT } },
        })
        try {
          const outcome = await handle.done
          if (timeout.signal.aborted) throw new Error(`Forge command exceeded its ${String(timeoutMs)} ms limit`)
          if (signal.aborted) throw new Error('Forge command was cancelled')
          const stdout = handle.collected.stdout?.readFrom(0)
          const stderr = handle.collected.stderr?.readFrom(0)
          if (stdout === undefined || stderr === undefined) throw new Error('Forge command output is unavailable')
          return { stdout: stdout.text, stderr: stderr.text, exitCode: outcome.exitCode ?? 128,
            truncated: stdout.lossy || stderr.lossy }
        } finally {
          handle.terminate()
          await handle.waitForExit()
        }
      } finally {
        clearTimeout(timer)
        await rm(temporary, { recursive: true, force: true })
      }
    },
  })
}
