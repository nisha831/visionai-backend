from ultralytics import YOLO


class YOLODetector:

    def __init__(self):
        # Use the small YOLO11 model for better detection accuracy
        self.model = YOLO("yolo11s.pt")

    def detect(self, image_path):

        results = self.model(
            image_path,
            conf=0.25,
            iou=0.45,
            imgsz=640,
            verbose=False
        )

        objects = []

        for result in results:

            for box in result.boxes:

                class_id = int(box.cls[0])
                confidence = float(box.conf[0])

                object_name = result.names[class_id]

                x1, y1, x2, y2 = box.xyxy[0].tolist()

                objects.append({
                    "name": object_name,
                    "confidence": round(confidence, 2),
                    "box": {
                        "x1": round(x1),
                        "y1": round(y1),
                        "x2": round(x2),
                        "y2": round(y2)
                    }
                })

        return objects