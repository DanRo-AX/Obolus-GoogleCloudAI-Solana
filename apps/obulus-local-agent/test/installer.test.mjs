import assert from 'node:assert/strict'
import test from 'node:test'

import { installMcpServers } from '../src/installer.mjs'

const descriptors = [
  {
    name: 'obulus',
    command: '/usr/local/bin/node',
    args: ['/workspace/apps/obulus-local-agent/src/cli.mjs', 'mcp'],
    env: { OBULUS_API_URL: 'https://api.example.com' },
  },
  {
    name: 'obulus-pay',
    command: '/usr/local/bin/node',
    args: ['/workspace/apps/obulus-local-agent/src/pay-mcp.mjs'],
    env: { OBULUS_PAY_ACCOUNT: 'default' },
  },
  {
    name: 'pay',
    command: '/workspace/apps/obulus-local-agent/node_modules/.bin/pay',
    args: ['mcp'],
    env: { PAY_ACTIVE_ACCOUNT: 'default' },
  },
]

test('installer registers only the constrained Obulus MCP surfaces by default', async () => {
  const calls = []
  const runner = async (command, args) => {
    calls.push({ command, args })
    if (args[1] === 'get') throw new Error('not configured')
    return { stdout: '', stderr: '' }
  }
  const result = await installMcpServers({
    client: 'all',
    descriptors,
    runner,
    clientExecutables: { codex: '/usr/local/bin/codex', claude: '/usr/local/bin/claude' },
    env: { PATH: '/usr/local/bin' },
  })
  assert.equal(result.length, 4)
  assert.equal(result.every((entry) => entry.status === 'installed'), true)
  const additions = calls.filter((call) => call.args[1] === 'add')
  assert.equal(additions.length, 4)
  assert.deepEqual(additions[0].args, [
    'mcp',
    'add',
    'obulus',
    '--env',
    'OBULUS_API_URL=https://api.example.com',
    '--',
    '/usr/local/bin/node',
    '/workspace/apps/obulus-local-agent/src/cli.mjs',
    'mcp',
  ])
  assert.deepEqual(additions[2].args, [
    'mcp',
    'add',
    '--scope',
    'user',
    'obulus',
    '-e',
    'OBULUS_API_URL=https://api.example.com',
    '--',
    '/usr/local/bin/node',
    '/workspace/apps/obulus-local-agent/src/cli.mjs',
    'mcp',
  ])
})

test('installer requires both constrained surfaces and keeps broad Pay opt-in', async () => {
  await assert.rejects(
    installMcpServers({ client: 'codex', descriptors: descriptors.slice(0, 1) }),
    /must contain: obulus, obulus-pay/,
  )

  const calls = []
  const result = await installMcpServers({
    client: 'codex',
    descriptors,
    includeOfficialPay: true,
    runner: async (command, args) => {
      calls.push({ command, args })
      if (args[1] === 'get') throw new Error('not configured')
      return { stdout: '', stderr: '' }
    },
    clientExecutables: { codex: '/usr/local/bin/codex' },
    env: { PATH: '/usr/local/bin' },
  })
  assert.deepEqual(result.map((item) => item.server), ['obulus', 'obulus-pay', 'pay'])
  assert.equal(calls.filter((call) => call.args[1] === 'add').length, 3)
})
