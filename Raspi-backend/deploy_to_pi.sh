#!/bin/bash
# VisionAI Deployment Script: Sync Mac Raspi-backend to Raspberry Pi 5
# Target: kanchannish08@10.137.65.42:/home/kanchannish08/Raspi-backend

PI_USER="kanchannish08"
PI_HOST="10.137.65.42"
TARGET_DIR="/home/kanchannish08/Raspi-backend"
LOCAL_DIR="$(cd "$(dirname "$0")" && pwd)"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/home/kanchannish08/Raspi-backend_backup_${TIMESTAMP}"

echo "=========================================================="
echo "   VisionAI Raspi-backend Deployment to Raspberry Pi 5"
echo "=========================================================="
echo "Local Source: $LOCAL_DIR"
echo "Remote Target: $PI_USER@$PI_HOST:$TARGET_DIR"
echo "Backup Dir:    $BACKUP_DIR"
echo "=========================================================="

echo ""
echo "[1/4] Creating timestamped backup on Raspberry Pi..."
ssh -t "$PI_USER@$PI_HOST" "
  if [ -d $TARGET_DIR ]; then
    echo 'Creating backup of existing $TARGET_DIR to $BACKUP_DIR...'
    cp -r $TARGET_DIR $BACKUP_DIR
    echo 'Backup created successfully at $BACKUP_DIR'
  else
    echo 'No existing $TARGET_DIR found. Creating target directory...'
    mkdir -p $TARGET_DIR
  fi
"

if [ $? -ne 0 ]; then
  echo "❌ Failed to create backup on Pi."
  exit 1
fi

echo ""
echo "[2/4] Syncing current Mac Raspi-backend folder to Raspberry Pi..."
rsync -avz --progress \
  --exclude='venv/' \
  --exclude='.venv/' \
  --exclude='__pycache__/' \
  --exclude='recent_frames/' \
  --exclude='history/' \
  --exclude='*.pyc' \
  --exclude='*.log' \
  "$LOCAL_DIR/" \
  "$PI_USER@$PI_HOST:$TARGET_DIR/"

if [ $? -ne 0 ]; then
  echo "❌ rsync failed to copy files to Pi."
  exit 1
fi

echo ""
echo "[3/4] Checking python environment and starting uvicorn server on Pi..."
ssh -t "$PI_USER@$PI_HOST" "
  cd $TARGET_DIR
  echo 'Stopping any existing uvicorn processes...'
  pkill -f 'uvicorn main:app' || true
  sleep 1

  echo 'Starting uvicorn on $PI_HOST:8000...'
  if [ -f venv/bin/activate ]; then
    source venv/bin/activate
  fi

  nohup python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 > uvicorn.log 2>&1 &
  sleep 3

  if pgrep -f 'uvicorn main:app' > /dev/null; then
    echo '✅ Uvicorn is running successfully on Raspberry Pi!'
    echo '--- Log Output ---'
    tail -n 15 uvicorn.log
  else
    echo '❌ Uvicorn failed to start. Log output:'
    cat uvicorn.log
    exit 1
  fi
"

echo ""
echo "[4/4] Verifying endpoints from Mac..."
echo "Testing GET http://$PI_HOST:8000/..."
curl -s "http://$PI_HOST:8000/"

echo ""
echo "Testing GET http://$PI_HOST:8000/sensor/distance..."
curl -s "http://$PI_HOST:8000/sensor/distance"

echo ""
echo "Testing GET http://$PI_HOST:8000/button/status..."
curl -s "http://$PI_HOST:8000/button/status"

echo ""
echo ""
echo "=== Deployment Complete ==="
