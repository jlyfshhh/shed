FROM node:26.8-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Prune here, in the stage that gets thrown away, so the runtime stage copies a
# tree that is already production-only. Pruning after the COPY instead leaves
# the full dev install sitting in an earlier layer, where it still costs its
# full size in the published image — layers are additive, and a later delete
# cannot shrink an earlier one.
RUN npm prune --omit=dev

FROM node:26.8-bookworm-slim AS runtime

WORKDIR /app
ARG SHED_VERSION=dev
ARG SHED_VCS_REF=unknown
ARG SHED_SOURCE=https://github.com/jlyfshhh/shed

LABEL org.opencontainers.image.title="Shed" \
      org.opencontainers.image.description="Self-hosted animal husbandry records and care schedules" \
      org.opencontainers.image.source="${SHED_SOURCE}" \
      org.opencontainers.image.revision="${SHED_VCS_REF}" \
      org.opencontainers.image.version="${SHED_VERSION}" \
      org.opencontainers.image.licenses="MIT"

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 shed \
    && useradd --system --uid 10001 --gid shed --home-dir /tmp/shed-home --shell /usr/sbin/nologin shed

ENV NODE_ENV=production \
    PORT=3000 \
    SHED_TIME_ZONE=America/New_York \
    WRANGLER_SEND_METRICS=false \
    WRANGLER_LOG_PATH=/tmp/shed-runtime/wrangler.log \
    MINIFLARE_CACHE_DIR=/tmp/miniflare-cache \
    HOME=/tmp/shed-home \
    XDG_CACHE_HOME=/tmp/shed-home/.cache \
    XDG_CONFIG_HOME=/tmp/shed-home/.config \
    XDG_DATA_HOME=/tmp/shed-home/.local/share

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/docker-entrypoint.sh ./docker-entrypoint.sh

RUN install -d -o shed -g shed -m 0700 /data /app/dist/server/.wrangler \
    && chmod 0755 ./docker-entrypoint.sh

VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

USER 10001:10001
ENTRYPOINT ["./docker-entrypoint.sh"]
