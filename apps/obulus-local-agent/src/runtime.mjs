import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import {
  approvePaymentIntent,
  paymentApprovalPreview,
} from './approval.mjs'
import { ObulusChatAgent } from './chat-agent.mjs'
import {
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
} from './conversations.mjs'
import { runtimeConfig } from './config.mjs'
import { LocalMarketplace } from './marketplace.mjs'
import { runMcp } from './mcp.mjs'
import { payChildEnvironment, payInvocation } from './pay-sh.mjs'
import { runPayMcp } from './pay-mcp.mjs'
import { executeApprovedIntent } from './payment-broker.mjs'
import { redactModelSecrets } from './privacy.mjs'
import { callTool, tools } from './tools.mjs'

const execFileAsync = promisify(execFile)

/**
 * Shared local-custody runtime used by the CLI, desktop app and MCP servers.
 * It deliberately exposes no generic signing or arbitrary URL payment method.
 */
export class ObulusLocalRuntime {
  constructor(options = {}) {
    this.env = options.env || process.env
    this.config = options.config || runtimeConfig(this.env)
    this.marketplace =
      options.marketplace || new LocalMarketplace(this.config, options.marketplaceOptions)
    this.runner = options.runner || execFileAsync
    this.chatAgent = options.chatAgent || new ObulusChatAgent(this, options.chatOptions)
  }

