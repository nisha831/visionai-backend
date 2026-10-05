import time
import sys
import os

from raspberry_pi.distance_sensor import DistanceSensor
from raspberry_pi.camera_capture import CameraCapture
from raspberry_pi.button_listener import ButtonListener
from raspberry_pi.pi_client import PiClient

def get_distance_status(distance_cm: float | None) -> str:
    if distance_cm is None:
        return "UNAVAILABLE"
    elif distance_cm > 150.0:
        return "PATH CLEAR"
    elif distance_cm > 100.0:
        return "OBJECT AHEAD"
    elif distance_cm > 50.0:
        return "CAUTION"
    else:
        return "VERY CLOSE"

def main():
    print("==================================================")
    print("      VisionAI Raspberry Pi Hardware Controller")
    print("==================================================")

    backend_url = os.getenv("VISIONAI_BACKEND_URL", "http://10.137.65.68:8000")
    print(f"Connecting to FastAPI Backend: {backend_url}")

    sensor = DistanceSensor()
    camera = CameraCapture()
    client = PiClient(backend_url)

    def on_button_press():
        print("\n[PI_MAIN] Physical button capture triggered")
        try:
            current_dist = sensor.get_distance_cm()
            img_path = camera.capture_image()
            result = client.send_capture(img_path, distance_cm=current_dist)
            if result:
                desc = result.get('scene', {}).get('description', '')
                print(f"[PI_MAIN] Analysis complete: {desc}")
            else:
                print(f"[PI_MAIN] Analysis failed: No response from backend")
        except Exception as e:
            print(f"[PI_MAIN] Error during button capture workflow: {e}")

    button = ButtonListener(on_press_callback=on_button_press)
    button.start()

    print("[PI_MAIN] Starting continuous distance monitoring loop...")
    heartbeat_counter = 0

    try:
        while True:
            distance_cm = sensor.get_distance_cm()
            status_str = get_distance_status(distance_cm)

            # Send continuous distance update to backend and check if capture was requested
            res_data = client.send_distance(distance_cm, status_str)
            if res_data and isinstance(res_data, dict) and res_data.get("capture_requested"):
                print("\n[PI_MAIN] 📷 External capture command received from backend/app! Triggering capture & AI pipeline...")
                on_button_press()

            # Send heartbeat every ~5 seconds
            heartbeat_counter += 1
            if heartbeat_counter >= 10:
                sensor_ok = distance_cm is not None
                client.send_heartbeat(camera_ok=True, distance_sensor=sensor_ok, button_ok=True)
                heartbeat_counter = 0

            time.sleep(0.5)

    except KeyboardInterrupt:
        print("\n[PI_MAIN] Stopping Raspberry Pi controller...")
    finally:
        button.stop()
        sensor.cleanup()

if __name__ == "__main__":
    main()
