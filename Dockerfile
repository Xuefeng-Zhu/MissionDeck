FROM node:22-bookworm-slim

RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json vitest.config.ts ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
COPY docs/privacy.md ./docs/privacy.md
COPY fixtures ./fixtures

RUN pnpm install --frozen-lockfile
ENV VITE_MISSIONDECK_BACKEND=.
# Render serves the bounded anonymous demo by default. Private-hosted images can
# opt back into the complete CopilotKit client with --build-arg below.
ARG VITE_PUBLIC_DEMO_BUILD=true
RUN VITE_PUBLIC_DEMO_BUILD=$VITE_PUBLIC_DEMO_BUILD pnpm --filter @mission/extension build:web && pnpm --filter @mission/server build

ENV NODE_ENV=production
EXPOSE 10000
CMD ["pnpm","--filter","@mission/server","start"]
