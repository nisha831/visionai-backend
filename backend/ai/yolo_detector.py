from ultralytics import YOLO


class YOLODetector:

    def __init__(self):
        self.model = YOLO("yolo11n.pt")

    def detect(self, image_path):
        results = self.model(image_path, conf=0.50)

        objects = []

        for result in results:
            for box in result.boxes:
                class_id = int(box.cls[0])
                confidence = float(box.conf[0])

                object_name = result.names[class_id]

                objects.append({
                    "name": object_name,
                    "confidence": round(confidence, 2)
                })

        return objects