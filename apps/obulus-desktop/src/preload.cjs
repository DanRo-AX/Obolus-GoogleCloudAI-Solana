const { contextBridge, ipcRenderer } = require('electron')

const invoke = async (channel, ...args) => {
  const result = await ipcRenderer.invoke(channel, ...args)
  if (!result?.ok) {
    const error = new Error(result?.error || 'Obulus request failed')
    error.code = result?.code
    throw error
  }
  return result.value
}

contextBridge.exposeInMainWorld('obulus', {
  bootstrap: () => invoke('obulus:bootstrap'),
  doctor: () => invoke('obulus:doctor'),
  tools: () => invoke('obulus:tools'),
  privacy: () => invoke('obulus:privacy'),
  aiStatus: () => invoke('obulus:ai-status'),
  saveClaudeKey: (apiKey) => invoke('obulus:claude-key-save', apiKey),
  createPayAccount: () => invoke('obulus:pay-account-create'),
  connectAccount: (options) => invoke('obulus:account-connect', options),
  connectPayoutWallet: () => invoke('obulus:payout-connect'),
  disconnectAccount: () => invoke('obulus:account-disconnect'),
  call: (name, args) => invoke('obulus:call', name, args),
  listConversations: () => invoke('obulus:conversation-list'),
  createConversation: (options = {}) => invoke('obulus:conversation-create', options),
  getConversation: (id) => invoke('obulus:conversation-get', id),
  deleteConversation: (id) => invoke('obulus:conversation-delete', id),
  runAgent: (request) => invoke('obulus:agent-run', request),
  cancelAgent: (runId) => invoke('obulus:agent-cancel', runId),
  onAgentEvent: (handler) => {
    const listener = (_event, payload) => handler(payload)
    ipcRenderer.on('obulus:agent-event', listener)
    return () => ipcRenderer.removeListener('obulus:agent-event', listener)
  },
  paymentPreview: (intentId) => invoke('obulus:payment-preview', intentId),
  approveAndPay: (intentId, phrase) => invoke('obulus:approve-and-pay', intentId, phrase),
  inspectMcp: (client = 'all') => invoke('obulus:mcp-inspect', client),
  installMcp: (client, options = {}) => invoke('obulus:mcp-install', client, options),
})
