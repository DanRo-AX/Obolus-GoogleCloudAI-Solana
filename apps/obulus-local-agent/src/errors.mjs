export class LocalAgentError extends Error {
  constructor(message, code = 'local_agent_error', status = 400, details = null) {
    super(message)
    this.name = 'LocalAgentError'
    this.code = code
    this.status = status
    this.details = details
  }
}

export function safeError(error) {
  return {
    error: {
      code: error?.code || 'local_agent_error',
      message: error?.message || 'Obulus local agent request failed',
      status: error?.status || 500,
    },
  }
}
