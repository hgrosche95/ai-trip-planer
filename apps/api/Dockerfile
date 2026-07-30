# syntax=docker/dockerfile:1

# ---- deps: install workspace dependencies (npm needs every workspace's package.json
# to resolve the root package-lock.json, even though we only ship apps/api) ----
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/api/prisma apps/api/prisma
COPY apps/api/prisma.config.ts apps/api/prisma.config.ts
COPY apps/web/package.json apps/web/package.json
COPY e2e/package.json e2e/package.json
RUN npm ci

# ---- build: compile the NestJS backend to dist/ (this also compiles generated/prisma,
# which is pulled in transitively since src/ imports from it) ----
FROM deps AS build
WORKDIR /app
COPY apps/api apps/api
RUN npm run build --workspace=apps/api

# ---- prune: drop devDependencies now that the build is done ----
FROM build AS prune
WORKDIR /app
RUN npm prune --omit=dev

# ---- runtime: minimal production image ----
FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app/apps/api

RUN groupadd --system nestjs && useradd --system --gid nestjs nestjs

COPY --from=prune /app/node_modules /app/node_modules
COPY --from=prune /app/apps/api/dist ./dist
COPY --from=prune /app/apps/api/package.json ./package.json

USER nestjs
EXPOSE 3000
CMD ["node", "dist/src/main.js"]
