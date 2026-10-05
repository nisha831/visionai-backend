from ultralytics import YOLO
import cv2
import numpy as np


class YOLODetector:

    def __init__(self):
        # Use YOLO model for object detection
        self.model = YOLO("yolo11s.pt")

    @staticmethod
    def _compute_iou(box1: dict, box2: dict) -> float:
        x1 = max(box1["x1"], box2["x1"])
        y1 = max(box1["y1"], box2["y1"])
        x2 = min(box1["x2"], box2["x2"])
        y2 = min(box1["y2"], box2["y2"])

        inter_area = max(0, x2 - x1) * max(0, y2 - y1)
        area1 = (box1["x2"] - box1["x1"]) * (box1["y2"] - box1["y1"])
        area2 = (box2["x2"] - box2["x1"]) * (box2["y2"] - box2["y1"])

        union_area = area1 + area2 - inter_area
        if union_area <= 0:
            return 0.0
        return inter_area / float(union_area)

    def detect(self, image_path: str) -> list:
        image = cv2.imread(image_path)
        if image is not None:
            img_height, img_width = image.shape[:2]
        else:
            img_height, img_width = 480, 640

        total_area = float(img_width * img_height)

        # Run inference with base conf threshold of 0.40 (prevents weak noise)
        results = self.model(
            image_path,
            conf=0.40,
            iou=0.45,
            imgsz=640,
            verbose=False
        )

        raw_objects = []

        for result in results:
            for box in result.boxes:
                class_id = int(box.cls[0])
                confidence = float(box.conf[0])
                object_name = str(result.names[class_id]).strip().lower()

                x1, y1, x2, y2 = box.xyxy[0].tolist()
                box_w = abs(x2 - x1)
                box_h = abs(y2 - y1)
                box_area = box_w * box_h

                # Class-specific confidence filtering (precision over recall)
                if object_name == "person":
                    min_conf = 0.50
                else:
                    min_conf = 0.45

                if confidence < min_conf:
                    continue

                # Filter tiny noisy bounding boxes (unless high confidence >= 0.70)
                if (box_area < 0.002 * total_area or box_w < 15 or box_h < 15) and confidence < 0.70:
                    continue

                x_center = (x1 + x2) / 2.0

                if x_center < 0.35 * img_width:
                    position = "left"
                elif x_center > 0.65 * img_width:
                    position = "right"
                else:
                    position = "center"

                raw_objects.append({
                    "name": object_name,
                    "label": object_name,
                    "confidence": round(confidence, 2),
                    "position": position,
                    "box": {
                        "x1": round(x1),
                        "y1": round(y1),
                        "x2": round(x2),
                        "y2": round(y2)
                    }
                })

        # Non-Maximum Suppression / Deduplication across overlapping detections
        raw_objects.sort(key=lambda x: x["confidence"], reverse=True)
        filtered_objects = []

        for obj in raw_objects:
            keep = True
            for existing in filtered_objects:
                iou = self._compute_iou(obj["box"], existing["box"])
                # If same class or high overlap (>0.50), drop lower confidence candidate
                if iou > 0.50:
                    keep = False
                    break
            if keep:
                filtered_objects.append(obj)

        return filtered_objects