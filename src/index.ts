/**
 * blackroad-gateway — Tokenless AI Provider Gateway
 * Cloudflare Worker routing AI requests to any provider.
 * Agents never see API keys — this is the trust boundary.
 * © BlackRoad OS, Inc. All rights reserved.
 */

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Agent-ID',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Health check
    if (url.pathname === '/health') {
      return Response.json({
        status: 'ok',
        version: env.GATEWAY_VERSION ?? '0.1.0',
        providers: ['openai', 'anthropic', 'ollama', 'gemini'],
        timestamp: new Date().toISOString(),
      }, { headers: corsHeaders });
    }

    // Require auth for all other routes
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ') || authHeader.slice(7) !== env.GATEWAY_AUTH_SECRET) {
      return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
    }

    const agentId = request.headers.get('X-Agent-ID') ?? 'unknown';

    // Route to providers
    if (url.pathname.startsWith('/v1/openai/')) {
      return proxyToProvider(request, env.OPENAI_API_KEY, 'https://api.openai.com', url.pathname.replace('/v1/openai', ''), corsHeaders, agentId);
    }

    if (url.pathname.startsWith('/v1/anthropic/')) {
      return proxyToProvider(request, env.ANTHROPIC_API_KEY, 'https://api.anthropic.com', url.pathname.replace('/v1/anthropic', ''), corsHeaders, agentId, { 'anthropic-version': '2023-06-01', 'x-api-key': env.ANTHROPIC_API_KEY ?? '' });
    }

    if (url.pathname.startsWith('/v1/ollama/')) {
      const ollamaBase = env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
      return proxyToProvider(request, null, ollamaBase, url.pathname.replace('/v1/ollama', ''), corsHeaders, agentId);
    }

    // Unified chat endpoint — auto-selects provider
    if (url.pathname === '/v1/chat') {
      return handleUnifiedChat(request, env, corsHeaders, agentId);
    }

    return Response.json({ error: 'Not found', path: url.pathname }, { status: 404, headers: corsHeaders });
  },
};

async function proxyToProvider(
  request: Request,
  apiKey: string | null | undefined,
  baseUrl: string,
  path: string,
  corsHeaders: Record<string, string>,
  agentId: string,
  extraHeaders: Record<string, string> = {}
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extraHeaders,
  };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const body = request.method !== 'GET' ? await request.text() : undefined;

  const res = await fetch(`${baseUrl}${path}`, {
    method: request.method,
    headers,
    body,
  });

  const responseHeaders = { ...corsHeaders, 'Content-Type': res.headers.get('Content-Type') ?? 'application/json' };
  return new Response(res.body, { status: res.status, headers: responseHeaders });
}

async function handleUnifiedChat(request: Request, env: Env, corsHeaders: Record<string, string>, agentId: string): Promise<Response> {
  const body = await request.json() as { provider?: string; model?: string; messages: unknown[] };
  const provider = body.provider ?? 'ollama';

  switch (provider) {
    case 'openai':
      return proxyToProvider(request, env.OPENAI_API_KEY, 'https://api.openai.com', '/v1/chat/completions', corsHeaders, agentId);
    case 'anthropic':
      return proxyToProvider(request, env.ANTHROPIC_API_KEY, 'https://api.anthropic.com', '/v1/messages', corsHeaders, agentId, {
        'anthropic-version': '2023-06-01',
        'x-api-key': env.ANTHROPIC_API_KEY ?? '',
      });
    case 'ollama': {
      const ollamaBase = env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
      return proxyToProvider(request, null, ollamaBase, '/api/chat', corsHeaders, agentId);
    }
    default:
      return Response.json({ error: `Unknown provider: ${provider}` }, { status: 400, headers: corsHeaders });
  }
}

interface Env {
  GATEWAY_VERSION?: string;
  GATEWAY_AUTH_SECRET?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  OLLAMA_URL?: string;
}
