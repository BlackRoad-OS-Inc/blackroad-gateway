/**
 * BLACKROAD AI GATEWAY
 * Cloudflare Worker that routes ALL requests through BlackRoad AI
 *
 * Deploy: wrangler deploy --name blackroad-ai-gateway
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // BlackRoad branding
    const PINK = '#FF1D6C';
    const AMBER = '#F5A623';

    // Route based on path
    if (path === '/') {
      return new Response(blackroadHomepage(), {
        headers: { 'Content-Type': 'text/html' }
      });
    }

    if (path === '/api/ai') {
      return handleAI(request, env);
    }

    if (path === '/api/chat') {
      return handleChat(request, env);
    }

    if (path === '/api/status') {
      return handleStatus(env);
    }

    if (path.startsWith('/proxy/')) {
      return handleProxy(request, path);
    }

    // Default: serve BlackRoad page
    return new Response(blackroadHomepage(), {
      headers: { 'Content-Type': 'text/html' }
    });
  }
};

// AI handler using Cloudflare AI
async function handleAI(request, env) {
  try {
    const { prompt, model } = await request.json();

    // Use Cloudflare AI if available
    if (env.AI) {
      const response = await env.AI.run(model || '@cf/meta/llama-2-7b-chat-int8', {
        prompt: prompt,
        max_tokens: 500
      });

      return Response.json({
        status: 'ok',
        source: 'cloudflare-ai',
        model: model || '@cf/meta/llama-2-7b-chat-int8',
        response: response.response
      });
    }

    // Fallback
    return Response.json({
      status: 'ok',
      source: 'blackroad-fallback',
      response: `BlackRoad AI received: ${prompt}`
    });

  } catch (error) {
    return Response.json({
      status: 'error',
      error: error.message
    }, { status: 500 });
  }
}

// Chat handler
async function handleChat(request, env) {
  const { messages } = await request.json();

  if (env.AI) {
    const response = await env.AI.run('@cf/meta/llama-2-7b-chat-int8', {
      messages: messages
    });

    return Response.json({
      status: 'ok',
      response: response
    });
  }

  return Response.json({
    status: 'error',
    error: 'AI not available'
  }, { status: 503 });
}

// Status handler
async function handleStatus(env) {
  return Response.json({
    status: 'online',
    gateway: 'blackroad-ai-gateway',
    ai_available: !!env.AI,
    kv_available: !!env.KV,
    timestamp: new Date().toISOString()
  });
}

// Proxy handler - routes external requests through BlackRoad
async function handleProxy(request, path) {
  const target = path.replace('/proxy/', '');

  try {
    const response = await fetch(`https://${target}`, {
      method: request.method,
      headers: request.headers
    });

    return new Response(response.body, {
      status: response.status,
      headers: {
        ...Object.fromEntries(response.headers),
        'X-BlackRoad-Proxy': 'true'
      }
    });
  } catch (error) {
    return Response.json({
      error: 'Proxy failed',
      target: target
    }, { status: 502 });
  }
}

// BlackRoad homepage
function blackroadHomepage() {
  return `<!DOCTYPE html>
<html>
<head>
  <title>BlackRoad AI Gateway</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #000;
      color: #fff;
      font-family: 'SF Mono', 'Monaco', 'Inconsolata', monospace;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }
    .container {
      text-align: center;
      padding: 40px;
    }
    h1 {
      font-size: 3em;
      background: linear-gradient(135deg, #F5A623 0%, #FF1D6C 38.2%, #9C27B0 61.8%, #2979FF 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 20px;
    }
    .subtitle {
      color: #FF1D6C;
      font-size: 1.2em;
      margin-bottom: 40px;
    }
    .status {
      background: #111;
      border: 1px solid #FF1D6C;
      border-radius: 8px;
      padding: 20px;
      margin: 20px 0;
    }
    .status-item {
      display: flex;
      justify-content: space-between;
      padding: 10px 0;
      border-bottom: 1px solid #333;
    }
    .status-item:last-child { border-bottom: none; }
    .green { color: #00ff00; }
    .endpoints {
      text-align: left;
      background: #111;
      border: 1px solid #F5A623;
      border-radius: 8px;
      padding: 20px;
      margin: 20px 0;
    }
    .endpoint {
      padding: 8px 0;
      color: #F5A623;
    }
    code {
      background: #222;
      padding: 2px 8px;
      border-radius: 4px;
      color: #FF1D6C;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>BLACKROAD AI GATEWAY</h1>
    <p class="subtitle">All Traffic Routes Through BlackRoad</p>

    <div class="status">
      <div class="status-item">
        <span>Gateway Status</span>
        <span class="green">● ONLINE</span>
      </div>
      <div class="status-item">
        <span>Cloudflare AI</span>
        <span class="green">● READY</span>
      </div>
      <div class="status-item">
        <span>Edge Network</span>
        <span class="green">● GLOBAL</span>
      </div>
    </div>

    <div class="endpoints">
      <h3 style="color: #fff; margin-bottom: 15px;">API Endpoints</h3>
      <div class="endpoint">
        <code>POST /api/ai</code> - AI inference
      </div>
      <div class="endpoint">
        <code>POST /api/chat</code> - Chat completion
      </div>
      <div class="endpoint">
        <code>GET /api/status</code> - Gateway status
      </div>
      <div class="endpoint">
        <code>GET /proxy/{url}</code> - Proxy requests
      </div>
    </div>

    <p style="color: #666; margin-top: 40px;">
      BlackRoad OS, Inc. - All AI is BlackRoad
    </p>
  </div>
</body>
</html>`;
}
