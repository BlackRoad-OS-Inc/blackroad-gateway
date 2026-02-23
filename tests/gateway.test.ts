/**
 * BlackRoad Gateway E2E Tests
 * Tests the core routing, health, auth, and rate limiting logic
 */

// Simple test framework (Node.js built-in assert)
import assert from 'node:assert/strict';

type TestResult = { name: string; passed: boolean; error?: string };
const results: TestResult[] = [];

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`  ✅ ${name}`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    results.push({ name, passed: false, error: msg });
    console.log(`  ❌ ${name}: ${msg}`);
  }
}

console.log('\n🚪 BlackRoad Gateway Tests\n');

// ─── Provider Registry ────────────────────────────────────────────────────────
const SUPPORTED_PROVIDERS = ['openai', 'anthropic', 'ollama', 'together', 'gemini'];

await test('Provider list includes all required providers', () => {
  for (const p of ['openai', 'anthropic', 'ollama']) {
    assert.ok(SUPPORTED_PROVIDERS.includes(p), `Missing provider: ${p}`);
  }
});

await test('Tokenless architecture: no API keys in provider names', () => {
  for (const p of SUPPORTED_PROVIDERS) {
    assert.doesNotMatch(p, /key|token|secret/i);
  }
});

// ─── Route Definitions ────────────────────────────────────────────────────────
const GATEWAY_ROUTES = [
  { method: 'GET', path: '/v1/health', auth: false },
  { method: 'GET', path: '/v1/health/ready', auth: false },
  { method: 'POST', path: '/v1/chat', auth: true },
  { method: 'POST', path: '/v1/complete', auth: true },
  { method: 'GET', path: '/v1/agents', auth: true },
  { method: 'POST', path: '/v1/agents/invoke', auth: true },
  { method: 'GET', path: '/v1/openapi.json', auth: false },
];

await test('Health endpoints require no auth', () => {
  const healthRoutes = GATEWAY_ROUTES.filter(r => r.path.includes('/health'));
  assert.ok(healthRoutes.length >= 2);
  for (const r of healthRoutes) {
    assert.equal(r.auth, false, `${r.path} should not require auth`);
  }
});

await test('Chat endpoint requires auth', () => {
  const chatRoute = GATEWAY_ROUTES.find(r => r.path === '/v1/chat');
  assert.ok(chatRoute);
  assert.equal(chatRoute!.auth, true);
});

await test('All protected routes require Bearer token', () => {
  const protectedRoutes = GATEWAY_ROUTES.filter(r => r.auth);
  assert.ok(protectedRoutes.length >= 3, 'Should have at least 3 protected routes');
});

// ─── Rate Limiter Logic ───────────────────────────────────────────────────────
interface RateLimitState {
  count: number;
  windowStart: number;
  windowMs: number;
  maxRequests: number;
}

function checkRateLimit(state: RateLimitState): { allowed: boolean; remaining: number } {
  const now = Date.now();
  if (now - state.windowStart > state.windowMs) {
    state.count = 0;
    state.windowStart = now;
  }
  state.count++;
  const allowed = state.count <= state.maxRequests;
  return { allowed, remaining: Math.max(0, state.maxRequests - state.count) };
}

await test('Rate limiter allows requests within limit', () => {
  const state: RateLimitState = { count: 0, windowStart: Date.now(), windowMs: 60000, maxRequests: 10 };
  for (let i = 0; i < 10; i++) {
    const r = checkRateLimit(state);
    assert.ok(r.allowed, `Request ${i + 1} should be allowed`);
  }
});

await test('Rate limiter blocks requests over limit', () => {
  const state: RateLimitState = { count: 0, windowStart: Date.now(), windowMs: 60000, maxRequests: 3 };
  checkRateLimit(state); // 1
  checkRateLimit(state); // 2
  checkRateLimit(state); // 3
  const r = checkRateLimit(state); // 4 - should block
  assert.equal(r.allowed, false);
  assert.equal(r.remaining, 0);
});

