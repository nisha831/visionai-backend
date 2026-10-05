import os
import glob
import time
import json
import uuid
import shutil
import threading
import subprocess
from datetime import datetime
from typing import List, Optional

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from dotenv import load_dotenv

# Load environment variables from .env
load_dotenv()

# System Directories
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
RECENT_FRAMES_DIR = os.path.join(BASE_DIR, "recent_frames")
HISTORY_DIR = os.path.join(BASE_DIR, "history")
TMP_CAPTURE_PATH = "/tmp/visionai_capture.jpg"

os.makedirs(RECENT_FRAMES_DIR, exist_ok=True)
os.makedirs(HISTORY_DIR, exist_ok=True)

# App Configuration
MAX_RECENT_FRAMES = int(os.getenv("MAX_RECENT_FRAMES", "20"))
GEMINI_FRAME_COUNT = int(os.getenv("GEMINI_FRAME_COUNT", "3"))
CAPTURE_INTERVAL = float(os.getenv("CAPTURE_INTERVAL", "1.5"))

# Hardware Pins Configuration (BCM)
TRIG_PIN = int(os.getenv("TRIG_PIN", "23"))
ECHO_PIN = int(os.getenv("ECHO_PIN", "24"))
BUTTON_PIN = int(os.getenv("BUTTON_PIN", "17"))
OBSTACLE_THRESHOLD_CM = float(os.getenv("OBSTACLE_THRESHOLD_CM", "100.0"))

# Initialize FastAPI
app = FastAPI(title="VisionAI Camera & Visual Memory Backend")

# Enable CORS for React Native mobile app access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Gemini SDK Setup
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

gemini_client = None
if GEMINI_API_KEY:
    try:
        from google import genai
        gemini_client = genai.Client(api_key=GEMINI_API_KEY)
    except Exception as e:
        print(f"Warning: google-genai client init failed: {e}")
        try:
            import google.generativeai as legacy_genai
            legacy_genai.configure(api_key=GEMINI_API_KEY)
            gemini_client = "legacy"
        except Exception as le:
            print(f"Warning: google.generativeai client init failed: {le}")

# System prompt tailored for visually impaired assistive vision
ASSISTIVE_VISION_PROMPT = """You are VisionAI, an assistive vision system helping a visually impaired user understand their surroundings.
Answer the user's question accurately and concisely based ONLY on the provided recent images.

Guidelines:
1. Describe visible people and identify visible objects in front of or around the user.
2. Describe the overall surrounding scene clearly.
3. Read visible text (signs, documents, labels) when possible.
4. Identify Indian currency (banknotes/coins, e.g., ₹500, ₹200, ₹100, ₹50, ₹20, ₹10) when clearly visible.
5. Identify potential obstacles or safety hazards nearby.
6. Describe relative positions clearly (e.g., "directly ahead", "slightly to your left", "to your right", "near", "far").
7. NEVER hallucinate details not visible in the images. Do not invent exact distance numbers.
8. If something is unclear or not visible in the images, explicitly state that it is not clear.
9. Keep your tone empathetic, clear, direct, and helpful for a visually impaired person.
"""

