#!/usr/bin/env bash
set -euo pipefail

# OpenCut-AI Web Dev Mode Runner
# Starts all backend services in Docker (including ai-backend and ai-worker) and runs only Next.js locally.

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }
log_status() { echo -e "${BLUE}[STATUS]${NC} $*"; }

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

# --- Pre-flight checks ---
if ! command -v docker &>/dev/null; then
    log_error "Docker is not installed or not in PATH."
    exit 1
fi

if ! docker info &>/dev/null; then
    log_error "Docker daemon is not running. Please start Docker first."
    exit 1
fi

# --- Spin up Docker dependencies ---
log_info "1. Starting Docker services (db, redis, AI backend, worker, and model microservices)..."
# Start everything except web
docker compose up -d db redis serverless-redis-http ai-backend ai-worker whisper-service tts-service image-service speaker-service face-service clip-service turboquant-service

# Stop Docker version of web if running to prevent conflicts
log_status "Stopping Docker-managed web container to prevent conflicts..."
docker compose stop web 2>/dev/null || true

# --- Start Local Web Service ---
log_info "2. Launching local web development server..."

# Determine JS runner
RUNNER="npm"
if command -v bun &>/dev/null; then
    RUNNER="bun"
elif command -v pnpm &>/dev/null; then
    RUNNER="pnpm"
elif command -v yarn &>/dev/null; then
    RUNNER="yarn"
fi

echo -e "\n${GREEN}================================================================${NC}"
echo -e "${GREEN}  OpenCut-AI Web Dev Mode is active!${NC}"
echo -e "  - Web App:       http://localhost:3000"
echo -e "  - AI Backend:    http://localhost:8420 (Running in Docker)"
echo -e "  - Ingest Worker: Running in Docker"
echo -e "  Press Ctrl+C to stop the local web server."
echo -e "${GREEN}================================================================${NC}\n"

# Run Next.js Web App locally on host (this replaces the current process so Ctrl+C propagates naturally)
if [ "$RUNNER" = "bun" ]; then
    exec bun run dev:web
else
    exec $RUNNER run dev:web
fi

