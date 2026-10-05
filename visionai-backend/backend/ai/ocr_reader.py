import easyocr
import cv2
import re
import numpy as np
from backend.ai.image_processor import ImageProcessor


class OCRReader:

    def __init__(self):
        self.reader = easyocr.Reader(["en"], gpu=False)

    @staticmethod
    def _is_valid_ocr_text(text: str, confidence: float) -> bool:
        """
        Filters out low-quality OCR noise:
        - Rejects strings made entirely of non-alphanumeric symbols
        - Rejects single isolated non-digit characters
        - Requires higher confidence for short words
        """
        cleaned = text.strip()
        if not cleaned:
            return False

        # Reject pure noise or punctuation (e.g. "|", "...", "---", "^")
        alphanumeric_count = sum(c.isalnum() for c in cleaned)
        if alphanumeric_count == 0:
            return False

        # Single character rules
        if len(cleaned) == 1:
            # Allow single digits (e.g. '5') if confidence is high (>= 0.75)
            if cleaned.isdigit() and confidence >= 0.75:
                return True
            return False

        # Require reasonable confidence for short text
        if len(cleaned) <= 3 and confidence < 0.60:
            return False

        return confidence >= 0.55

    def read(self, image_path: str) -> list:
        image = cv2.imread(image_path)
        if image is None:
            raise ValueError(f"Could not read image: {image_path}")

        # Preprocess full image for OCR
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        preprocessed_gray = ImageProcessor.preprocess_for_ocr(gray)

        # Run EasyOCR
        results = self.reader.readtext(preprocessed_gray)

        texts = []
        for result in results:
            text = str(result[1]).strip()
            confidence = float(result[2])

            if self._is_valid_ocr_text(text, confidence):
                texts.append({
                    "text": text,
                    "confidence": round(confidence, 2)
                })

        return texts