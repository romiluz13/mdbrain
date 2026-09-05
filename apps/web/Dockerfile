# Mdbrain web console image (Next.js).
#
# NEXT_PUBLIC_MDBRAIN_API_URL is inlined at build time: browsers call the
# API directly, so it must be the host-reachable API URL, not the in-network
# service name. Override at build time with --build-arg.

FROM oven/bun:1.2.5 AS build
WORKDIR /app

ARG NEXT_PUBLIC_MDBRAIN_API_URL=http://127.0.0.1:3847
ENV NEXT_PUBLIC_MDBRAIN_API_URL=${NEXT_PUBLIC_MDBRAIN_API_URL}

# Manifests and workspaces first so dependency layers cache independently.
COPY package.json bun.lock turbo.json tsconfig.base.json ./
COPY apps/ /app/apps/
COPY packages/ /app/packages/

# No browser is needed to build the web console; transitive postinstalls
# (puppeteer via the docs app) must not download Chrome inside the build.
ENV PUPPETEER_SKIP_DOWNLOAD=1
RUN bun install --frozen-lockfile
RUN bunx turbo run build --filter '@mdbrain/web'

# Prune to the web app's production dependency set; the .next build output
# lives in apps/web and survives the reinstall.
FROM oven/bun:1.2.5 AS prune
WORKDIR /app
COPY --from=build /app /app
RUN rm -rf node_modules \
	&& bun install --frozen-lockfile --production --filter '@mdbrain/web'

FROM node:22-bookworm-slim AS runtime
WORKDIR /app/apps/web
ENV NODE_ENV=production
COPY --from=prune /app /app

EXPOSE 3040
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=12 \
	CMD node -e "const n=require('net');const s=n.connect(3040,'127.0.0.1',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),4000)"

# bun hoists workspace dependencies to the root node_modules; there is no
# per-app node_modules, so invoke next through its root bin path. WORKDIR is
# the app directory, which next start uses as the project root.
CMD ["/app/node_modules/.bin/next", "start", "-p", "3040", "-H", "0.0.0.0"]
