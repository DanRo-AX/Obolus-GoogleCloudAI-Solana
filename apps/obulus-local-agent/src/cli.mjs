#!/usr/bin/env node
import { fileURLToPath } from 'node:url'

import { runtimeConfig } from './config.mjs'
import { approvePaymentIntent } from './approval.mjs'
import { installMcpServers } from './installer.mjs'
import { LocalMarketplace } from './marketplace.mjs'
import { runMcp } from './mcp.mjs'
import { payInvocation } from './pay-sh.mjs'
import { ObulusLocalRuntime } from './runtime.mjs'
import { tools } from './tools.mjs'

const cliPath = fileURLToPath(import.meta.url)
const payMcpPath = fileURLToPath(new URL('./pay-mcp.mjs', import.meta.url))

async function main(argv = process.argv.slice(2)) {
  const command = argv[0] || 'help'
  const config = runtimeConfig()
  const marketplace = new LocalMarketplace(config)
  if (command === 'mcp') return runMcp(marketplace)
  if (command === 'tools') {
    process.stdout.write(`${JSON.stringify(tools.map(({ name, description }) => ({ name, description })), null, 2)}\n`)
    return
  }
  if (command === 'doctor') {
    const report = await new ObulusLocalRuntime({ config, marketplace }).doctor()
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    if (!report.ok) process.exitCode = 1
    return
  }
  if (command === 'install-mcp') {
    const result = await installMcpServers({
      client: argv[1] || 'all',
      descriptors: repositoryMcpDescriptors(config),
      includeOfficialPay: argv.includes('--with-official-pay'),
    })
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }
  if (command === 'approve') {
    if (!argv[1]) throw new Error('approve requires an intent id')
    const result = await approvePaymentIntent(config, argv[1])
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }
  if (command === 'forget') {
    const result = await marketplace.forget(argv[1])
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }
  printHelp()
}

function repositoryMcpDescriptors(config) {
  const pay = payInvocation()
  const sharedEnv = {
    OBULUS_API_URL: config.apiOrigin,
    OBULUS_GATEWAY_URL: config.gatewayOrigin,
    OBULUS_LOCAL_STATE: config.statePath,
  }
  if (config.payAccount) sharedEnv.OBULUS_PAY_ACCOUNT = config.payAccount
  return [
    { name: 'obulus', command: process.execPath, args: [cliPath, 'mcp'], env: sharedEnv },
    {
      name: 'obulus-pay',
      command: process.execPath,
      args: [payMcpPath],
      env: sharedEnv,
    },
    {
      name: 'pay',
      command: pay.command,
      args: [...pay.args, 'mcp'],
      env: config.payAccount ? { PAY_ACTIVE_ACCOUNT: config.payAccount } : {},
    },
  ]
}

function printHelp() {
  process.stdout.write(`Obulus local agent\n\nCommands:\n  mcp                  Run the Obulus research and contributor MCP server\n  doctor               Verify Obulus, Claude and Pay.sh readiness\n  tools                List MCP tools\n  install-mcp [CLIENT] Register Obulus and exact-pay MCP in codex, claude or all\n  install-mcp [CLIENT] --with-official-pay  Also register Pay.sh's broad generic payment MCP\n  approve ID           Interactively approve one exact Pay.sh intent\n  forget               Delete all local capabilities\n  forget ID            Delete one local query capability\n`)
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
})
