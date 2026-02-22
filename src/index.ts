/**
 * blackroad-gateway — Tokenless AI Provider Gateway
 * © BlackRoad OS, Inc. All rights reserved.
 */

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === '/health') {
      return Response.json({ status: 'ok', version: env.GATEWAY_VERSION });
    }

    // Route to provider
    if (url.pathname.startsWith('/v1/')) {
      return handleProviderRequest(request, env);
    }

    return new Response('Not Found', { status: 404 });
  },
};

async function handleProviderRequest(request: Request, env: Env): Promise<Response> {
  // TODO: implement provider routing
  return Response.json({ error: 'Not implemented' }, { status: 501 });
}

interface Env {
  GATEWAY_VERSION: string;
  OPENAI_API_KEY: string;
  ANTHROPIC_API_KEY: string;
  OLLAMA_URL: string;
  GATEWAY_AUTH_SECRET: string;
}
