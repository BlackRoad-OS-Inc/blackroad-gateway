FROM node:20-slim
WORKDIR /app
COPY package*.json .
RUN npm ci --only=production
COPY src/ ./src/
COPY wrangler.toml .

ENV PORT=8787
ENV GATEWAY_BIND=0.0.0.0
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s CMD curl -f http://localhost:8787/health || exit 1
CMD ["node", "src/index.js"]
