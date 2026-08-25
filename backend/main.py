from fastapi import FastAPI, UploadFile, File, HTTPException
from backend.ai.yolo_detector import YOLODetector
from backend.ai.ocr_reader import OCRReader
from backend.ai.currency_detector import CurrencyDetector

import shutil
import os
import uuid
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
currency_detector = CurrencyDetector()


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
        "ocr": "loaded",
        "currency_detector": "loaded"
    }


@app.post("/analyze")
async def analyze_image(file: UploadFile = File(...)):

    # Allowed image types
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

    # Generate a unique filename
    extension = os.path.splitext(file.filename)[1]
    safe_filename = f"{uuid.uuid4()}{extension}"

    file_path = os.path.join(
        UPLOAD_FOLDER,
        safe_filename
    )

    # Save uploaded image
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    # Read image
    image = cv2.imread(file_path)

    if image is None:
        raise HTTPException(
            status_code=400,
            detail="Could not read uploaded image."
        )

    # Get image dimensions
    height, width = image.shape[:2]

    # -----------------------------
    # YOLO object detection
    # -----------------------------
    objects = detector.detect(file_path)

    # -----------------------------
    # OCR text detection
    # -----------------------------
    text = ocr.read(file_path)

    # -----------------------------
    # Currency detection
    # -----------------------------
    currencies = currency_detector.detect(text)

    return {
        "message": "Image analyzed successfully!",
        "filename": file.filename,

        "image_size": {
            "width": width,
            "height": height
        },

        "objects": objects,

        "text": text,

        "currencies": currencies
    }