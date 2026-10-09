# Production Dockerfile for Clash of Champion
# Compatible with Railway, Render, Fly.io, and Linux VPS
FROM node:22-bookworm-slim

# Install build tools for native better-sqlite3 compilation
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first for optimal Docker layer caching
COPY package*.json ./

# Install production dependencies
RUN npm ci --omit=dev

# Copy all application code
COPY . .

# Ensure data directory exists and set permissions
RUN mkdir -p /app/data && chown -R node:node /app

USER node

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV DATA_DIR=/app/data

EXPOSE 3000

# Container healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "server.js"]
