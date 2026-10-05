import cv2
import os

class PersonAnalyzer:
    """
    Analyzes person detections for assistive vision:
    - Counts total number of people detected.
    - Calculates person positions (left, center, right).
    - Checks face visibility & coarse body orientation (facing camera vs face not visible).
    - Adheres to gender-neutral safety rules (never claims girl/boy from appearance).
    """

    def __init__(self):
        # Load OpenCV Haar Cascade for face detection hint
        cascade_path = cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
        if os.path.exists(cascade_path):
            self.face_cascade = cv2.CascadeClassifier(cascade_path)
        else:
            self.face_cascade = None

    def analyze(self, image_path: str, objects: list) -> dict:
        person_objects = [obj for obj in objects if obj.get("name") == "person"]
        people_count = len(person_objects)

        if people_count == 0:
            return {
                "people_count": 0,
                "summary": "No people detected.",
                "details": [],
                "facing_camera": False
            }

        image = cv2.imread(image_path)
        details = []
        any_facing_camera = False

        for idx, person in enumerate(person_objects):
            pos = person.get("position", "center")
            box = person.get("box", {})
            
            # Estimate coarse orientation from face visibility
            orientation = "face is not clearly visible"
            if image is not None and self.face_cascade is not None and box:
                try:
                    h_img, w_img = image.shape[:2]
                    x1 = max(0, int(box.get("x1", 0)))
                    y1 = max(0, int(box.get("y1", 0)))
                    x2 = min(w_img, int(box.get("x2", w_img)))
                    y2 = min(h_img, int(box.get("y2", h_img)))

                    person_crop = image[y1:y2, x1:x2]
                    if person_crop.size > 0:
                        # Inspect upper half of person box for face
                        upper_half = person_crop[0:int(person_crop.shape[0] * 0.55), :]
                        gray = cv2.cvtColor(upper_half, cv2.COLOR_BGR2GRAY)
                        faces = self.face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=3, minSize=(24, 24))
                        
                        if len(faces) > 0:
                            orientation = "facing toward the camera"
                            any_facing_camera = True
                except Exception:
                    pass

            # Position label
            if pos == "left":
                pos_text = "on the left"
            elif pos == "right":
                pos_text = "on the right"
            else:
                pos_text = "near the center"

            details.append({
                "person_id": idx + 1,
                "position": pos,
                "position_text": pos_text,
                "orientation": orientation
            })

        # Synthesize people count description
        if people_count == 1:
            summary = f"One person is visible in front of you, {details[0]['position_text']}."
            if details[0]['orientation'] == "facing toward the camera":
                summary += " The person appears to be facing toward the camera."
        elif people_count == 2:
            summary = f"Two people are in front of you. One is {details[0]['position_text']} and one is {details[1]['position_text']}."
        else:
            summary = f"{people_count} people are visible in front of you."

        return {
            "people_count": people_count,
            "summary": summary,
            "details": details,
            "facing_camera": any_facing_camera
        }
