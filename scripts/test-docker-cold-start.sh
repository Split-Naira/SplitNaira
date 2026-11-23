#!/usr/bin/env bash
# [Issue #1664] Test Docker Compose cold start from a clean checkout.
#
# Builds and starts Postgres, backend, and frontend without relying on any
# cached Docker layers or local node_modules.  Exits non-zero on the first
# failure so CI sees a clear signal.
#
# Usage:
#   ./scripts/test-docker-cold-start.sh
#
# Prerequisites: Docker Engine ≥ 24, docker compose (v2 plugin).

set -euo pipefail

COMPOSE_FILE="$(cd "$(dirname "$0")/.." && pwd)/docker-compose.yml"
PROJECT_NAME="splitnaira-cold-start-test"

cleanup() {
  echo "==> Tearing down test containers..."
  docker compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" down -v --remove-orphans 2>/dev/null || true
}
trap cleanup EXIT

echo "==> [cold-start] Removing any existing images for this project..."
docker compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" down -v --remove-orphans 2>/dev/null || true

echo "==> [cold-start] Building all services with --no-cache..."
docker compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" build --no-cache

echo "==> [cold-start] Starting services..."
docker compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" up -d

# ── Wait for Postgres health check ───────────────────────────────────────────
echo "==> [cold-start] Waiting for Postgres to become healthy..."
RETRIES=30
until docker compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" \
      exec -T postgres pg_isready -U "${DB_USER:-splitnaira}" >/dev/null 2>&1; do
  RETRIES=$((RETRIES - 1))
  if [ "$RETRIES" -le 0 ]; then
    echo "ERROR: Postgres did not become ready in time."
    docker compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" logs postgres
    exit 1
  fi
  echo "  ...waiting ($RETRIES retries left)"
  sleep 2
done
echo "  Postgres is ready."

# ── Wait for backend health check ────────────────────────────────────────────
BACKEND_PORT="${PORT:-3001}"
echo "==> [cold-start] Waiting for backend on port $BACKEND_PORT..."
RETRIES=30
until curl -sf "http://localhost:${BACKEND_PORT}/health" >/dev/null 2>&1; do
  RETRIES=$((RETRIES - 1))
  if [ "$RETRIES" -le 0 ]; then
    echo "ERROR: Backend did not become healthy in time."
    docker compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" logs backend
    exit 1
  fi
  echo "  ...waiting ($RETRIES retries left)"
  sleep 3
done
echo "  Backend is healthy."

# ── Wait for frontend ────────────────────────────────────────────────────────
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
echo "==> [cold-start] Waiting for frontend on port $FRONTEND_PORT..."
RETRIES=20
until curl -sf "http://localhost:${FRONTEND_PORT}" >/dev/null 2>&1; do
  RETRIES=$((RETRIES - 1))
  if [ "$RETRIES" -le 0 ]; then
    echo "ERROR: Frontend did not become reachable in time."
    docker compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" logs frontend
    exit 1
  fi
  echo "  ...waiting ($RETRIES retries left)"
  sleep 3
done
echo "  Frontend is reachable."

# ── Smoke test: backend returns a valid health response ──────────────────────
echo "==> [cold-start] Smoke-testing backend /health endpoint..."
HEALTH=$(curl -sf "http://localhost:${BACKEND_PORT}/health")
echo "  Response: $HEALTH"
if ! echo "$HEALTH" | grep -qi "ok\|healthy\|status"; then
  echo "ERROR: /health response did not contain expected status field."
  exit 1
fi

echo ""
echo "✓ Docker Compose cold start passed: Postgres + backend + frontend all came up cleanly."
