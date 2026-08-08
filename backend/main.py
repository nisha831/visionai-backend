from fastapi import FastAPI, UploadFile, File
from backend.ai.yolo_detector import YOLODetector
import shutil
import os

app = FastAPI(
    title="VisionAI Backend",
    version="1.0.0"
)

UPLOAD_FOLDER = "uploads"

os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# Load YOLO once when the backend starts
detector = YOLODetector()


@app.get("/")
def home():
    return {
        "project": "VisionAI",
        "status": "Backend Running 🚀"
    }


@app.get("/health")
def health():
    return {
        "status": "healthy"
    }


@app.post("/analyze")
async def analyze_image(file: UploadFile = File(...)):

    file_path = os.path.join(UPLOAD_FOLDER, file.filename)

    # Save uploaded image
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    # Run YOLO object detection
    objects = detector.detect(file_path)

    return {
        "message": "Image analyzed successfully!",
        "filename": file.filename,
        "objects": objects
    }