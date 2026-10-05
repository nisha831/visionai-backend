#!/usr/bin/env python3
"""
Standalone test script for HC-SR04 Ultrasonic Distance Sensor on Raspberry Pi 5.
Hardware Configuration:
  TRIG = BCM GPIO 23
  ECHO = BCM GPIO 24
  Obstacle Threshold = 100 cm
"""

import time
import os

TRIG_PIN = int(os.getenv("TRIG_PIN", "23"))
ECHO_PIN = int(os.getenv("ECHO_PIN", "24"))
THRESHOLD_CM = 100.0

print(f"=== HC-SR04 Ultrasonic Distance Sensor Test ===")
print(f"Configured Pins: TRIG=GPIO {TRIG_PIN}, ECHO=GPIO {ECHO_PIN}")
print(f"Obstacle Threshold: {THRESHOLD_CM} cm\n")

try:
    import RPi.GPIO as GPIO
    GPIO.setmode(GPIO.BCM)
    GPIO.setwarnings(False)
    GPIO.setup(TRIG_PIN, GPIO.OUT)
    GPIO.setup(ECHO_PIN, GPIO.IN)
    
    def measure_distance():
        GPIO.output(TRIG_PIN, False)
        time.sleep(0.000005)
        GPIO.output(TRIG_PIN, True)
        time.sleep(0.000010)
        GPIO.output(TRIG_PIN, False)

        pulse_start = time.time()
        timeout = pulse_start

        while GPIO.input(ECHO_PIN) == 0:
            pulse_start = time.time()
            if pulse_start - timeout > 0.04:
                return None

        pulse_end = time.time()
        while GPIO.input(ECHO_PIN) == 1:
            pulse_end = time.time()
            if pulse_end - pulse_start > 0.04:
                return None

        duration = pulse_end - pulse_start
        distance = (duration * 34300) / 2
        return round(distance, 1)

    print("Reading distance sensor... Press Ctrl+C to exit.\n")
    while True:
        dist = measure_distance()
        if dist is not None:
            status = "🚨 OBSTACLE DETECTED" if dist <= THRESHOLD_CM else "✓ PATH CLEAR"
            print(f"Distance: {dist:5.1f} cm | Status: {status}")
        else:
            print("Distance reading timeout")
        time.sleep(0.5)

except KeyboardInterrupt:
    print("\nExiting sensor test.")
except Exception as e:
    print(f"Sensor error or non-Pi hardware: {e}")
finally:
    try:
        import RPi.GPIO as GPIO
        GPIO.cleanup()
    except Exception:
        pass
