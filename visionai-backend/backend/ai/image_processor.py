import cv2
import numpy as np
import os
import tempfile


class ImageProcessor:
    """
    Image Preprocessing Pipeline for VisionAI:
    - Analyzes image contrast, brightness, and exposure.
    - Applies non-destructive CLAHE contrast enhancement for AI inference when under/over-exposed.
    - Provides image sharpening and adaptive thresholding for OCR text extraction.
    - Preserves the original image completely for UI app display.
    """

    @staticmethod
    def enhance_for_ai(image_path: str) -> str:
        """
        Generates an enhanced temporary copy of the image if contrast or lighting is suboptimal.
        If the image is already good quality, returns original path.
        """
        image = cv2.imread(image_path)
        if image is None:
            return image_path

        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        mean_val = np.mean(gray)
        std_val = np.std(gray)

        # Check if brightness is low (< 60) or contrast is poor (std < 40)
        needs_enhancement = mean_val < 60 or mean_val > 210 or std_val < 40

        if not needs_enhancement:
            return image_path

        try:
            # Convert to LAB color space for luminance contrast enhancement without distorting color
            lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
            l, a, b = cv2.split(lab)

            clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
            cl = clahe.apply(l)

            limg = cv2.merge((cl, a, b))
            enhanced = cv2.cvtColor(limg, cv2.COLOR_LAB2BGR)

            # Save temporary enhanced file
            dir_name = os.path.dirname(image_path)
            base_name = os.path.basename(image_path)
            enhanced_path = os.path.join(dir_name, f"enhanced_{base_name}")
            cv2.imwrite(enhanced_path, enhanced)
            return enhanced_path
        except Exception:
            return image_path

    @staticmethod
    def preprocess_for_ocr(image: np.ndarray) -> np.ndarray:
        """
        Preprocesses an image region for OCR:
        - Upscales small crops
        - Enhances contrast
        - Applies mild sharpening
        """
        if image is None or image.size == 0:
            return image

        h, w = image.shape[:2]

        # Upscale small regions to ensure clear character boundaries
        if h < 60 or w < 120:
            scale = max(2.0, 120.0 / float(max(1, h)))
            image = cv2.resize(image, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_CUBIC)

        # Mild unsharp mask for clear text edges
        gaussian = cv2.GaussianBlur(image, (0, 0), 2.0)
        sharpened = cv2.addWeighted(image, 1.5, gaussian, -0.5, 0)

        return sharpened
