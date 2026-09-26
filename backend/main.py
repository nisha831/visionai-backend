
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from backend.ai.yolo_detector import YOLODetector
from backend.ai.ocr_reader import OCRReader
from backend.ai.currency_detector import CurrencyDetector
from backend.ai.currency_model import CurrencyModel
from backend.ai.currency_fusion import CurrencyFusion

import shutil
import os
import uuid
import cv2


# ==================================================
# FastAPI application
# ==================================================

app = FastAPI(
    title="VisionAI Backend",
    version="1.0.0"
)


# ==================================================
# CORS
# ==================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5500",
        "http://localhost:5500"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==================================================
# Upload folder
# ==================================================

UPLOAD_FOLDER = "uploads"

os.makedirs(
    UPLOAD_FOLDER,
    exist_ok=True
)


# ==================================================
# Load AI models
# ==================================================

print("Loading VisionAI models...")

detector = YOLODetector()

ocr = OCRReader()

currency_detector = CurrencyDetector()

currency_model = CurrencyModel()

fusion = CurrencyFusion()

print("All VisionAI models loaded.")


# ==================================================
# Home endpoint
# ==================================================

@app.get("/")
def home():

    return {
        "project": "VisionAI",
        "status": "Backend Running"
    }


# ==================================================
# Health endpoint
# ==================================================

@app.get("/health")
def health():

    return {
        "status": "healthy",
        "yolo": "loaded",
        "ocr": "loaded",
        "currency_detector": "loaded",
        "currency_model": "loaded",
        "currency_fusion": "loaded"
    }


# ==================================================
# Analyze image
# ==================================================

@app.post("/analyze")
async def analyze_image(
    file: UploadFile = File(...)
):

    # ==================================================
    # 1. Validate file type
    # ==================================================

    allowed_types = {
        "image/jpeg",
        "image/png",
        "image/jpg",
        "image/webp"
    }

    if file.content_type not in allowed_types:

        raise HTTPException(
            status_code=400,
            detail=(
                "Only JPG, JPEG, PNG, and WEBP "
                "images are allowed."
            )
        )

    # ==================================================
    # 2. Create safe filename
    # ==================================================

    original_filename = (
        file.filename
        if file.filename
        else "image.jpg"
    )

    extension = os.path.splitext(
        original_filename
    )[1]

    if not extension:
        extension = ".jpg"

    safe_filename = (
        f"{uuid.uuid4()}{extension}"
    )

    file_path = os.path.join(
        UPLOAD_FOLDER,
        safe_filename
    )

    # ==================================================
    # 3. Save uploaded image
    # ==================================================

    with open(
        file_path,
        "wb"
    ) as buffer:

        shutil.copyfileobj(
            file.file,
            buffer
        )

    # ==================================================
    # 4. Read image
    # ==================================================

    image = cv2.imread(
        file_path
    )

    if image is None:

        raise HTTPException(
            status_code=400,
            detail="Could not read uploaded image."
        )

    # ==================================================
    # 5. Get image dimensions
    # ==================================================

    height, width = image.shape[:2]

    # ==================================================
    # 6. General object detection
    # ==================================================

    objects = detector.detect(
        file_path
    )

    # ==================================================
    # 7. OCR
    # ==================================================

    text = ocr.read(
        file_path
    )

    # ==================================================
    # 8. Detect Indian currency from OCR
    # ==================================================

    currencies = currency_detector.detect(
        text
    )

    # ==================================================
    # 9. Indian currency YOLO model
    # ==================================================

    currency_predictions = currency_model.detect(
        file_path
    )

    # ==================================================
    # 10. Evidence fusion
    # ==================================================

    final_currency = fusion.decide(
        currencies,
        currency_predictions
    )

    # ==================================================
    # 11. Final API response
    # ==================================================

    return {

        "message":
            "Image analyzed successfully!",

        "filename":
            original_filename,

        "image_size": {

            "width":
                width,

            "height":
                height
        },

        "objects":
            objects,

        "text":
            text,

        "currencies":
            currencies,

        "currency_predictions":
            currency_predictions,

        "final_currency":
            final_currency
    }

