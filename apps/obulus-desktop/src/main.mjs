import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { app, BrowserWindow, ipcMain, safeStorage } from 'electron'
import {
  ObulusLocalRuntime,
  runMcp,
  runPayMcp,
  runtimeConfig,
} from '@obulus/local-agent'
import {
  inspectMcpServers,
  installMcpServers,
} from '@obulus/local-agent/installer'
import { payChildEnvironment, payInvocation } from '@obulus/local-agent/pay-sh'

import { browserPreferences, isAllowedNavigation } from './security.mjs'
import { readSecureSettings, writeClaudeApiKey } from './secure-settings.mjs'

const sourceRoot = dirname(fileURLToPath(import.meta.url))
const desktopRoot = resolve(sourceRoot, '..')
const rendererPath = join(sourceRoot, 'renderer', 'index.html')
const rendererUrl = new URL(`file://${rendererPath}`).href
const hostedApi = 'https://obolus-api-amjeodet3q-du.a.run.app'
const hostedGateway = 'https://obolus-gateway-amjeodet3q-du.a.run.app'

const mcpMode = process.argv.find((argument) => argument.startsWith('--mcp='))?.split('=')[1]

if (mcpMode) {
  const environment = runtimeEnvironment()
  const config = runtimeConfig(environment)
  if (mcpMode === 'market') {
    finishMcp(runMcp(new ObulusLocalRuntime({ env: environment, config }).marketplace))
  } else if (mcpMode === 'approved-pay') {
    finishMcp(runPayMcp(config, process.stdin, process.stdout, { env: environment }))
  } else if (mcpMode === 'official-pay') {
    finishMcp(proxyOfficialPayMcp(environment))
  } else {
    fatal(new Error(`Unknown MCP mode: ${mcpMode}`))
  }
} else {
  app.whenReady().then(startDesktop).catch(fatal)
}

async function startDesktop() {
  const environment = runtimeEnvironment()
  if (app.isPackaged) await verifyBundledPay(environment.OBULUS_PAY_COMMAND)
  const settingsPath = join(app.getPath('userData'), 'secure-settings.json')
  const secureSettings = await readSecureSettings(settingsPath, safeStorage)
  if (secureSettings.claudeApiKey) {
    environment.OBULUS_CLAUDE_API_KEY = secureSettings.claudeApiKey
  }
  let runtime = new ObulusLocalRuntime({ env: environment })

  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 700,
    title: 'Obulus Local',
    backgroundColor: '#f4f4f1',
    webPreferences: {
      ...browserPreferences,
      preload: join(sourceRoot, 'preload.cjs'),
    },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, target) => {
    if (!isAllowedNavigation(target, rendererUrl)) event.preventDefault()
  })
  registerIpc({
    getRuntime: () => runtime,
    replaceRuntime: () => {
      runtime = new ObulusLocalRuntime({ env: environment })
      return runtime
    },
    environment,
    settingsPath,
    window,
  })
  await window.loadFile(rendererPath)
}

function registerIpc({ getRuntime, replaceRuntime, environment, settingsPath, window }) {
  const activeRuns = new Map()
  const assertSender = (event) => {
    if (event.sender !== window.webContents || event.senderFrame?.url !== rendererUrl) {
      throw new Error('허용되지 않은 앱 화면에서 온 요청입니다.')
    }
  }
  const safeHandle = (channel, handler) => {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        assertSender(event)
        return { ok: true, value: await handler(event, ...args) }
      } catch (error) {
        return {
          ok: false,
          error: error.message || 'Unexpected error',
          code: error.code || 'desktop_request_failed',
        }
      }
    })
  }
  safeHandle('obulus:bootstrap', async () => {
    const runtime = getRuntime()
    const [doctor, conversations] = await Promise.all([
      runtime.doctor(),
      runtime.listConversations(),
    ])
    return { doctor, conversations, tools: runtime.listTools() }
  })
  safeHandle('obulus:doctor', () => getRuntime().doctor())
  safeHandle('obulus:tools', () => getRuntime().listTools())
  safeHandle('obulus:privacy', () => getRuntime().privacyStatus())
  safeHandle('obulus:ai-status', () => getRuntime().aiStatus())
  safeHandle('obulus:claude-key-save', async (_event, apiKey) => {
    const saved = await writeClaudeApiKey(settingsPath, safeStorage, apiKey)
    if (saved.configured) environment.OBULUS_CLAUDE_API_KEY = String(apiKey).trim()
    else delete environment.OBULUS_CLAUDE_API_KEY
    return replaceRuntime().aiStatus()
  })
  safeHandle('obulus:pay-account-create', () => getRuntime().createPayAccount())
  safeHandle('obulus:account-connect', (_event, options) =>
    getRuntime().connectPayWallet(options),
  )
  safeHandle('obulus:payout-connect', () => getRuntime().connectPayoutWallet())
  safeHandle('obulus:account-disconnect', () => getRuntime().disconnectAccount())
  safeHandle('obulus:call', (_event, name, args) => getRuntime().callTool(name, args))
  safeHandle('obulus:conversation-list', () => getRuntime().listConversations())
  safeHandle('obulus:conversation-create', (_event, options) =>
    getRuntime().createConversation(options),
  )
  safeHandle('obulus:conversation-get', (_event, id) => getRuntime().getConversation(id))
  safeHandle('obulus:conversation-delete', (_event, id) => getRuntime().deleteConversation(id))
  safeHandle('obulus:agent-run', (event, request) => {
    const runId = `run_${randomUUID()}`
    const controller = new AbortController()
    activeRuns.set(runId, controller)
    setImmediate(async () => {
      try {
        await getRuntime().runAgent({
          ...request,
          signal: controller.signal,
          onEvent: (payload) => {
            if (!event.sender.isDestroyed()) {
              event.sender.send('obulus:agent-event', { runId, ...payload })
            }
          },
        })
      } catch (error) {
        if (!event.sender.isDestroyed()) {
          event.sender.send('obulus:agent-event', {
            runId,
            type: controller.signal.aborted ? 'cancelled' : 'error',
            error: error.message || '에이전트 실행에 실패했습니다.',
            code: error.code || 'agent_failed',
            at: Date.now(),
          })
        }
      } finally {
        activeRuns.delete(runId)
      }
    })
    return { runId }
  })
  safeHandle('obulus:agent-cancel', (_event, runId) => {
    const controller = activeRuns.get(runId)
    if (controller) controller.abort()
    return { runId, cancelled: Boolean(controller) }
  })
  safeHandle('obulus:payment-preview', (_event, intentId) =>
    getRuntime().paymentPreview(intentId),
  )
  safeHandle('obulus:approve-and-pay', (_event, intentId, phrase) =>
    getRuntime().approveAndPay(intentId, phrase),
  )
  safeHandle('obulus:mcp-inspect', (_event, client) =>
    inspectMcpServers({ client: client || 'all' }),
  )
  safeHandle('obulus:mcp-install', (_event, client, options = {}) =>
    installMcpServers({
      client,
      descriptors: desktopMcpDescriptors(environment),
      includeOfficialPay: options.includeOfficialPay === true,
    }),
  )
  window.on('closed', () => {
    for (const controller of activeRuns.values()) controller.abort()
    activeRuns.clear()
  })
}

