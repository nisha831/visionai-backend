import easyocr


class OCRReader:
    def __init__(self):
        self.reader = easyocr.Reader(["en"], gpu=False)

    def read(self, image_path):
        results = self.reader.readtext(image_path)

        texts = []

        for result in results:
            text = result[1]
            confidence = float(result[2])

            texts.append({
                "text": text,
                "confidence": round(confidence, 2)
            })

        return texts