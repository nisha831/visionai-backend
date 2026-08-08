from fastapi import FastAPI, UploadFile, File, HTTPException
from backend.ai.yolo_detector import YOLODetector
from backend.ai.ocr_reader import OCRReader
import shutil
import os
import cv2

app = FastAPI(
    title="VisionAI Backend",
    version="1.0.0"
)

UPLOAD_FOLDER = "uploads"

os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# Load AI models once when the backend starts
detector = YOLODetector()
ocr = OCRReader()


@app.get("/")
def home():
    return {
        "project": "VisionAI",
        "status": "Backend Running 🚀"
    }


@app.get("/health")
def health():
    return {
        "status": "healthy",
        "yolo": "loaded",
        "ocr": "loaded"
    }


@app.post("/analyze")
async def analyze_image(file: UploadFile = File(...)):

    # Check that the uploaded file is an image
    allowed_types = {
        "image/jpeg",
        "image/png",
        "image/jpg",
        "image/webp"
    }

    if file.content_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail="Only JPG, JPEG, PNG, and WEBP images are allowed."
        )

    file_path = os.path.join(UPLOAD_FOLDER, file.filename)

    # Save uploaded image
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    # Read image and get dimensions
    image = cv2.imread(file_path)

    if image is None:
        raise HTTPException(
            status_code=400,
            detail="Could not read uploaded image."
        )

    height, width = image.shape[:2]

    # Run YOLO object detection
    objects = detector.detect(file_path)

    # Run OCR text detection
    text = ocr.read(file_path)

    return {
        "message": "Image analyzed successfully!",
        "filename": file.filename,
        "image_size": {
            "width": width,
            "height": height
        },
        "objects": objects,
        "text": text
    }