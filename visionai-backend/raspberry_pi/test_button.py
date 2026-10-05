#!/usr/bin/env python3
"""
VisionAI Direct Hardware Test — GPIO 17 Push Button
Tests physical GPIO 17 button without FastAPI, Expo, or AI dependencies.
BCM GPIO 17, Active LOW (Internal Pull-Up).
"""
import sys
import time

BUTTON_PIN = 17

try:
    import RPi.GPIO as GPIO
    GPIO.setmode(GPIO.BCM)
    GPIO.setwarnings(False)
    GPIO.setup(BUTTON_PIN, GPIO.IN, pull_up_down=GPIO.PUD_UP)
    print(f"[BUTTON TEST] Initialized BCM GPIO {BUTTON_PIN} with internal pull-up (Active LOW).")
except Exception as e:
    print(f"[BUTTON TEST] Error initializing RPi.GPIO: {e}")
    sys.exit(1)

def main():
    print(f"[BUTTON TEST] Listening on GPIO {BUTTON_PIN}... Press CTRL+C to exit.")
    last_state = None
    try:
        while True:
            # Active LOW: 0 = Pressed, 1 = Released
            pin_val = GPIO.input(BUTTON_PIN)
            is_pressed = (pin_val == 0)

            if is_pressed != last_state:
                if is_pressed:
                    print(f"[BUTTON TEST] BUTTON PRESSED | GPIO {BUTTON_PIN} = LOW (0)")
                else:
                    print(f"[BUTTON TEST] BUTTON RELEASED | GPIO {BUTTON_PIN} = HIGH (1)")
                last_state = is_pressed

            time.sleep(0.05)
    except KeyboardInterrupt:
        print("\n[BUTTON TEST] Test stopped by user.")
    finally:
        GPIO.cleanup(BUTTON_PIN)

if __name__ == "__main__":
    main()
