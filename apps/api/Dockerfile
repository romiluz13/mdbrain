# Mdbrain HTTP API server image.
#
# Stage 1 (oven/bun): full install, then build the API slice and its
# workspace closure (lib, memory-bridge, wiki-engine, ...). Workspace
# packages resolve through their dist/ builds at runtime, and the compiler
# toolchain is a devDependency.
# Stage 2: prune to the API's production dependency set.
# Stage 3 (node): run the API from source with tsx (a production dependency
# of the API package).
#
# Required at runtime: MDBRAIN_WIKI_MONGODB_URI, MEMONGO_API_URL,
# MEMONGO_API_KEY, and MDBRAIN_API_KEY (production refuses to boot with
# unauthenticated /v1 routes). Set MDBRAIN_API_HOST=0.0.0.0 when other
# containers must reach the API.
# Liveness: GET /health. Readiness: GET /ready.

FROM oven/bun:1.2.5 AS build
WORKDIR /app

# Manifests and workspaces first so dependency layers cache independently.
COPY package.json bun.lock turbo.json tsconfig.base.json ./
COPY apps/ /app/apps/
COPY packages/ /app/packages/

# No browser is needed to build the API slice; transitive postinstalls
# (puppeteer via the docs app) must not download Chrome inside the build.
ENV PUPPETEER_SKIP_DOWNLOAD=1
RUN bun install --frozen-lockfile
RUN bunx turbo run build --filter '@mdbrain/api...'

# Prune back to the API's production dependency set; dist/ outputs live in
# the workspace directories and survive the reinstall. The full install's
# node_modules is wiped first: bun does not reconcile extraneous packages
# when re-running a filtered install over an existing tree.
FROM oven/bun:1.2.5 AS prune
WORKDIR /app
COPY --from=build /app /app
RUN rm -rf node_modules \
	&& bun install --frozen-lockfile --production --filter '@mdbrain/api'

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prune /app /app

EXPOSE 3847
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=12 \
	CMD node -e "fetch('http://127.0.0.1:'+(process.env.MDBRAIN_API_PORT||'3847')+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--import", "tsx", "apps/api/src/server.ts"]
