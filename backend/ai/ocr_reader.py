import easyocr
import cv2


class OCRReader:
    def __init__(self):
        self.reader = easyocr.Reader(["en"], gpu=False)

    def read(self, image_path):
        image = cv2.imread(image_path)

        if image is None:
            raise ValueError(f"Could not read image: {image_path}")

        # Convert image to grayscale for OCR
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

        results = self.reader.readtext(gray)

        texts = []

        for result in results:
            text = result[1]
            confidence = float(result[2])

            texts.append({
                "text": text,
                "confidence": round(confidence, 2)
            })

        return texts