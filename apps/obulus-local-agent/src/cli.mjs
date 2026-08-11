#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { runtimeConfig } from './config.mjs'
import { approvePaymentIntent } from './approval.mjs'
import { LocalMarketplace } from './marketplace.mjs'
import { runMcp } from './mcp.mjs'
import { payChildEnvironment, payInvocation } from './pay-sh.mjs'
import { tools } from './tools.mjs'

const execFileAsync = promisify(execFile)

async function main(argv = process.argv.slice(2)) {
  const command = argv[0] || 'help'
  const config = runtimeConfig()
  const marketplace = new LocalMarketplace(config)
  if (command === 'mcp') return runMcp(marketplace)
  if (command === 'tools') {
    process.stdout.write(`${JSON.stringify(tools.map(({ name, description }) => ({ name, description })), null, 2)}\n`)
    return
  }
  if (command === 'doctor') return doctor(config, marketplace)
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

async function doctor(config, marketplace) {
  const pay = payInvocation()
  const [api, gateway, payVersion, payAccount] = await Promise.all([
    health(`${config.apiOrigin}/readyz`),
    health(`${config.gatewayOrigin}/readyz`),
    execFileAsync(pay.command, [...pay.args, '--version'], {
      timeout: 15_000,
      env: payChildEnvironment(),
    })
      .then(({ stdout, stderr }) => ({ ok: true, detail: `${stdout}${stderr}`.trim(), source: pay.source }))
      .catch((error) => ({ ok: false, detail: error.message, source: pay.source })),
    config.payAccount
      ? execFileAsync(
          pay.command,
          [...pay.args, 'whoami', '--account', config.payAccount],
          { timeout: 15_000, env: payChildEnvironment() },
        )
          .then(({ stdout }) => ({
            ok: true,
            account: config.payAccount,
            detail: stdout.trim(),
          }))
          .catch((error) => ({ ok: false, account: config.payAccount, detail: error.message }))
      : Promise.resolve({
          ok: false,
          account: null,
          detail: 'Set OBULUS_PAY_ACCOUNT to a named local Pay.sh account.',
        }),
  ])
  const report = {
    mode: 'accountless-local-buyer',
    phantomRequired: false,
    api,
    gateway,
    paySh: payVersion,
    payAccount,
    privacy: await marketplace.privacyStatus(),
  }
  report.ok = api.ok && gateway.ok && payVersion.ok && payAccount.ok
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (!report.ok) process.exitCode = 1
}

async function health(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) })
    return { ok: response.ok, status: response.status }
  } catch (error) {
    return { ok: false, detail: error.message }
  }
}

function printHelp() {
  process.stdout.write(`Obulus local agent\n\nCommands:\n  mcp        Run the accountless buyer MCP server\n  doctor     Verify Obulus and Pay.sh readiness\n  tools      List MCP tools\n  approve ID Interactively approve one exact Pay.sh intent\n  forget     Delete all local capabilities\n  forget ID  Delete one local query capability\n`)
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
})
