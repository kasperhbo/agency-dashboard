# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
COPY public ./public
COPY shared ./shared
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    AGENCY_STAGING_CONTAINER=1 \
    AGENCY_STAGING_HOST=0.0.0.0 \
    AGENCY_STAGING_PORT=4320 \
    AGENCY_STAGING_DATA=/app/.agency/staging/container
WORKDIR /app
ARG BUILD_SHA=uncommitted
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node server ./server
COPY --chown=node:node shared ./shared
COPY --chown=node:node scripts/staging-server.mjs scripts/staging-fixtures.mjs ./scripts/
RUN BUILD_SHA=$BUILD_SHA node --input-type=module -e "import fs from 'node:fs';const p=JSON.parse(fs.readFileSync('package.json'));fs.writeFileSync('release.json',JSON.stringify({id:'container',sha:process.env.BUILD_SHA,version:p.version}));fs.mkdirSync('.agency/staging/container',{recursive:true});" \
    && chown -R node:node /app/.agency /app/release.json
USER node
EXPOSE 4320
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4320/api/health',{signal:AbortSignal.timeout(2000)}).then(async r=>{const h=await r.json();if(!r.ok||!h.ok||h.environment!=='staging')process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "scripts/staging-server.mjs"]
