import os
import time
import threading

BUTTON_PIN = int(os.getenv("BUTTON_PIN", "17"))

GPIO_AVAILABLE = False
try:
    import RPi.GPIO as GPIO
    GPIO.setmode(GPIO.BCM)
    GPIO.setwarnings(False)
    GPIO.setup(BUTTON_PIN, GPIO.IN, pull_up_down=GPIO.PUD_UP)
    GPIO_AVAILABLE = True
except Exception:
    GPIO_AVAILABLE = False

class ButtonListener:
    """
    Monitors physical push button on BCM GPIO 17 (active LOW with internal pull-up).
    Debounces presses and invokes on_press callback when pressed.
    """
    def __init__(self, pin=BUTTON_PIN, on_press_callback=None, debounce_time=0.4):
        self.pin = pin
        self.on_press_callback = on_press_callback
        self.debounce_time = debounce_time
        self.running = False
        self.thread = None
        self.last_press_time = 0.0

    def start(self):
        if self.running:
            return
        self.running = True
        self.thread = threading.Thread(target=self._loop, daemon=True)
        self.thread.start()
        print(f"[BUTTON] Listener started on BCM GPIO {self.pin}")

    def stop(self):
        self.running = False

    def _loop(self):
        last_state = False # False = Released (HIGH/1), True = Pressed (LOW/0)
        while self.running:
            if GPIO_AVAILABLE:
                try:
                    # Active LOW: GPIO.input(self.pin) == 0 means button is physically pressed
                    current_pressed = (GPIO.input(self.pin) == 0)
                    now = time.time()

                    # Trigger ONLY on transition from NOT pressed -> PRESSED (Edge trigger) with debounce
                    if current_pressed and not last_state and (now - self.last_press_time > self.debounce_time):
                        self.last_press_time = now
                        print(f"[BUTTON] Physical GPIO {self.pin} button pressed!")
                        if self.on_press_callback:
                            try:
                                self.on_press_callback()
                            except Exception as err:
                                print(f"[BUTTON] Error in press callback: {err}")

                    last_state = current_pressed
                except Exception as e:
                    print(f"[BUTTON] Error reading GPIO {self.pin}: {e}")
            time.sleep(0.05)