# Global State for Continuous Capture
class CameraManager:
    def __init__(self):
        self.is_capturing = False
        self.capture_thread = None
        self.lock = threading.Lock()
        self.current_session_id = None
        self.frame_counter = 0

    def start_capture(self):
        with self.lock:
            if self.is_capturing:
                return False, "Capture already running"
            self.is_capturing = True
            self.frame_counter = 0
            self.current_session_id = datetime.now().strftime("session_%Y%m%d_%H%M%S")
            self.capture_thread = threading.Thread(target=self._capture_loop, daemon=True)
            self.capture_thread.start()
            return True, "Continuous capture started"

    def stop_capture(self):
        with self.lock:
            if not self.is_capturing:
                return False, "Capture not running"
            self.is_capturing = False
            return True, "Continuous capture stopped"

    def _capture_loop(self):
        while self.is_capturing:
            try:
                # Capture frame using rpicam-still
                timestamp = int(time.time() * 1000)
                frame_name = f"frame_{timestamp}.jpg"
                frame_path = os.path.join(RECENT_FRAMES_DIR, frame_name)

                cmd = f"rpicam-still --nopreview -o {frame_path} --width 640 --height 480"
                res = subprocess.run(cmd, shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

                if res.returncode == 0 and os.path.exists(frame_path):
                    # Also update single capture preview file for backward compatibility
                    shutil.copy(frame_path, TMP_CAPTURE_PATH)

                    # Manage rolling buffer limit
                    self._prune_rolling_buffer()
                    self.frame_counter += 1

            except Exception as e:
                print(f"Error during continuous capture loop: {e}")

            time.sleep(CAPTURE_INTERVAL)

    def _prune_rolling_buffer(self):
        try:
            files = sorted(
                glob.glob(os.path.join(RECENT_FRAMES_DIR, "frame_*.jpg")),
                key=os.path.getmtime
            )
            while len(files) > MAX_RECENT_FRAMES:
                oldest = files.pop(0)
                try:
                    os.remove(oldest)
                except Exception as e:
                    print(f"Failed to remove old frame {oldest}: {e}")
        except Exception as e:
            print(f"Buffer prune error: {e}")

    def get_recent_frames(self, count: int = 5) -> List[str]:
        files = sorted(
            glob.glob(os.path.join(RECENT_FRAMES_DIR, "frame_*.jpg")),
            key=os.path.getmtime
        )
        if not files and os.path.exists(TMP_CAPTURE_PATH):
            return [TMP_CAPTURE_PATH]
        return files[-count:]

camera_mgr = CameraManager()

# ==========================================
# HARDWARE MANAGERS (HC-SR04 & GPIO 17 BUTTON)
# ==========================================

# Try importing RPi.GPIO or lgpio gracefully
GPIO_AVAILABLE = False
try:
    import RPi.GPIO as GPIO
    GPIO.setmode(GPIO.BCM)
    GPIO.setwarnings(False)
    GPIO.setup(TRIG_PIN, GPIO.OUT)
    GPIO.setup(ECHO_PIN, GPIO.IN)
    GPIO.setup(BUTTON_PIN, GPIO.IN, pull_up_down=GPIO.PUD_UP)
    GPIO_AVAILABLE = True
    print(f"[HARDWARE] RPi.GPIO initialized on pins TRIG={TRIG_PIN}, ECHO={ECHO_PIN}, BUTTON={BUTTON_PIN}")
except Exception as gpio_err:
    print(f"[HARDWARE] RPi.GPIO not available ({gpio_err}). Hardware features running in compatibility mode.")

class HardwareManager:
    def __init__(self):
        self.latest_distance_cm = 150.0
        self.sensor_connected = True
        self.button_connected = True
        self.button_pressed = False
        self.last_press_timestamp = 0.0
        self.button_press_count = 0
        self.lock = threading.Lock()
        
        # Start background polling threads
        self.running = True
        self.sensor_thread = threading.Thread(target=self._sensor_loop, daemon=True)
        self.button_thread = threading.Thread(target=self._button_loop, daemon=True)
        self.sensor_thread.start()
        self.button_thread.start()

    def _measure_distance(self) -> float:
        if not GPIO_AVAILABLE:
            return 150.0  # Safe default when testing off-Pi

        try:
            # Pulse TRIG for 10us
            GPIO.output(TRIG_PIN, False)
            time.sleep(0.000005)
            GPIO.output(TRIG_PIN, True)
            time.sleep(0.000010)
            GPIO.output(TRIG_PIN, False)

            pulse_start = time.time()
            timeout_start = pulse_start

            # Wait for ECHO start
            while GPIO.input(ECHO_PIN) == 0:
                pulse_start = time.time()
                if pulse_start - timeout_start > 0.04:  # 40ms timeout (~6.8m max)
                    return self.latest_distance_cm

            pulse_end = time.time()
            # Wait for ECHO end
            while GPIO.input(ECHO_PIN) == 1:
                pulse_end = time.time()
                if pulse_end - pulse_start > 0.04:
                    return self.latest_distance_cm

            pulse_duration = pulse_end - pulse_start
            distance = round((pulse_duration * 34300) / 2, 1)
            return max(2.0, min(400.0, distance))
        except Exception as e:
            print(f"[HARDWARE] Sensor reading exception: {e}")
            return self.latest_distance_cm

    def _sensor_loop(self):
        while self.running:
            dist = self._measure_distance()
            with self.lock:
                self.latest_distance_cm = dist
            time.sleep(0.3)

    def _button_loop(self):
        last_state = True  # Pull-up default is HIGH (True)
        debounce_delay = 0.35

        while self.running:
            if GPIO_AVAILABLE:
                try:
                    # Active LOW when pressed
                    current_state = GPIO.input(BUTTON_PIN) == 0
                    now = time.time()

                    with self.lock:
                        self.button_pressed = current_state

                    # Trigger on press transition (LOW) with debounce
                    if current_state and not last_state and (now - self.last_press_timestamp > debounce_delay):
                        with self.lock:
                            self.last_press_timestamp = now
                            self.button_press_count += 1
                        print(f"[HARDWARE] BUTTON PRESSED! Count: {self.button_press_count}")
                        
                        # Auto-trigger single camera capture on button press
                        try:
                            cmd = f"rpicam-still --nopreview -o {TMP_CAPTURE_PATH} --width 640 --height 480"
                            subprocess.run(cmd, shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                        except Exception as capture_err:
                            print(f"[HARDWARE] Button capture error: {capture_err}")

                    last_state = current_state
                except Exception as e:
                    print(f"[HARDWARE] Button loop exception: {e}")
            time.sleep(0.05)

    def get_sensor_data(self):
        with self.lock:
            dist = self.latest_distance_cm
            is_obstacle = dist <= OBSTACLE_THRESHOLD_CM
            return {
                "connected": self.sensor_connected,
                "distance_cm": dist,
                "obstacle": is_obstacle,
                "threshold_cm": OBSTACLE_THRESHOLD_CM,
            }

    def get_button_data(self):
        with self.lock:
            return {
                "connected": self.button_connected,
                "pressed": self.button_pressed,
                "button_press_count": self.button_press_count,
                "last_press_timestamp": self.last_press_timestamp,
            }

hardware_mgr = HardwareManager()

# Helper Functions for Gemini AI
def transcribe_audio(audio_path: str) -> str:
    """Transcribes spoken text from an audio file using Gemini API."""
    if not os.path.exists(audio_path):
        print(f"[STT] ERROR: Audio file does not exist: {audio_path}")
        raise ValueError("Audio file not found")

    file_size = os.path.getsize(audio_path)
    print(f"[STT] Audio file size: {file_size} bytes")

    if file_size < 1000:
        raise ValueError(f"Audio file too small ({file_size} bytes)")

    prompt = (
        "Listen carefully to this audio file. "
        "If you can hear clear spoken English speech, transcribe it EXACTLY word-for-word. "
        "Return ONLY the transcribed words, nothing else. "
        "If the audio is silent, empty, contains only noise, or you cannot clearly understand any speech, "
        "respond with exactly the word: SILENT"
    )

    try:
        if gemini_client == "legacy":
            import google.generativeai as legacy_genai
            audio_file = legacy_genai.upload_file(audio_path)
            model = legacy_genai.GenerativeModel("gemini-3.6-flash")
            res = model.generate_content([prompt, audio_file])
            result = res.text.strip() if res and res.text else ""
        elif gemini_client:
            from google import genai
            audio_file = gemini_client.files.upload(file=audio_path)
            res = gemini_client.models.generate_content(
                model="gemini-3.6-flash",
                contents=[prompt, audio_file]
            )
            result = res.text.strip() if res and res.text else ""
        else:
            from google import genai
            client = genai.Client(api_key=GEMINI_API_KEY)
            audio_file = client.files.upload(file=audio_path)
            res = client.models.generate_content(
                model="gemini-3.6-flash",
                contents=[prompt, audio_file]
            )
            result = res.text.strip() if res and res.text else ""

        if not result or result.upper() == "SILENT" or result.upper().startswith("SILENT"):
            raise ValueError("No speech detected in the recording")

        return result
    except ValueError:
        raise
    except Exception as e:
        print(f"[STT] Gemini transcription exception: {e}")
        raise


def run_gemini_vision_analysis(question: str, recent_frames: List[str]) -> str:
    """Performs visual analysis on recent frames using Gemini API."""
    from PIL import Image as PILImage
    pil_images = [PILImage.open(fp) for fp in recent_frames]

    if gemini_client == "legacy":
        import google.generativeai as legacy_genai
        model = legacy_genai.GenerativeModel("gemini-3.6-flash")
        contents = [ASSISTIVE_VISION_PROMPT, *pil_images, f"User Question: {question}"]
        res = model.generate_content(contents)
        return res.text if res else "No description generated."
    elif gemini_client:
        from google import genai
        contents = [ASSISTIVE_VISION_PROMPT, *pil_images, f"User Question: {question}"]
        res = gemini_client.models.generate_content(
            model="gemini-3.6-flash",
            contents=contents
        )
        return res.text if res else "No description generated."
    else:
        from google import genai
        client = genai.Client(api_key=GEMINI_API_KEY)
        res = client.models.generate_content(
            model="gemini-3.6-flash",
            contents=[ASSISTIVE_VISION_PROMPT, *pil_images, f"User Question: {question}"]
        )
        return res.text if res else "No description generated."


# Request Models
class AskRequest(BaseModel):
    question: str

# Existing & Preserved Endpoints
@app.get("/")
def home():
    return {
        "app": "VisionAI Backend",
        "status": "online",
        "is_capturing": camera_mgr.is_capturing
    }

@app.post("/camera/capture")
def capture_image():
    """Existing endpoint preserved for single manual capture."""
    try:
        cmd = f"rpicam-still --nopreview -o {TMP_CAPTURE_PATH} --width 640 --height 480"
        res = subprocess.run(cmd, shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if res.returncode != 0:
            raise HTTPException(status_code=500, detail="rpicam-still failed to capture image")

        timestamp = int(time.time() * 1000)
        buf_frame = os.path.join(RECENT_FRAMES_DIR, f"frame_{timestamp}.jpg")
        shutil.copy(TMP_CAPTURE_PATH, buf_frame)
        camera_mgr._prune_rolling_buffer()

        return {"message": "Image captured successfully", "status": "success", "image_url": "/camera/image"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/camera/image")
def get_image():
    """Existing endpoint preserved for retrieving latest single capture."""
    if not os.path.exists(TMP_CAPTURE_PATH):
        raise HTTPException(status_code=404, detail="No image captured yet")
    return FileResponse(TMP_CAPTURE_PATH, media_type="image/jpeg")

# Continuous Camera Endpoints
@app.post("/camera/start")
def start_camera():
    success, msg = camera_mgr.start_capture()
    return {
        "status": "started" if success else "already_running",
        "message": msg,
        "is_capturing": camera_mgr.is_capturing,
        "session_id": camera_mgr.current_session_id
    }

@app.post("/camera/stop")
def stop_camera():
    success, msg = camera_mgr.stop_capture()
    return {
        "status": "stopped" if success else "not_running",
        "message": msg,
        "is_capturing": camera_mgr.is_capturing,
        "session_id": camera_mgr.current_session_id,
        "captured_frames_count": camera_mgr.frame_counter
    }

@app.get("/camera/status")
def camera_status():
    recent_frames = camera_mgr.get_recent_frames(MAX_RECENT_FRAMES)
    return {
        "is_capturing": camera_mgr.is_capturing,
        "session_id": camera_mgr.current_session_id,
        "buffer_frame_count": len(recent_frames)
    }

# ==========================================
# NEW SENSOR AND BUTTON ENDPOINTS
# ==========================================

@app.get("/sensor/distance")
def get_sensor_distance():
    return hardware_mgr.get_sensor_data()

@app.get("/sensor/status")
def get_sensor_status():
    return hardware_mgr.get_sensor_data()

@app.get("/button/status")
def get_button_status():
    return hardware_mgr.get_button_data()

# Gemini Visual Analysis Endpoint
@app.post("/ask")
def ask_question(req: AskRequest):
    question = req.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question cannot be empty.")

    recent_frames = camera_mgr.get_recent_frames(GEMINI_FRAME_COUNT)
    if not recent_frames:
        raise HTTPException(status_code=400, detail="No images available in buffer. Turn camera ON first.")

    if not GEMINI_API_KEY:
        answer = "GEMINI_API_KEY is not configured on the Raspberry Pi."
    else:
        try:
            answer = run_gemini_vision_analysis(question, recent_frames)
        except Exception as e:
            answer = f"Error querying Gemini API: {str(e)}"

    session_id = camera_mgr.current_session_id or datetime.now().strftime("session_%Y%m%d_%H%M%S")
    session_dir = os.path.join(HISTORY_DIR, session_id)
    os.makedirs(session_dir, exist_ok=True)

    saved_image_names = []
    for idx, frame_path in enumerate(recent_frames):
        fname = f"frame_{idx + 1:03d}.jpg"
        dest = os.path.join(session_dir, fname)
        shutil.copy(frame_path, dest)
        saved_image_names.append(fname)

    metadata = {
        "session_id": session_id,
        "timestamp": datetime.now().isoformat(),
        "question": question,
        "answer": answer,
        "image_count": len(saved_image_names),
        "images": saved_image_names,
        "source": "text"
    }

    with open(os.path.join(session_dir, "metadata.json"), "w") as f:
        json.dump(metadata, f, indent=2)

    return {
        "session_id": session_id,
        "timestamp": metadata["timestamp"],
        "question": question,
        "answer": answer,
        "images": [f"/history/{session_id}/image/{img}" for img in saved_image_names]
    }

@app.post("/voice/process")
async def process_voice(file: UploadFile = File(...)):
    if not file:
        raise HTTPException(status_code=400, detail="No audio file uploaded.")

    ext = os.path.splitext(file.filename or "")[1] or ".m4a"
    temp_audio_name = f"voice_{uuid.uuid4()}{ext}"
    temp_audio_path = os.path.join("/tmp", temp_audio_name)

    try:
        content = await file.read()
        with open(temp_audio_path, "wb") as buffer:
            buffer.write(content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save uploaded audio: {e}")

    saved_size = os.path.getsize(temp_audio_path) if os.path.exists(temp_audio_path) else 0

    if saved_size < 1000:
        if os.path.exists(temp_audio_path):
            os.remove(temp_audio_path)
        raise HTTPException(status_code=400, detail="Audio file is too small.")

    if not GEMINI_API_KEY:
        if os.path.exists(temp_audio_path):
            os.remove(temp_audio_path)
        raise HTTPException(status_code=400, detail="GEMINI_API_KEY is not configured.")

    try:
        transcript = transcribe_audio(temp_audio_path)
    except Exception as e:
        if os.path.exists(temp_audio_path):
            os.remove(temp_audio_path)
        raise HTTPException(status_code=500, detail=f"Speech-to-text failed: {e}")

    recent_frames = camera_mgr.get_recent_frames(GEMINI_FRAME_COUNT)
    if not recent_frames:
        raise HTTPException(status_code=400, detail="No recent camera frames available.")

    try:
        answer = run_gemini_vision_analysis(transcript, recent_frames)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gemini visual analysis failed: {str(e)}")

    session_id = camera_mgr.current_session_id or datetime.now().strftime("session_%Y%m%d_%H%M%S")
    session_dir = os.path.join(HISTORY_DIR, session_id)
    os.makedirs(session_dir, exist_ok=True)

    saved_image_names = []
    for idx, frame_path in enumerate(recent_frames):
        fname = f"frame_{idx + 1:03d}.jpg"
        dest = os.path.join(session_dir, fname)
        shutil.copy(frame_path, dest)
        saved_image_names.append(fname)

    return {
        "transcript": transcript,
        "question": transcript,
        "answer": answer,
        "session_id": session_id,
        "images": [f"/history/{session_id}/image/{img}" for img in saved_image_names]
    }

# Persistent History Endpoints
@app.get("/history")
def get_history():
    sessions = []
    if os.path.exists(HISTORY_DIR):
        for s_name in sorted(os.listdir(HISTORY_DIR), reverse=True):
            meta_path = os.path.join(HISTORY_DIR, s_name, "metadata.json")
            if os.path.exists(meta_path):
                try:
                    with open(meta_path, "r") as f:
                        data = json.load(f)
                        data["images_urls"] = [f"/history/{s_name}/image/{img}" for img in data.get("images", [])]
                        sessions.append(data)
                except Exception:
                    pass
    return {"sessions": sessions}

@app.get("/history/{session_id}/image/{filename}")
def get_history_image(session_id: str, filename: str):
    file_path = os.path.join(HISTORY_DIR, session_id, filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="History image not found")
    return FileResponse(file_path, media_type="image/jpeg")
