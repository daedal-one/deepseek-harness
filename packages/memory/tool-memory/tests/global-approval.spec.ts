import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { approveGlobalMemoryMutation } from '../src/index.ts'

function execution(): ToolRunContext {
  return {
    callId: 'call-1',
    rootCallId: 'call-1',
    name: 'memory_propose',
    arguments: {},
    signal: new AbortController().signal,
    token: Symbol('tool'),
    agent: {},
  } as unknown as ToolRunContext
}

describe('ordinary global memory approval', () => {
  it('proceeds only for allowed-once and never asks for project scope', async () => {
    const request = vi.fn().mockResolvedValue('allowed-once')
    const context = { get: () => ({ request }) } as unknown as Context
    const exec = execution()

    await expect(approveGlobalMemoryMutation(context, exec, { kind: 'project', project: '/repo' }, 'proposal')).resolves.toBeUndefined()
    expect(request).not.toHaveBeenCalled()
    await expect(approveGlobalMemoryMutation(context, exec, { kind: 'global' }, 'proposal')).resolves.toBeUndefined()
    expect(request).toHaveBeenCalledTimes(1)
    request.mockResolvedValueOnce('allowed-always')
    await expect(approveGlobalMemoryMutation(context, exec, { kind: 'global' }, 'checkpoint')).rejects.toThrow('was not approved (allowed-always)')
  })
})
