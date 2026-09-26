#!/bin/bash
# VisionAI Backend Deployment Script for Raspberry Pi 5
# Usage: bash deploy_to_pi.sh
# Run from: ~/Desktop/hahaha/visionai-backend/

PI_USER="kanchannish08"
PI_HOST="192.168.124.42"
PI_DIR="~/visionai-backend"
LOCAL_DIR="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "=== VisionAI Backend Deployment to Raspberry Pi 5 ==="
echo "    Source : $LOCAL_DIR"
echo "    Target : $PI_USER@$PI_HOST:$PI_DIR"
echo ""

# ── Step 1: rsync all backend files (exclude sensitive/runtime dirs) ──────────
echo "[1/3] Syncing files to Pi..."
rsync -avz --progress \
  --exclude='venv/' \
  --exclude='__pycache__/' \
  --exclude='.env' \
  --exclude='recent_frames/' \
  --exclude='history/' \
  --exclude='*.pyc' \
  --exclude='*.log' \
  "$LOCAL_DIR/" \
  "$PI_USER@$PI_HOST:$PI_DIR/"

if [ $? -ne 0 ]; then
  echo ""
  echo "❌ rsync failed. Check SSH access to the Pi."
  echo "   Tip: run 'ssh-copy-id $PI_USER@$PI_HOST' to set up passwordless SSH."
  exit 1
fi

echo ""
echo "[2/3] Files synced successfully."
echo ""

# ── Step 2: SSH in, stop old uvicorn, start new one ──────────────────────────
echo "[3/3] Restarting uvicorn on Pi..."
ssh "$PI_USER@$PI_HOST" << 'REMOTE'
  echo "--- Stopping existing uvicorn (if any) ---"
  pkill -f "uvicorn main:app" 2>/dev/null && echo "Stopped existing uvicorn." || echo "(No existing uvicorn found — OK)"
  sleep 2

  echo "--- Starting uvicorn ---"
  cd ~/visionai-backend
  source venv/bin/activate
  nohup python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 > ~/visionai-backend/uvicorn.log 2>&1 &
  sleep 3

  echo "--- Verifying uvicorn ---"
  if pgrep -f "uvicorn main:app" > /dev/null; then
    echo ""
    echo "✅ Uvicorn is running!"
    echo ""
    echo "--- Last 15 log lines ---"
    tail -15 ~/visionai-backend/uvicorn.log
  else
    echo ""
    echo "❌ Uvicorn failed to start. Full log:"
    cat ~/visionai-backend/uvicorn.log
    exit 1
  fi
REMOTE

if [ $? -eq 0 ]; then
  echo ""
  echo "=== Deployment complete! ==="
  echo "    Backend running at: http://$PI_HOST:8000"
  echo "    Logs on Pi:         ~/visionai-backend/uvicorn.log"
else
  echo ""
  echo "❌ Deployment failed. Check the SSH output above."
  exit 1
fi