  listTools() {
    return tools.map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    }))
  }

  privacyStatus() {
    return this.marketplace.privacyStatus()
  }

  async callTool(name, args = {}) {
    return redactModelSecrets(await callTool(name, args, this.marketplace))
  }

  aiStatus() {
    return this.chatAgent.status()
  }

  runAgent(request) {
    return this.chatAgent.run(request)
  }

  listConversations() {
    return listConversations(this.config)
  }

  createConversation(options) {
    return createConversation(this.config, options)
  }

  getConversation(id) {
    return getConversation(this.config, id)
  }

  deleteConversation(id) {
    return deleteConversation(this.config, id)
  }

  paymentPreview(intentId, options = {}) {
    return paymentApprovalPreview(this.config, intentId, options)
  }

  async approveAndPay(intentId, confirmationPhrase, options = {}) {
    await approvePaymentIntent(this.config, intentId, {
      ...options,
      confirm: ({ phrase }) => confirmationPhrase === phrase,
    })
    return executeApprovedIntent(this.config, intentId, {
      ...options,
      env: this.env,
      runner: this.runner,
    })
  }

  async createPayAccount() {
    if (!this.config.payAccount) throw new Error('Select a Pay.sh account name first.')
    const backend = secureBackend(process.platform)
    const pay = payInvocation(this.env)
    const existing = await this.runner(
      pay.command,
      [...pay.args, 'whoami', '--account', this.config.payAccount],
      { timeout: 15_000, env: payChildEnvironment(this.env), maxBuffer: 256 * 1024 },
    ).catch(() => null)
    const existingDetail = stripAnsi(`${existing?.stdout || ''}${existing?.stderr || ''}`).trim()
    if (existing && !/no account named/i.test(existingDetail)) {
      return {
        account: this.config.payAccount,
        backend,
        alreadyExisted: true,
        privateKeyExported: false,
      }
    }
    await this.runner(
      pay.command,
      [...pay.args, 'account', 'new', this.config.payAccount, '--backend', backend],
      { timeout: 120_000, env: payChildEnvironment(this.env), maxBuffer: 256 * 1024 },
    )
    return {
      account: this.config.payAccount,
      backend,
      alreadyExisted: false,
      privateKeyExported: false,
    }
  }

  async connectPayWallet({ ageConfirmed14 = false } = {}) {
    if (!this.config.payAccount) throw new Error('Select a Pay.sh account first.')
    const response = await fetch(`${this.config.apiOrigin}/api/v1/auth/wallet/siwx`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ageConfirmed14 }),
      signal: AbortSignal.timeout(10_000),
    })
    const link = await response.json().catch(() => null)
    if (!response.ok) {
      throw new Error(link?.error?.message || `Wallet sign-in setup failed (${response.status}).`)
    }
    const resource = new URL(link?.resourceUrl || '')
    if (
      resource.origin !== this.config.apiOrigin ||
      !resource.pathname.startsWith('/api/v1/auth/wallet/siwx/') ||
      resource.search ||
      resource.hash ||
      link.network !== 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
    ) {
      throw new Error('The wallet sign-in resource is not bound to this Obulus API.')
    }
    const signed = await this.#payFetch(resource.href)
    if (
      typeof signed?.sessionToken !== 'string' ||
      typeof signed?.wallet !== 'string' ||
      typeof signed?.expiresAt !== 'number' ||
      signed.expiresAt <= Date.now()
    ) {
      throw new Error('Pay.sh sign-in returned an invalid Obulus session.')
    }
    await this.marketplace.setSession(signed.sessionToken, signed.user)
    return {
      connected: true,
      user: signed.user,
      wallet: signed.wallet,
      expiresAt: signed.expiresAt,
      privateKeyExported: false,
    }
  }

  async connectPayoutWallet() {
    const link = await this.marketplace.preparePayoutWalletLink()
    const resource = new URL(link.resourceUrl)
    if (resource.origin !== this.config.apiOrigin) {
      throw new Error('The payout-wallet resource is not bound to this Obulus API.')
    }
    const profile = await this.#payFetch(resource.href)
    return { connected: true, profile, privateKeyExported: false }
  }

  disconnectAccount() {
    return this.marketplace.clearSession()
  }

  async #payFetch(url) {
    const pay = payInvocation(this.env)
    const { stdout } = await this.runner(
      pay.command,
      [...pay.args, 'fetch', '--account', this.config.payAccount, url],
      {
        timeout: 120_000,
        env: payChildEnvironment(this.env),
        maxBuffer: 512 * 1024,
      },
    )
    try {
      return JSON.parse(String(stdout || ''))
    } catch {
      throw new Error('Pay.sh returned a non-JSON response.')
    }
  }

  async doctor() {
    const pay = payInvocation(this.env)
    const [api, gateway, payVersion, payAccount] = await Promise.all([
      health(`${this.config.apiOrigin}/readyz`),
      health(`${this.config.gatewayOrigin}/readyz`),
      this.runner(pay.command, [...pay.args, '--version'], {
        timeout: 15_000,
        env: payChildEnvironment(this.env),
      })
        .then(({ stdout, stderr }) => ({
          ok: true,
          detail: `${stdout || ''}${stderr || ''}`.trim(),
          source: pay.source,
        }))
        .catch((error) => ({ ok: false, detail: error.message, source: pay.source })),
      this.config.payAccount
        ? this.runner(
            pay.command,
            [...pay.args, 'whoami', '--account', this.config.payAccount],
            { timeout: 15_000, env: payChildEnvironment(this.env) },
          )
            .then(({ stdout, stderr }) => {
              const detail = stripAnsi(`${stdout || ''}${stderr || ''}`).trim()
              return /no account named/i.test(detail)
                ? { ok: false, account: this.config.payAccount, detail }
                : { ok: true, account: this.config.payAccount }
            })
            .catch((error) => ({
              ok: false,
              account: this.config.payAccount,
              detail: error.message,
            }))
        : Promise.resolve({
            ok: false,
            account: null,
            detail: 'Create or select a local Pay.sh account.',
          }),
    ])
    const report = {
      mode: 'local-custody-buyer-and-contributor',
      phantomRequired: false,
      api,
      gateway,
      paySh: payVersion,
      payAccount,
      privacy: await this.privacyStatus(),
      ai: this.aiStatus(),
    }
    report.ok = api.ok && gateway.ok && payVersion.ok && payAccount.ok
    return report
  }
}

function secureBackend(platform) {
  if (platform === 'darwin') return 'keychain'
  if (platform === 'win32') return 'windows-hello'
  if (platform === 'linux') return 'gnome-keyring'
  throw new Error('This platform has no supported OS-protected Pay.sh backend.')
}

function stripAnsi(value) {
  return value
    .split('\u001b[')
    .map((part, index) => (index === 0 ? part : part.replace(/^[0-9;]*m/, '')))
    .join('')
}

async function health(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) })
    const body = await response.json().catch(() => null)
    const ready = response.ok && body?.status === 'ready'
    return {
      ok: ready,
      status: response.status,
      serviceStatus: body?.status || null,
      network: body?.network || null,
      detail: ready ? undefined : 'Readiness response did not confirm ready state.',
    }
  } catch (error) {
    return { ok: false, detail: error.message }
  }
}

export { runtimeConfig, runMcp, runPayMcp }
