from ai.yolo_detector import YOLODetector

detector = YOLODetector()

objects = detector.detect("images/test.jpg")

print("\nDetected Objects:")

for obj in objects:
    print(f"{obj['name']} - {obj['confidence']}")