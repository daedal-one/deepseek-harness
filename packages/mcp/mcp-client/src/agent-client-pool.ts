/** Agent-lifetime MCP clients for browser and other stateful providers. @module */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type { Config } from './index.ts'
import { createTransport } from './transport.ts'

/** One lazily connected client owned by one exact live Agent. */
interface Entry {
  readonly agent: Agent
  readonly client: Client
  readonly ready: Promise<Client>
  disposal?: Promise<void>
}

/**
 * Isolates stateful MCP servers by live Agent identity. A cold-resumed Agent
 * receives a fresh process/connection even when its durable session id is the
 * same, and disposal of the Agent scope closes its client before release.
 */
export class AgentMcpClientPool {
  private readonly entries = new Map<Agent, Entry>()
  private disposed = false

  constructor(
    private readonly ctx: Context,
    private readonly config: Config,
  ) {}

  /**
   * Resolve the isolated client for one model tool execution.
   * @param exec - execution carrying the exact live Agent owner.
   * @returns a connected MCP client owned by that Agent scope.
   */
  clientFor(exec: ToolExecution): Promise<Client> {
    const agent = exec.agent
    if (agent === undefined) {
      throw new Error(`mcp-client(${this.config.serverName}): agent-lifetime clients require an Agent execution`)
    }
    if (this.disposed) throw new Error(`mcp-client(${this.config.serverName}): client pool is disposed`)
    const existing = this.entries.get(agent)
    if (existing !== undefined) return existing.ready

    const client = new Client({ name: `dsh-${this.config.serverName}-agent`, version: '0.1.0' })
    const entry = {} as Entry
    const ready = client.connect(createTransport(this.ctx, this.config)).then(() => client).catch(async (error: unknown) => {
      if (this.entries.get(agent) === entry) this.entries.delete(agent)
      await client.close().catch(() => undefined)
      throw error
    })
    Object.assign(entry, { agent, client, ready })
    this.entries.set(agent, entry)
    agent.ctx.effect(
      () => () => this.release(entry),
      `mcp-client(${this.config.serverName}).agentClient`,
    )
    return ready
  }

  /** Close every still-live Agent client during plugin teardown. */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    await Promise.allSettled([...this.entries.values()].map(entry => this.release(entry)))
  }

  /** Close one entry exactly once and remove its strong Agent reference. */
  private release(entry: Entry): Promise<void> {
    if (entry.disposal !== undefined) return entry.disposal
    if (this.entries.get(entry.agent) === entry) this.entries.delete(entry.agent)
    entry.disposal = entry.client.close()
    return entry.disposal
  }
}

export default AgentMcpClientPool
