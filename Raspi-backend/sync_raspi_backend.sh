#!/bin/bash
# VisionAI Two-Way Synchronization Script for Raspi-backend
# Synchronizes Mac (~/Desktop/hahaha/Raspi-backend) and Raspberry Pi 5 (kanchannish08@10.137.65.42:/home/kanchannish08/Raspi-backend)

PI_USER="kanchannish08"
PI_HOST="10.137.65.42"
PI_DIR="/home/kanchannish08/Raspi-backend"
MAC_DIR="$(cd "$(dirname "$0")" && pwd)"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

MAC_BACKUP_DIR="${MAC_DIR}_backup_${TIMESTAMP}"
PI_BACKUP_DIR="${PI_DIR}_backup_${TIMESTAMP}"
STAGING_DIR="${MAC_DIR}_pi_staging"

echo "================================================================"
echo "    VisionAI Two-Way Synchronization: Mac ↔ Raspberry Pi 5"
echo "================================================================"
echo "Mac Source: $MAC_DIR"
echo "Pi  Source: $PI_USER@$PI_HOST:$PI_DIR"
echo "Timestamp:  $TIMESTAMP"
echo "================================================================"

# Step 1: Create Mac Backup
echo ""
echo "[STEP 1/6] Creating backup of Mac Raspi-backend..."
cp -r "$MAC_DIR" "$MAC_BACKUP_DIR"
echo "✅ Mac Backup created at: $MAC_BACKUP_DIR"

# Step 2: Create Pi Backup & Fetch files to Staging
echo ""
echo "[STEP 2/6] Creating backup on Raspberry Pi & fetching files..."
ssh -t "$PI_USER@$PI_HOST" "
  if [ -d $PI_DIR ]; then
    echo 'Creating Pi backup to $PI_BACKUP_DIR...'
    cp -r $PI_DIR $PI_BACKUP_DIR
    echo '✅ Pi Backup created successfully'
  else
    echo 'Creating target dir $PI_DIR'
    mkdir -p $PI_DIR
  fi
"

rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR"

echo "Fetching current Raspberry Pi files to staging directory..."
rsync -avz \
  --exclude='venv/' \
  --exclude='.venv/' \
  --exclude='__pycache__/' \
  --exclude='recent_frames/' \
  --exclude='history/' \
  --exclude='.env' \
  --exclude='*.pyc' \
  --exclude='*.log' \
  "$PI_USER@$PI_HOST:$PI_DIR/" "$STAGING_DIR/"

echo "✅ Raspberry Pi files staged at: $STAGING_DIR"

# Step 3: Inspect & Compare Files
echo ""
echo "================================================================"
echo "[STEP 3/6] File List Comparison"
echo "================================================================"
echo "--- Files on Raspberry Pi ---"
(cd "$STAGING_DIR" && find . -maxdepth 3 -type f | sort)

echo ""
echo "--- Files on Mac ---"
(cd "$MAC_DIR" && find . -maxdepth 3 -type f | sort)

echo ""
echo "================================================================"
echo "[STEP 4/6] Copying Pi-only files to Mac & Merging Source Files"
echo "================================================================"

# Copy files present on Pi but missing on Mac (e.g. test_sensor.py, etc.)
cd "$STAGING_DIR"
for file in $(find . -maxdepth 3 -type f); do
  rel_path="${file#./}"
  if [ ! -f "$MAC_DIR/$rel_path" ] && [ "$rel_path" != ".env" ]; then
    echo "➕ Copying Pi-only file to Mac: $rel_path"
    mkdir -p "$(dirname "$MAC_DIR/$rel_path")"
    cp "$STAGING_DIR/$rel_path" "$MAC_DIR/$rel_path"
  fi
done

cd "$MAC_DIR"

# Show Diff for main.py if different
if [ -f "$STAGING_DIR/main.py" ]; then
  echo ""
  echo "--- Diff for main.py (Mac vs Pi) ---"
  diff -u "$STAGING_DIR/main.py" "$MAC_DIR/main.py" || true
fi

# Step 5: Sync Merged Mac Directory to Raspberry Pi
echo ""
echo "================================================================"
echo "[STEP 5/6] Synchronizing Merged Directory to Raspberry Pi"
echo "================================================================"
rsync -avz --progress \
  --exclude='venv/' \
  --exclude='.venv/' \
  --exclude='__pycache__/' \
  --exclude='recent_frames/' \
  --exclude='history/' \
  --exclude='.env' \
  --exclude='*.pyc' \
  --exclude='*.log' \
  "$MAC_DIR/" "$PI_USER@$PI_HOST:$PI_DIR/"

# Step 6: Verify Hashing & Restart Service on Pi
echo ""
echo "================================================================"
echo "[STEP 6/6] Verifying File Hashes & Testing Server on Raspberry Pi"
echo "================================================================"

echo "--- SHA256 Hashes on Mac ---"
shasum -a 256 "$MAC_DIR/main.py" "$MAC_DIR/requirements.txt" 2>/dev/null || true

echo ""
echo "--- SHA256 Hashes on Raspberry Pi ---"
ssh -t "$PI_USER@$PI_HOST" "
  cd $PI_DIR
  shasum -a 256 main.py requirements.txt 2>/dev/null || sha256sum main.py requirements.txt 2>/dev/null || true
  
  echo ''
  echo 'Restarting uvicorn process...'
  pkill -f 'uvicorn main:app' || true
  sleep 1
  if [ -f venv/bin/activate ]; then
    source venv/bin/activate
  fi
  nohup python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 > uvicorn.log 2>&1 &
  sleep 3

  if pgrep -f 'uvicorn main:app' > /dev/null; then
    echo '✅ Server is running on Raspberry Pi!'
  else
    echo '❌ Server failed to start. Logs:'
    cat uvicorn.log
  fi
"

echo ""
echo "--- Testing Endpoints from Mac ---"
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
echo "================================================================"
echo "✅ Two-Way Synchronization & Verification Complete!"
echo "================================================================"
