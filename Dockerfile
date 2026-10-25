FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Optional extra_ca is a trusted corporate/proxy CA, never a verification bypass.
RUN --mount=type=secret,id=extra_ca \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    npm ci --no-audit --no-fund --fetch-retries=1 --fetch-timeout=30000
COPY index.html vite.config.js ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3000 DATA_PATH=/app/data/family-cart.sqlite
WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
RUN --mount=type=secret,id=extra_ca \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    npm ci --omit=dev --no-audit --no-fund --fetch-retries=1 --fetch-timeout=30000 && mkdir -p /app/data && chown node:node /app/data
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node server ./server
USER node
EXPOSE 3000
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server/index.js"]
