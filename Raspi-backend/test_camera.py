#!/usr/bin/env python3
"""
VisionAI Direct Hardware Test — Raspberry Pi Camera
Captures a real image using rpicam-still (or libcamera-still / fswebcam),
verifies output file existence and non-zero file size.
"""
import os
import sys
import subprocess
import time

TEST_OUTPUT_PATH = "/tmp/visionai_camera_test.jpg"

def main():
    print("[CAMERA TEST] Starting camera test...")
    if os.path.exists(TEST_OUTPUT_PATH):
        try:
            os.remove(TEST_OUTPUT_PATH)
        except Exception:
            pass

    # Try rpicam-still first
    commands = [
        ("rpicam-still", f"rpicam-still --nopreview -o {TEST_OUTPUT_PATH} --width 640 --height 480 --timeout 1000"),
        ("libcamera-still", f"libcamera-still -n -o {TEST_OUTPUT_PATH} --width 640 --height 480 -t 1000"),
        ("fswebcam", f"fswebcam -r 640x480 --no-banner {TEST_OUTPUT_PATH}")
    ]

    success = False
    used_cmd = None

    for cmd_name, cmd_str in commands:
        print(f"[CAMERA TEST] Testing command: {cmd_str}")
        res = subprocess.run(cmd_str, shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if res.returncode == 0 and os.path.exists(TEST_OUTPUT_PATH) and os.path.getsize(TEST_OUTPUT_PATH) > 0:
            success = True
            used_cmd = cmd_name
            break
        else:
            print(f"[CAMERA TEST] {cmd_name} failed (exit code {res.returncode}): {res.stderr.strip()}")

    if success and os.path.exists(TEST_OUTPUT_PATH):
        file_size = os.path.getsize(TEST_OUTPUT_PATH)
        if file_size > 0:
            print("[CAMERA TEST] Capture successful")
            print(f"[CAMERA TEST] Command used: {used_cmd}")
            print(f"[CAMERA TEST] File: {TEST_OUTPUT_PATH}")
            print(f"[CAMERA TEST] Size: {file_size} bytes")
            sys.exit(0)

    print("❌ [CAMERA TEST] Camera capture failed: File missing or 0 bytes.")
    sys.exit(1)

if __name__ == "__main__":
    main()
