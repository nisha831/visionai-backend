from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.cors import CORSMiddleware
from backend.ai.yolo_detector import YOLODetector
from backend.ai.ocr_reader import OCRReader
from backend.ai.currency_detector import CurrencyDetector
from backend.ai.currency_model import CurrencyModel

import shutil
import os
import uuid
import cv2
import re


app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5500", "http://localhost:5500"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app = FastAPI(
    title="VisionAI Backend",
    version="1.0.0"
)

app.add_middleware(CORSMiddleware, allow_origins=["http://127.0.0.1:5500", "http://localhost:5500"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


UPLOAD_FOLDER = "uploads"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)


# Load models
detector = YOLODetector()
ocr = OCRReader()
currency_detector = CurrencyDetector()
currency_model = CurrencyModel()


VALID_DENOMINATIONS = {
    "5",
    "10",
    "20",
    "50",
    "100",
    "200",
    "500",
    "2000"
}


def clean_ocr_text(text):

    text = str(text).upper()

    text = text.replace("₹", "")
    text = text.replace(",", "")
    text = text.replace(".", "")
    text = text.replace("{", "")
    text = text.replace("}", "")
    text = text.replace("[", "")
    text = text.replace("]", "")
    text = text.strip()

    return text


def get_ocr_evidence(text):

    evidence = []

    for item in text:

        raw = item.get("text", "")
        confidence = float(
            item.get("confidence", 0)
        )

        cleaned = clean_ocr_text(raw)

        # -----------------------------------------
        # EXACT denomination
        # -----------------------------------------

        if cleaned in VALID_DENOMINATIONS:

            evidence.append({
                "name": cleaned,
                "confidence": confidence,
                "text": raw,
                "type": "exact"
            })

            continue

        # -----------------------------------------
        # NOISY OCR
        #
        # Look only for denominations with
        # TWO OR MORE DIGITS.
        #
        # This prevents:
        #
        # 850 -> 5
        #
        # from happening.
        # -----------------------------------------

        for denomination in [
            "2000",
            "500",
            "200",
            "100",
            "50",
            "20",
            "10"
        ]:

            if denomination in cleaned:

                evidence.append({
                    "name": denomination,
                    "confidence": confidence,
                    "text": raw,
                    "type": "noisy"
                })

                break

    return evidence


def choose_currency(text, yolo):

    ocr = get_ocr_evidence(text)

    # ==================================================
    # SPECIAL CASE: ₹50
    # ==================================================
    #
    # Your real ₹50 image contains OCR such as:
    #
    # 850
    # 5ECL973735
    #
    # We know the standalone "5" is misleading.
    #
    # If OCR contains a noisy 50 signal, prefer it.
    # ==================================================

    fifty = [
        x for x in ocr
        if x["name"] == "50"
    ]

    if fifty:

        best = max(
            fifty,
            key=lambda x: x["confidence"]
        )

        return {
            "name": "50",
            "confidence": round(
                best["confidence"],
                2
            ),
            "source": "ocr"
        }


    # ==================================================
    # OTHER MULTI-DIGIT OCR RESULTS
    # ==================================================

    multi_digit = [
        x for x in ocr
        if x["name"] != "5"
    ]

    if multi_digit:

        # Prefer the highest-confidence OCR result
        best_ocr = max(
            multi_digit,
            key=lambda x: x["confidence"]
        )

        # Check if YOLO agrees
        matching_yolo = [
            x for x in yolo
            if str(x["name"]) == best_ocr["name"]
        ]

        if matching_yolo:

            best_yolo = max(
                matching_yolo,
                key=lambda x: x["confidence"]
            )

            return {
                "name": best_ocr["name"],
                "confidence": round(
                    max(
                        best_ocr["confidence"],
                        best_yolo["confidence"]
                    ),
                    2
                ),
                "source": "ocr+yolo"
            }

        # OCR is strong enough by itself
        if best_ocr["confidence"] >= 0.50:

            return {
                "name": best_ocr["name"],
                "confidence": round(
                    best_ocr["confidence"],
                    2
                ),
                "source": "ocr"
            }


    # ==================================================
    # ₹5
    # ==================================================
    #
    # IMPORTANT:
    # Do NOT automatically trust OCR "5".
    #
    # Only accept it if YOLO also predicts 5.
    # ==================================================

    five = [
        x for x in ocr
        if x["name"] == "5"
    ]

    yolo_five = [
        x for x in yolo
        if str(x["name"]) == "5"
    ]

    if five and yolo_five:

        best_ocr = max(
            five,
            key=lambda x: x["confidence"]
        )

        best_yolo = max(
            yolo_five,
            key=lambda x: x["confidence"]
        )

        return {
            "name": "5",
            "confidence": round(
                max(
                    best_ocr["confidence"],
                    best_yolo["confidence"]
                ),
                2
            ),
            "source": "ocr+yolo"
        }


    # ==================================================
    # YOLO FALLBACK
    # ==================================================

    if yolo:

        best_yolo = max(
            yolo,
            key=lambda x: x["confidence"]
        )

        return {
            "name": str(best_yolo["name"]),
            "confidence": round(
                best_yolo["confidence"],
                2
            ),
            "source": "yolo"
        }


    return None


@app.get("/")
def home():

    return {
        "project": "VisionAI",
        "status": "Backend Running ���"
    }


@app.get("/health")
def health():

    return {
        "status": "healthy",
        "yolo": "loaded",
        "ocr": "loaded",
        "currency_detector": "loaded",
        "currency_model": "loaded"
    }


@app.post("/analyze")
async def analyze_image(
    file: UploadFile = File(...)
):

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


    extension = os.path.splitext(
        file.filename
    )[1]

    safe_filename = (
        f"{uuid.uuid4()}{extension}"
    )

    file_path = os.path.join(
        UPLOAD_FOLDER,
        safe_filename
    )


    with open(file_path, "wb") as buffer:

        shutil.copyfileobj(
            file.file,
            buffer
        )


    image = cv2.imread(file_path)

    if image is None:

        raise HTTPException(
            status_code=400,
            detail="Could not read uploaded image."
        )


    height, width = image.shape[:2]


    # General object detection
    objects = detector.detect(
        file_path
    )


    # OCR
    text = ocr.read(
        file_path
    )


    # Existing OCR currency detection
    currencies = currency_detector.detect(
        text
    )


    # Dedicated currency YOLO
    currency_detections = currency_model.detect(
        file_path
    )


    # Final currency decision
    final_currency = choose_currency(
        text,
        currency_detections
    )


    return {

        "message":
            "Image analyzed successfully!",

        "filename":
            file.filename,

        "image_size": {
            "width": width,
            "height": height
        },

        "objects":
            objects,

        "text":
            text,

        "currencies":
            currencies,

        "currency_detections":
            currency_detections,

        "final_currency":
            final_currency
    }
