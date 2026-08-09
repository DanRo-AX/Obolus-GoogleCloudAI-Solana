import { proxyOrBadGateway } from '../../cloudflare/pages-proxy'

export const onRequest: PagesFunction<Env> = async (context) =>
  proxyOrBadGateway(context.request, context.env.API_ORIGIN)