function runtimeEnvironment() {
  const statePath =
    process.env.OBULUS_LOCAL_STATE || join(homedir(), '.config/obulus/local-agent-state.json')
  const environment = {
    ...process.env,
    OBULUS_API_URL: process.env.OBULUS_API_URL || hostedApi,
    OBULUS_GATEWAY_URL: process.env.OBULUS_GATEWAY_URL || hostedGateway,
    OBULUS_LOCAL_STATE: statePath,
    OBULUS_PAY_ACCOUNT: process.env.OBULUS_PAY_ACCOUNT || 'default',
  }
  if (app.isPackaged) {
    environment.OBULUS_PAY_COMMAND = join(process.resourcesPath, 'pay/pay')
    environment.OBULUS_ALLOW_PAY_OVERRIDE = '1'
  }
  return environment
}

function desktopMcpDescriptors(environment) {
  const shared = {
    OBULUS_API_URL: environment.OBULUS_API_URL,
    OBULUS_GATEWAY_URL: environment.OBULUS_GATEWAY_URL,
    OBULUS_LOCAL_STATE: environment.OBULUS_LOCAL_STATE,
    OBULUS_PAY_ACCOUNT: environment.OBULUS_PAY_ACCOUNT,
  }
  if (app.isPackaged) {
    return [
      { name: 'obulus', command: process.execPath, args: ['--mcp=market'], env: shared },
      {
        name: 'obulus-pay',
        command: process.execPath,
        args: ['--mcp=approved-pay'],
        env: shared,
      },
      {
        name: 'pay',
        command: process.execPath,
        args: ['--mcp=official-pay'],
        env: { PAY_ACTIVE_ACCOUNT: environment.OBULUS_PAY_ACCOUNT },
      },
    ]
  }

  return [
    { name: 'obulus', command: process.execPath, args: [desktopRoot, '--mcp=market'], env: shared },
    {
      name: 'obulus-pay',
      command: process.execPath,
      args: [desktopRoot, '--mcp=approved-pay'],
      env: shared,
    },
    {
      name: 'pay',
      command: process.execPath,
      args: [desktopRoot, '--mcp=official-pay'],
      env: { PAY_ACTIVE_ACCOUNT: environment.OBULUS_PAY_ACCOUNT },
    },
  ]
}

function proxyOfficialPayMcp(environment) {
  const pay = payInvocation(environment)
  return new Promise((resolvePromise, reject) => {
    const child = spawn(pay.command, [...pay.args, 'mcp'], {
      stdio: 'inherit',
      env: payChildEnvironment(environment),
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`Official Pay MCP exited with ${signal || code}`))
    })
  })
}

async function verifyBundledPay(path) {
  const expected = String(await readFile(`${path}.sha256`, 'utf8')).trim()
  const actual = createHash('sha256').update(await readFile(path)).digest('hex')
  if (!expected || expected !== actual) throw new Error('Bundled Pay.sh integrity check failed')
}

function fatal(error) {
  process.stderr.write(`Obulus failed: ${error.message}\n`)
  process.exitCode = 1
}

function finishMcp(promise) {
  promise.then(() => app.exit(0)).catch((error) => {
    fatal(error)
    app.exit(1)
  })
}
