FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json tsconfig.json tsconfig.node.json ./
RUN npm ci
COPY src/ ./src/
RUN npm run build:node

FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist-node ./dist-node

ENV PORT=8787
ENV BLACKROAD_GATEWAY_BIND=0.0.0.0
ENV BLACKROAD_GATEWAY_PORT=8787
ENV NODE_ENV=production
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD curl -f http://localhost:8787/health || exit 1
CMD ["node", "dist-node/index.js"]
