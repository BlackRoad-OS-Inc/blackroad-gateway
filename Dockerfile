FROM node:22-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
LABEL org.opencontainers.image.title="BlackRoad Gateway"
LABEL org.opencontainers.image.description="Tokenless AI provider gateway"
LABEL org.opencontainers.image.vendor="BlackRoad OS, Inc."

WORKDIR /app

# Non-root user
RUN addgroup -S blackroad && adduser -S blackroad -G blackroad

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./

# Audit log directory
RUN mkdir -p /var/blackroad/audit && chown blackroad:blackroad /var/blackroad/audit
VOLUME ["/var/blackroad/audit"]

USER blackroad

EXPOSE 8787

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8787/health || exit 1

ENV NODE_ENV=production \
    BLACKROAD_GATEWAY_BIND=0.0.0.0 \
    BLACKROAD_GATEWAY_PORT=8787 \
    AUDIT_LOG=/var/blackroad/audit/gateway-audit.jsonl

CMD ["node", "dist/index.js"]
