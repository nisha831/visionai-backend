from ultralytics import YOLO


class CurrencyModel:

    def __init__(self):
        self.model = YOLO("indian_currency_pretrained.pt")

    def detect(self, image_path):

        results = self.model(
            image_path,
            conf=0.25,
            iou=0.45,
            imgsz=640,
            verbose=False
        )

        currencies = []

        for result in results:

            for box in result.boxes:

                class_id = int(box.cls[0])
                confidence = float(box.conf[0])

                currency_name = result.names[class_id]

                x1, y1, x2, y2 = box.xyxy[0].tolist()

                currencies.append({
                    "name": currency_name,
                    "confidence": round(confidence, 2),
                    "box": {
                        "x1": round(x1),
                        "y1": round(y1),
                        "x2": round(x2),
                        "y2": round(y2)
                    }
                })

        return currencies