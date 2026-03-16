<div align="center">
<img src="https://images.blackroad.io/pixel-art/road-logo.png" alt="BlackRoad OS" width="80" />

# BlackRoad Gateway

**Tokenless AI provider gateway. Agents never see API keys.**

[![BlackRoad OS](https://img.shields.io/badge/BlackRoad_OS-Pave_Tomorrow-FF2255?style=for-the-badge&labelColor=000000)](https://blackroad.io)
</div>

---

## Architecture

```
Agent → Gateway (Cloudflare Worker) → Ollama / Claude / OpenAI / Gemini
          ↓
   API keys stored in Worker secrets
   Agents never touch tokens
```

## Why

Every AI provider requires API keys. If agents hold keys, keys leak. The gateway holds ALL keys centrally. Agents authenticate via JWT — the gateway routes to the right provider. Zero token exposure.

## Providers

| Provider | Models | Status |
|----------|--------|--------|
| Ollama (local) | 16 models on Cecilia | Primary |
| Anthropic | Claude 4.5/4.6 | Active |
| OpenAI | GPT-4o, o3 | Active |
| Google | Gemini 2.0 Flash | Active |

## API

```bash
# OpenAI-compatible endpoint
curl https://gateway.blackroad.io/v1/chat/completions \
  -H "Authorization: Bearer $AGENT_JWT" \
  -d '{"model":"mistral","messages":[{"role":"user","content":"hello"}]}'

# Health
curl https://gateway.blackroad.io/v1/health

# List agents
curl https://gateway.blackroad.io/v1/agents
```

## Stack

- Cloudflare Workers (TypeScript)
- JWT authentication
- Multi-provider routing
- Rate limiting per agent

---

*Copyright (c) 2024-2026 BlackRoad OS, Inc. All rights reserved.*
