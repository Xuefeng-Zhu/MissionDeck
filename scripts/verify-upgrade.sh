#!/usr/bin/env bash
set -euo pipefail
# Run from repository root with pinned pnpm available; no live provider access.
export PROVIDER_MODE=fixture MODEL_MODE=fixture CI=1
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:browser
