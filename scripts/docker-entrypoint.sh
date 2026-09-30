#!/usr/bin/env bash
set -e

echo "=========================================="
echo " Starting Arix AI Container..."
echo " Backend URL:  http://0.0.0.0:8765"
echo " Frontend URL: http://0.0.0.0:5173"
echo "=========================================="

# Graceful cleanup on termination signals
cleanup() {
    echo "Shutting down Arix AI services..."
    if [ -n "$BACKEND_PID" ]; then
        kill -TERM "$BACKEND_PID" 2>/dev/null || true
    fi
    if [ -n "$FRONTEND_PID" ]; then
        kill -TERM "$FRONTEND_PID" 2>/dev/null || true
    fi
    wait 2>/dev/null || true
    exit 0
}
trap cleanup SIGINT SIGTERM

# Start FastAPI Backend in background
echo "[Arix Docker] Starting FastAPI Backend on port 8765..."
python -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8765 &
BACKEND_PID=$!

# Start Vite Frontend in background
echo "[Arix Docker] Starting Vite Frontend on port 5173..."
npm --prefix frontend run dev -- --host 0.0.0.0 --port 5173 &
FRONTEND_PID=$!

# Keep container running and monitor processes
wait -n "$BACKEND_PID" "$FRONTEND_PID"
