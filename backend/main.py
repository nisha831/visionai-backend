from fastapi import FastAPI, UploadFile, File, HTTPException
from backend.ai.yolo_detector import YOLODetector
from backend.ai.ocr_reader import OCRReader

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

    # --------------------------------------------------
    # 1. Validate uploaded file type
    # --------------------------------------------------

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


    # --------------------------------------------------
    # 2. Create a safe unique filename
    # --------------------------------------------------

    extension = os.path.splitext(file.filename or "")[1].lower()

    if extension not in {".jpg", ".jpeg", ".png", ".webp"}:
        raise HTTPException(
            status_code=400,
            detail="Invalid image extension."
        )

    unique_filename = f"{uuid.uuid4().hex}{extension}"

    file_path = os.path.join(
        UPLOAD_FOLDER,
        unique_filename
    )


    try:

        # --------------------------------------------------
        # 3. Save uploaded image
        # --------------------------------------------------

        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)


        # --------------------------------------------------
        # 4. Read image
        # --------------------------------------------------

        image = cv2.imread(file_path)

        if image is None:
            raise HTTPException(
                status_code=400,
                detail="Could not read uploaded image."
            )


        # --------------------------------------------------
        # 5. Get image dimensions
        # --------------------------------------------------

        height, width = image.shape[:2]


        # --------------------------------------------------
        # 6. Run YOLO object detection
        # --------------------------------------------------

        objects = detector.detect(file_path)


        # --------------------------------------------------
        # 7. Run OCR text detection
        # --------------------------------------------------

        text = ocr.read(file_path)


        # --------------------------------------------------
        # 8. Return analysis result
        # --------------------------------------------------

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


    except HTTPException:
        raise


    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Image analysis failed: {str(e)}"
        )


    finally:

        # --------------------------------------------------
        # 9. Delete temporary uploaded image
        # --------------------------------------------------

        if os.path.exists(file_path):
            os.remove(file_path)