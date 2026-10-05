import os
import subprocess
import time

TMP_CAPTURE_PATH = "/tmp/visionai_pi_capture.jpg"

class CameraCapture:
    def __init__(self, output_path=TMP_CAPTURE_PATH):
        self.output_path = output_path

    def capture_image(self) -> str:
        """
        Captures a single camera frame using rpicam-still (or libcamera-still / fswebcam fallback).
        Verifies that the file exists and has size > 0 before returning.
        """
        print(f"[CAMERA] Capturing image to {self.output_path}...")
        
        # Remove old capture to guarantee fresh image
        if os.path.exists(self.output_path):
            try:
                os.remove(self.output_path)
            except Exception:
                pass

        # Primary command: rpicam-still
        cmd_rpicam = f"rpicam-still --nopreview -o {self.output_path} --width 640 --height 480 --timeout 1000"
        res = subprocess.run(cmd_rpicam, shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        
        if res.returncode == 0 and os.path.exists(self.output_path) and os.path.getsize(self.output_path) > 0:
            file_size = os.path.getsize(self.output_path)
            print(f"[CAMERA] Image captured successfully via rpicam-still ({file_size} bytes).")
            return self.output_path
        else:
            if res.returncode != 0:
                print(f"[CAMERA] rpicam-still returned code {res.returncode}: {res.stderr.strip()}")

        # Fallback command: libcamera-still
        cmd_libcamera = f"libcamera-still -n -o {self.output_path} --width 640 --height 480 -t 1000"
        res2 = subprocess.run(cmd_libcamera, shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        
        if res2.returncode == 0 and os.path.exists(self.output_path) and os.path.getsize(self.output_path) > 0:
            file_size = os.path.getsize(self.output_path)
            print(f"[CAMERA] Image captured successfully via libcamera-still ({file_size} bytes).")
            return self.output_path
        else:
            if res2.returncode != 0:
                print(f"[CAMERA] libcamera-still returned code {res2.returncode}: {res2.stderr.strip()}")

        # Fallback command: fswebcam
        cmd_fswebcam = f"fswebcam -r 640x480 --no-banner {self.output_path}"
        res3 = subprocess.run(cmd_fswebcam, shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

        if os.path.exists(self.output_path) and os.path.getsize(self.output_path) > 0:
            file_size = os.path.getsize(self.output_path)
            print(f"[CAMERA] Image captured successfully via fswebcam ({file_size} bytes).")
            return self.output_path

        raise RuntimeError(f"Failed to capture camera image on Raspberry Pi: file missing or zero bytes.")
