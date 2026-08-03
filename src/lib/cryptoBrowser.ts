import { sha256 } from '@noble/hashes/sha2'

type HashInput = string | ArrayBuffer | ArrayBufferView
type DigestEncoding = 'base64' | 'hex'

function bytes(input: HashInput): Uint8Array {
  if (typeof input === 'string') return new TextEncoder().encode(input)
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
}

function hex(input: Uint8Array): string {
  return Array.from(input, (value) => value.toString(16).padStart(2, '0')).join('')
}

function base64(input: Uint8Array): string {
  let binary = ''
  for (const value of input) binary += String.fromCharCode(value)
  return window.btoa(binary)
}

/** Browser-compatible subset imported by @x402/svm's verification helpers. */
export function createHash(algorithm: string) {
  if (algorithm.toLowerCase().replace('-', '') !== 'sha256') {
    throw new Error(`Unsupported browser hash algorithm: ${algorithm}`)
  }

  const hash = sha256.create()
  const api = {
    update(input: HashInput) {
      hash.update(bytes(input))
      return api
    },
    digest(encoding?: DigestEncoding) {
      const result = hash.digest()
      if (encoding === 'base64') return base64(result)
      if (encoding === 'hex') return hex(result)
      return result
    },
  }
  return api
}