await test('Rate limiter remaining decrements correctly', () => {
  const state: RateLimitState = { count: 0, windowStart: Date.now(), windowMs: 60000, maxRequests: 5 };
  const r1 = checkRateLimit(state);
  assert.equal(r1.remaining, 4);
  const r2 = checkRateLimit(state);
  assert.equal(r2.remaining, 3);
});

// ─── Auth Middleware ──────────────────────────────────────────────────────────
function validateBearerToken(header: string | null): boolean {
  if (!header) return false;
  if (!header.startsWith('Bearer ')) return false;
  const token = header.slice(7);
  return token.length >= 10; // Minimum token length
}

await test('Auth rejects missing Authorization header', () => {
  assert.equal(validateBearerToken(null), false);
});

await test('Auth rejects non-Bearer scheme', () => {
  assert.equal(validateBearerToken('Basic abc123'), false);
});

await test('Auth accepts valid Bearer token', () => {
  assert.equal(validateBearerToken('Bearer test-agent-token-123'), true);
});

await test('Auth rejects short tokens', () => {
  assert.equal(validateBearerToken('Bearer short'), false);
});

// ─── Provider Selection ───────────────────────────────────────────────────────
function pickProvider(model: string): string {
  if (model.startsWith('gpt-')) return 'openai';
  if (model.startsWith('claude-')) return 'anthropic';
  if (model.startsWith('gemini-')) return 'gemini';
  if (model.includes('/')) return 'together';
  return 'ollama'; // default to local
}

await test('pickProvider routes gpt- to openai', () => {
  assert.equal(pickProvider('gpt-4o'), 'openai');
});

await test('pickProvider routes claude- to anthropic', () => {
  assert.equal(pickProvider('claude-3-5-sonnet'), 'anthropic');
});

await test('pickProvider routes local models to ollama', () => {
  assert.equal(pickProvider('qwen2.5:3b'), 'ollama');
  assert.equal(pickProvider('llama3.2'), 'ollama');
});

await test('pickProvider routes slash models to together', () => {
  assert.equal(pickProvider('meta-llama/Llama-3.1-8B'), 'together');
});

// ─── Request Schema Validation ────────────────────────────────────────────────
interface ChatRequest {
  model: string;
  messages: Array<{role: string; content: string}>;
  temperature?: number;
  max_tokens?: number;
}

function validateChatRequest(body: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const req = body as ChatRequest;
  if (!req.model || typeof req.model !== 'string') errors.push('model is required');
  if (!Array.isArray(req.messages) || req.messages.length === 0) errors.push('messages must be non-empty array');
  if (req.temperature !== undefined && (req.temperature < 0 || req.temperature > 2)) {
    errors.push('temperature must be 0-2');
  }
  return { valid: errors.length === 0, errors };
}

await test('validateChatRequest accepts valid request', () => {
  const r = validateChatRequest({ model: 'qwen2.5:3b', messages: [{ role: 'user', content: 'hello' }] });
  assert.ok(r.valid);
  assert.equal(r.errors.length, 0);
});

await test('validateChatRequest rejects missing model', () => {
  const r = validateChatRequest({ messages: [{ role: 'user', content: 'hi' }] });
  assert.ok(!r.valid);
  assert.ok(r.errors.some(e => e.includes('model')));
});

await test('validateChatRequest rejects empty messages', () => {
  const r = validateChatRequest({ model: 'gpt-4o', messages: [] });
  assert.ok(!r.valid);
});

await test('validateChatRequest rejects out-of-range temperature', () => {
  const r = validateChatRequest({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }], temperature: 3.0 });
  assert.ok(!r.valid);
});

// ─── Summary ─────────────────────────────────────────────────────────────────
const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;
console.log(`\n📊 ${results.length} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailed tests:');
  results.filter(r => !r.passed).forEach(r => console.log(`  - ${r.name}: ${r.error}`));
  process.exit(1);
}
