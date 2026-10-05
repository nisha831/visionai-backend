import os
import time

TRIG_PIN = int(os.getenv("TRIG_PIN", "23"))
ECHO_PIN = int(os.getenv("ECHO_PIN", "24"))

GPIO_AVAILABLE = False
try:
    import RPi.GPIO as GPIO
    GPIO.setmode(GPIO.BCM)
    GPIO.setwarnings(False)
    GPIO.setup(TRIG_PIN, GPIO.OUT)
    GPIO.setup(ECHO_PIN, GPIO.IN)
    GPIO_AVAILABLE = True
except Exception:
    GPIO_AVAILABLE = False

class DistanceSensor:
    def __init__(self, trig_pin=TRIG_PIN, echo_pin=ECHO_PIN):
        self.trig_pin = trig_pin
        self.echo_pin = echo_pin
        self.last_valid_distance = None
        self.last_valid_timestamp = 0.0

    def _single_pulse(self) -> float | None:
        if not GPIO_AVAILABLE:
            return None

        try:
            # Ensure TRIG is LOW before pulse
            GPIO.output(self.trig_pin, False)
            time.sleep(0.000002)

            # Send 10us TRIG pulse
            GPIO.output(self.trig_pin, True)
            time.sleep(0.000010)
            GPIO.output(self.trig_pin, False)

            # Wait for ECHO start (high) with 15ms timeout
            start_time = time.time()
            timeout_start = start_time
            while GPIO.input(self.echo_pin) == 0:
                start_time = time.time()
                if start_time - timeout_start > 0.015:
                    return None

            # Wait for ECHO end (low) with 30ms timeout (~5m max range)
            end_time = time.time()
            timeout_end = end_time
            while GPIO.input(self.echo_pin) == 1:
                end_time = time.time()
                if end_time - timeout_end > 0.030:
                    return None

            duration = end_time - start_time
            distance = (duration * 34300.0) / 2.0
            distance = round(distance, 1)

            if 2.0 <= distance <= 400.0:
                return distance
            return None
        except Exception:
            return None

    def get_distance_cm(self) -> float | None:
        if not GPIO_AVAILABLE:
            return self.last_valid_distance

        samples = []
        for _ in range(3):
            val = self._single_pulse()
            if val is not None:
                samples.append(val)
            time.sleep(0.005)

        if samples:
            samples.sort()
            median_dist = samples[len(samples) // 2]
            self.last_valid_distance = median_dist
            self.last_valid_timestamp = time.time()
            return median_dist

        # If recent valid reading within 2 seconds, reuse it; otherwise return None (unavailable)
        if self.last_valid_distance is not None and (time.time() - self.last_valid_timestamp < 2.0):
            return self.last_valid_distance

        return None

    def cleanup(self):
        if GPIO_AVAILABLE:
            try:
                GPIO.cleanup([self.trig_pin, self.echo_pin])
            except Exception:
                pass
