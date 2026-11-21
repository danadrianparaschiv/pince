# A container image of the library as it runs on your own computer: one program, with the
# catalogue, the pictures and the saved settings in one folder, /data.
#
#   docker build -t pince .
#   docker run -d --name pince -p 127.0.0.1:46173:46173 -v pince-data:/data pince
#   docker logs pince        shows the address and the one-time set-up link
#
# Other devices should reach it through a proxy that adds HTTPS; docker/compose.yaml has one.
# docs/LOCAL.md explains the settings.

# The base image is named by its exact contents; a tag could be moved to other contents.
FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS dependencies
WORKDIR /app/api
COPY api/package.json api/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee
LABEL org.opencontainers.image.title="Pince" \
      org.opencontainers.image.description="A family library: a private reading catalogue for one family" \
      org.opencontainers.image.source="https://github.com/danadrianparaschiv/pince" \
      org.opencontainers.image.licenses="MIT"
WORKDIR /app
COPY --from=dependencies /app/api/node_modules api/node_modules
COPY package.json LICENSE ./
COPY api/package.json api/
COPY api/src api/src
COPY web web
COPY scripts scripts

# Inside a container the library has to listen beyond the container itself; which devices can
# reach it is decided by how the port is published. Its data lives in /data, owned by the
# unprivileged user it runs as.
ENV NODE_ENV=production \
    LIBRARY_HOST=0.0.0.0 \
    LIBRARY_LOCAL_DIR=/data \
    PORT=46173
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 46173

# Healthy means the library answers; `/api/me` needs no session and touches no outside service.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --start-interval=2s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/api/me').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# Started directly, not through npm, so that a stop signal reaches the library itself.
CMD ["node", "scripts/dev.js"]
