#!/usr/bin/env node

import { fileURLToPath } from 'node:url'
import { boot, installFailLoud, loadEnv } from '@deepseek-ai/dsh-app-boot'

const name = 'dsh-forge-adapter'
const config = fileURLToPath(new URL('./cordis.yml', import.meta.url))
installFailLoud(name)
loadEnv(name)
const ctx = await boot(name, config, undefined, undefined, import.meta.url)
let stopping = false

async function stop(code) {
  if (stopping) return
  stopping = true
  try {
    await ctx.fiber.dispose()
  } finally {
    process.exit(code)
  }
}

process.on('SIGTERM', () => { void stop(0) })
process.on('SIGINT', () => { void stop(130) })
