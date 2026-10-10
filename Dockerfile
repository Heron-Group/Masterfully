# Fallback deployment: Plesk's Docker extension or any container host.
# Content and caches live in the /data volume:
#   docker build -t masterfully .
#   docker run -d -p 3000:3000 -v research-data:/data --env-file .env.production masterfully

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS run
# git and ssh are needed at runtime for the content repository and push to GitHub.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git openssh-client ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    CONTENT_DIR=/data/content \
    CACHE_DIR=/data/cache \
    SECRETS_DIR=/data/secrets
WORKDIR /app
COPY --from=build --chown=node:node /app/.next/standalone ./
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "server.js"]
