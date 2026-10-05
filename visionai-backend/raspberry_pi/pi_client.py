import os
import requests

DEFAULT_BACKEND_URL = os.getenv("VISIONAI_BACKEND_URL", "http://10.137.65.68:8000")

class PiClient:
    """
    Communicates hardware events & measurements from Raspberry Pi 5 to FastAPI AI Backend.
    """
    def __init__(self, backend_url=DEFAULT_BACKEND_URL):
        self.backend_url = backend_url.rstrip("/")

    def send_heartbeat(self, camera_ok=True, sensor_ok=True, button_ok=True) -> bool:
        try:
            url = f"{self.backend_url}/hardware/heartbeat"
            payload = {
                "camera": camera_ok,
                "distance_sensor": sensor_ok,
                "button": button_ok,
            }
            res = requests.post(url, json=payload, timeout=3)
            return res.status_code == 200
        except Exception as e:
            print(f"[PI_CLIENT] Heartbeat error: {e}")
            return False

    def send_distance(self, distance_cm: float | None, status_str: str) -> dict | None:
        try:
            url = f"{self.backend_url}/distance"
            payload = {
                "distance_cm": distance_cm,
                "status": status_str,
            }
            res = requests.post(url, json=payload, timeout=3)
            if res.status_code == 200:
                return res.json()
            return None
        except Exception as e:
            print(f"[PI_CLIENT] Distance update error: {e}")
            return None

    def send_capture(self, image_path: str, distance_cm: float = None) -> dict:
        print(f"[PI_CLIENT] Uploading image: {image_path}")
        print(f"[PI_CLIENT] Backend URL: {self.backend_url}")
        try:
            url = f"{self.backend_url}/analyze"
            params = {}
            if distance_cm is not None:
                params["distance_cm"] = str(distance_cm)

            with open(image_path, "rb") as f:
                files = {"file": ("capture.jpg", f, "image/jpeg")}
                res = requests.post(url, files=files, params=params, timeout=15)

            print(f"[PI_CLIENT] Upload HTTP status: {res.status_code}")

            if res.status_code == 200:
                print("[PI_CLIENT] Image upload successful — Backend analysis received")
                return res.json()
            else:
                print(f"[PI_CLIENT] Upload failed ({res.status_code}): {res.text}")
                return None
        except Exception as e:
            print(f"[PI_CLIENT] Upload failed with exception: {e}")
            return None
