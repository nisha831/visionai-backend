import cv2
import numpy as np


class SceneAnalyzer:
    """
    Analyzes scene properties:
    - Determines dominant background color (green, blue, white, black, brown, gray, mixed, unknown).
    - Synthesizes a clear, helpful, grounded natural language scene description for visually impaired users.
    - Grounded strictly in verified object, person, and distance sensor evidence.
    """

    def extract_background_color(self, image_path: str) -> str:
        try:
            image = cv2.imread(image_path)
            if image is None:
                return "unknown"

            small_img = cv2.resize(image, (100, 100))
            hsv = cv2.cvtColor(small_img, cv2.COLOR_BGR2HSV)

            # Sample outer border pixels for background color
            border_mask = np.ones((100, 100), dtype=bool)
            border_mask[20:80, 20:80] = False
            bg_pixels = hsv[border_mask]

            if len(bg_pixels) == 0:
                return "mixed"

            avg_h = np.mean(bg_pixels[:, 0])
            avg_s = np.mean(bg_pixels[:, 1])
            avg_v = np.mean(bg_pixels[:, 2])

            if avg_v < 40:
                return "black"
            elif avg_v > 200 and avg_s < 30:
                return "white"
            elif avg_s < 40:
                return "gray"

            if 35 <= avg_h <= 85:
                return "green"
            elif 85 < avg_h <= 130:
                return "blue"
            elif (0 <= avg_h < 15) or (160 <= avg_h <= 180):
                return "brown" if avg_v < 150 else "red"
            elif 15 <= avg_h < 35:
                return "brown" if avg_v < 150 else "yellow"
            else:
                return "mixed"
        except Exception:
            return "unknown"

    def generate_description(
        self,
        person_analysis: dict,
        objects: list,
        background_color: str,
        distance_cm: float = None,
        ocr_text: str = None,
        currency_info: dict = None
    ) -> str:
        parts = []

        # 1. People summary
        people_count = person_analysis.get("people_count", 0)
        person_summary = person_analysis.get("summary", "")

        if people_count > 0 and person_summary:
            parts.append(person_summary)

        # 2. Objects summary (up to 3 distinct non-person objects)
        non_person_objs = [obj for obj in objects if obj.get("name") != "person"]
        if non_person_objs:
            obj_phrases = []
            seen_names = set()
            for obj in non_person_objs:
                name = obj.get("name", "object")
                if name in seen_names:
                    continue
                seen_names.add(name)

                pos = obj.get("position", "center")
                pos_str = "on the left" if pos == "left" else ("on the right" if pos == "right" else "near the center")
                obj_phrases.append(f"a {name} {pos_str}")
                if len(obj_phrases) >= 3:
                    break

            if obj_phrases:
                if len(obj_phrases) == 1:
                    parts.append(f"Also visible: {obj_phrases[0]}.")
                else:
                    parts.append(f"Also visible: {', '.join(obj_phrases[:-1])} and {obj_phrases[-1]}.")
        elif people_count == 0:
            parts.append("The area directly in front of you appears clear of major objects.")

        # 3. Distance Sensor Reading (Step 6 integration)
        if distance_cm is not None and not np.isnan(distance_cm):
            dist_val = round(distance_cm)
            if dist_val <= 50:
                parts.append(f"Obstacle detected very close, approximately {dist_val} centimeters ahead.")
            elif dist_val <= 100:
                parts.append(f"Obstacle detected ahead at approximately {dist_val} centimeters.")
            elif dist_val <= 150:
                parts.append(f"Path clear up to approximately {dist_val} centimeters ahead.")

        # 4. Verified Currency
        if currency_info and currency_info.get("name"):
            parts.append(f"Currency detected: {currency_info.get('name')} Indian rupees.")

        # 5. Background Color
        if background_color and background_color not in ["unknown", "mixed"]:
            parts.append(f"The background is predominantly {background_color}.")

        return " ".join(parts)
