/**
 * BlackRoad Gateway — Cloudflare Worker Entry Point
 *
 * This is the CF Worker fetch handler. The Node.js HTTP server
 * lives in src/index.ts (used for Railway/local deployment).
 *
 * Deploy: wrangler deploy
 */

import { handleRequest, Env } from "./routes.js";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleRequest(request, env);
  },
} satisfies ExportedHandler<Env>;
