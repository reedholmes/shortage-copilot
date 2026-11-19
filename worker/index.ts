/**
 * Cloudflare entry point. /api/* goes to the server code; everything else is the
 * static React app (served from the built `dist` folder).
 */
import { handleAgentRun } from './agentHandler'
import { handleDraftNote } from './handler'
import type { Env } from './handler'

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/api/draft-note') return handleDraftNote(request, env)
    if (url.pathname === '/api/agent-run') return handleAgentRun(request, env, ctx)
    if (url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 })
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
