
from math import prod


class CurrencyFusion:
    """
    Combines OCR and YOLO currency evidence.

    Safety principle:
    - Strong OCR is trusted.
    - OCR + matching YOLO increases confidence.
    - Multiple matching YOLO detections can be combined.
    - A single moderate YOLO prediction is NOT enough.
    - Weak/conflicting evidence returns NONE.
    """

    VALID_DENOMINATIONS = {10, 20, 50, 100, 200, 500, 2000}

    # OCR confidence thresholds
    STRONG_OCR_THRESHOLD = 0.60
    MODERATE_OCR_THRESHOLD = 0.30

    # YOLO thresholds
    # A single detection must now be substantially stronger
    SINGLE_YOLO_THRESHOLD = 0.70

    # Repeated detections can support each other
    REPEATED_YOLO_THRESHOLD = 0.30

    def __init__(self):
        pass

    def _normalize_denomination(self, value):
        """
        Convert a denomination value to an integer if valid.
        """
        try:
            denomination = int(value)
        except (TypeError, ValueError):
            return None

        if denomination in self.VALID_DENOMINATIONS:
            return denomination

        return None

    def _get_ocr_evidence(self, currencies):
        """
        Return the strongest valid OCR currency result.
        """
        evidence = []

        for item in currencies or []:
            denomination = self._normalize_denomination(
                item.get("amount")
            )

            if denomination is None:
                continue

            try:
                confidence = float(item.get("confidence", 0.0))
            except (TypeError, ValueError):
                confidence = 0.0

            evidence.append(
                {
                    "denomination": denomination,
                    "confidence": confidence,
                    "source_text": item.get("source_text", ""),
                }
            )

        if not evidence:
            return None

        evidence.sort(
            key=lambda item: item["confidence"],
            reverse=True,
        )

        return evidence[0]

    def _get_yolo_evidence(self, currency_predictions):
        """
        Group YOLO predictions by denomination and calculate
        aggregate confidence using noisy-OR:

            1 - product(1 - confidence)

        This allows repeated detections of the same denomination
        to provide stronger evidence without simply adding
        probabilities.
        """
        grouped = {}

        for prediction in currency_predictions or []:
            denomination = self._normalize_denomination(
                prediction.get("name")
            )

            if denomination is None:
                continue

            try:
                confidence = float(
                    prediction.get("confidence", 0.0)
                )
            except (TypeError, ValueError):
                confidence = 0.0

            if confidence <= 0:
                continue

            grouped.setdefault(denomination, []).append(
                confidence
            )

        evidence = []

        for denomination, confidences in grouped.items():
            aggregate = 1.0

            for confidence in confidences:
                aggregate *= (1.0 - confidence)

            aggregate = 1.0 - aggregate

            evidence.append(
                {
                    "denomination": denomination,
                    "confidence": aggregate,
                    "count": len(confidences),
                    "individual_confidences": confidences,
                }
            )

        evidence.sort(
            key=lambda item: item["confidence"],
            reverse=True,
        )

        return evidence

    def _none_result(self):
        return {
            "currency": "INR",
            "denomination": None,
            "confidence": 0.0,
            "source": "NONE",
        }

    def decide(self, currencies, currency_predictions):
        """
        Decide the final Indian currency denomination.

        Priority:

        1. Strong OCR
        2. Strong OCR + matching YOLO
        3. Moderate OCR + matching YOLO
        4. Multiple consistent YOLO detections
        5. Very strong single YOLO detection
        6. Otherwise NONE
        """

        ocr = self._get_ocr_evidence(currencies)
        yolo = self._get_yolo_evidence(currency_predictions)

        # ---------------------------------------------------------
        # 1. STRONG OCR
        # ---------------------------------------------------------
        if (
            ocr is not None
            and ocr["confidence"] >= self.STRONG_OCR_THRESHOLD
        ):
            denomination = ocr["denomination"]

            matching_yolo = next(
                (
                    item
                    for item in yolo
                    if item["denomination"] == denomination
                ),
                None,
            )

            # Strong OCR alone is sufficient.
            if matching_yolo is None:
                return {
                    "currency": "INR",
                    "denomination": denomination,
                    "confidence": round(
                        ocr["confidence"], 2
                    ),
                    "source": "OCR",
                }

            # Matching OCR + YOLO gets a weighted confidence.
            combined = (
                0.70 * ocr["confidence"]
                + 0.30 * matching_yolo["confidence"]
            )

            return {
                "currency": "INR",
                "denomination": denomination,
                "confidence": round(
                    min(combined, 1.0), 2
                ),
                "source": "OCR+YOLO",
            }

        # ---------------------------------------------------------
        # 2. MODERATE OCR + MATCHING YOLO
        # ---------------------------------------------------------
        if (
            ocr is not None
            and ocr["confidence"] >= self.MODERATE_OCR_THRESHOLD
        ):
            denomination = ocr["denomination"]

            matching_yolo = next(
                (
                    item
                    for item in yolo
                    if item["denomination"] == denomination
                ),
                None,
            )

            if matching_yolo is not None:
                combined = (
                    0.70 * ocr["confidence"]
                    + 0.30 * matching_yolo["confidence"]
                )

                # Require enough combined evidence.
                if combined >= self.MODERATE_OCR_THRESHOLD:
                    return {
                        "currency": "INR",
                        "denomination": denomination,
                        "confidence": round(
                            min(combined, 1.0), 2
                        ),
                        "source": "OCR+YOLO",
                    }

        # ---------------------------------------------------------
        # 3. MULTIPLE CONSISTENT YOLO DETECTIONS
        # ---------------------------------------------------------
        if yolo:
            best = yolo[0]

            if (
                best["count"] >= 2
                and best["confidence"]
                >= self.REPEATED_YOLO_THRESHOLD
            ):
                return {
                    "currency": "INR",
                    "denomination": best["denomination"],
                    "confidence": round(
                        best["confidence"], 2
                    ),
                    "source": "YOLO",
                }

        # ---------------------------------------------------------
        # 4. VERY STRONG SINGLE YOLO DETECTION
        # ---------------------------------------------------------
        if yolo:
            best = yolo[0]

            if (
                best["count"] == 1
                and best["individual_confidences"][0]
                >= self.SINGLE_YOLO_THRESHOLD
            ):
                return {
                    "currency": "INR",
                    "denomination": best["denomination"],
                    "confidence": round(
                        best["individual_confidences"][0],
                        2,
                    ),
                    "source": "YOLO",
                }

        # ---------------------------------------------------------
        # 5. NO RELIABLE EVIDENCE
        # ---------------------------------------------------------
        return self._none_result()

