type FetchImplementation = typeof fetch

function canonicalHttpsOrigin(value: string): URL {
  const origin = new URL(value)
  if (
    origin.protocol !== 'https:' ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  ) {
    throw new Error('upstream origin must be an origin-only HTTPS URL')
  }
  return origin
}

function upstreamPath(pathname: string, stripPrefix: string): string {
  if (!stripPrefix) return pathname
  if (pathname !== stripPrefix && !pathname.startsWith(`${stripPrefix}/`)) {
    throw new Error('request path is outside the configured proxy prefix')
  }
  return pathname.slice(stripPrefix.length) || '/'
}

export async function proxyRequest(
  request: Request,
  originValue: string,
  stripPrefix = '',
  fetchImpl: FetchImplementation = fetch,
): Promise<Response> {
  const incoming = new URL(request.url)
  const target = canonicalHttpsOrigin(originValue)
  target.pathname = upstreamPath(incoming.pathname, stripPrefix)
  target.search = incoming.search

  const headers = new Headers(request.headers)
  headers.delete('host')
  headers.set('x-forwarded-host', incoming.host)
  headers.set('x-forwarded-proto', incoming.protocol.slice(0, -1))

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
  const upstreamRequest = new Request(target, {
    method: request.method,
    headers,
    body: hasBody ? request.body : null,
    redirect: 'manual',
  })
  const upstream = await fetchImpl(upstreamRequest)
  const responseHeaders = new Headers(upstream.headers)
  responseHeaders.set('cache-control', 'private, no-store')
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  })
}

export async function proxyOrBadGateway(
  request: Request,
  originValue: string,
  stripPrefix = '',
): Promise<Response> {
  try {
    return await proxyRequest(request, originValue, stripPrefix)
  } catch (error) {
    console.error(
      JSON.stringify({
        message: 'Pages upstream proxy failed',
        path: new URL(request.url).pathname,
        error: error instanceof Error ? error.message : String(error),
      }),
    )
    return Response.json(
      { error: { code: 'upstream_unavailable', message: 'Service is temporarily unavailable.' } },
      { status: 502, headers: { 'cache-control': 'private, no-store' } },
    )
  }
}
