# blackroad-gateway

> Cloudflare Worker — tokenless AI provider gateway for BlackRoad OS.

## ✅ Verified Working

| Check | Status |
|-------|--------|
| CI (tests 20/20) | [![CI](https://github.com/BlackRoad-OS-Inc/blackroad-gateway/actions/workflows/ci.yml/badge.svg)](https://github.com/BlackRoad-OS-Inc/blackroad-gateway/actions/workflows/ci.yml) |
| Security Scan | [![Security](https://github.com/BlackRoad-OS-Inc/blackroad-gateway/actions/workflows/security-scan.yml/badge.svg)](https://github.com/BlackRoad-OS-Inc/blackroad-gateway/actions/workflows/security-scan.yml) |
| Deploy (Cloudflare Workers) | [![Deploy](https://github.com/BlackRoad-OS-Inc/blackroad-gateway/actions/workflows/deploy.yml/badge.svg)](https://github.com/BlackRoad-OS-Inc/blackroad-gateway/actions/workflows/deploy.yml) |

- **Runners**: All jobs run on `ubuntu-latest` (GitHub-hosted, no self-hosted required)
- **Pinned**: Every `uses:` action is pinned to a SHA256 commit hash
- **Tests**: `npx tsx tests/gateway.test.ts` — 20/20 passing
- **Cloudflare Worker**: `wrangler deploy --dry-run` passes; live deploy requires `CLOUDFLARE_API_TOKEN` secret
- **Auto-merge**: PRs labeled `automerge` or from Dependabot/Copilot auto-merge on CI green

## Overview

The trust boundary between BlackRoad agents and AI providers. Agents never hold API keys — all provider communication goes through this gateway.

```
[Any Agent] → [blackroad-gateway] → [OpenAI / Anthropic / Ollama]
```

Runs as a Cloudflare Worker. All API keys are stored as Cloudflare Secrets.

## Structure

```
blackroad-gateway/
├── src/
│   ├── index.ts          # Worker entry point
│   ├── router.ts         # Request routing
│   ├── providers/        # Provider adapters (OpenAI, Anthropic, Ollama)
│   ├── auth.ts           # Agent authentication
│   └── policies.ts       # Permission policies
├── test/                 # Tests
├── wrangler.toml         # Cloudflare Worker config
└── .env.example
```

## Quick Start

```bash
npm install
wrangler dev              # Local dev on http://localhost:8787
wrangler deploy           # Deploy to Cloudflare
```

## Providers

| Provider | Adapter | Notes |
|----------|---------|-------|
| Ollama | `providers/ollama.ts` | Local inference |
| OpenAI | `providers/openai.ts` | GPT models |
| Anthropic | `providers/anthropic.ts` | Claude models |

## Security

- API keys stored ONLY as Cloudflare Secrets (`wrangler secret put`)
- Agent auth via bearer tokens
- Rate limiting per-agent
- All traffic logged for audit

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md)

---

© BlackRoad OS, Inc. — All rights reserved. Proprietary.
