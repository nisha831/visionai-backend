
class CurrencyFusion:

    # Valid Indian banknote denominations
    VALID_DENOMINATIONS = {
        10,
        20,
        50,
        100,
        200,
        500,
        2000
    }

    # Confidence thresholds
    OCR_MIN_CONFIDENCE = 0.60
    YOLO_SINGLE_MIN_CONFIDENCE = 0.35
    YOLO_MULTI_MIN_CONFIDENCE = 0.30

    def decide(self, ocr_results, yolo_results):

        # ==================================================
        # 1. Process OCR results
        # ==================================================

        ocr_candidates = {}

        for item in ocr_results:

            amount = item.get("amount")
            confidence = float(
                item.get("confidence", 0)
            )

            if amount is None:
                continue

            try:
                denomination = int(float(amount))
            except (ValueError, TypeError):
                continue

            if denomination not in self.VALID_DENOMINATIONS:
                continue

            # Keep highest-confidence OCR result for each denomination
            if (
                denomination not in ocr_candidates
                or confidence > ocr_candidates[denomination]["confidence"]
            ):
                ocr_candidates[denomination] = {
                    "denomination": denomination,
                    "confidence": confidence,
                    "source": "OCR"
                }

        # ==================================================
        # 2. Process & Aggregate YOLO results by denomination
        # ==================================================

        yolo_grouped = {}

        for item in yolo_results:

            name = str(item.get("name", "")).strip()
            confidence = float(item.get("confidence", 0))

            try:
                denomination = int(float(name))
            except (ValueError, TypeError):
                continue

            if denomination not in self.VALID_DENOMINATIONS:
                continue

            if denomination not in yolo_grouped:
                yolo_grouped[denomination] = []
            yolo_grouped[denomination].append(confidence)

        yolo_candidates = {}

        for denomination, conf_list in yolo_grouped.items():

            # Probabilistic noisy-OR combination for repeated detections
            prod_neg = 1.0
            for c in conf_list:
                prod_neg *= (1.0 - min(1.0, max(0.0, c)))

            aggregated_conf = 1.0 - prod_neg
            max_conf = max(conf_list)
            count = len(conf_list)

            yolo_candidates[denomination] = {
                "denomination": denomination,
                "confidence": round(aggregated_conf, 2),
                "max_confidence": max_conf,
                "count": count,
                "source": "YOLO"
            }

        # ==================================================
        # 3. Find strong OCR predictions
        # ==================================================

        strong_ocr = [
            item
            for item in ocr_candidates.values()
            if item["confidence"] >= self.OCR_MIN_CONFIDENCE
        ]

        # ==================================================
        # 4. Strong OCR gets priority
        # ==================================================

        if strong_ocr:

            best_ocr = max(
                strong_ocr,
                key=lambda item: item["confidence"]
            )

            denomination = best_ocr["denomination"]
            ocr_confidence = best_ocr["confidence"]

            # OCR and YOLO agree on denomination
            if denomination in yolo_candidates:

                yolo_confidence = yolo_candidates[denomination]["confidence"]

                combined_confidence = min(
                    1.0,
                    ocr_confidence * 0.70 + yolo_confidence * 0.30
                )

                return {
                    "currency": "INR",
                    "denomination": denomination,
                    "confidence": round(combined_confidence, 2),
                    "source": "OCR+YOLO"
                }

            # OCR is strong but YOLO disagrees/absent
            return {
                "currency": "INR",
                "denomination": denomination,
                "confidence": round(ocr_confidence, 2),
                "source": "OCR"
            }

        # ==================================================
        # 5. Moderate OCR with YOLO Agreement
        # ==================================================

        moderate_ocr_matches = []

        for denom, ocr_item in ocr_candidates.items():
            if denom in yolo_candidates:
                ocr_conf = ocr_item["confidence"]
                yolo_conf = yolo_candidates[denom]["confidence"]
                combined = min(1.0, ocr_conf * 0.60 + yolo_conf * 0.40)
                if combined >= 0.35:
                    moderate_ocr_matches.append({
                        "denomination": denom,
                        "confidence": round(combined, 2),
                        "source": "OCR+YOLO"
                    })

        if moderate_ocr_matches:

            best_match = max(
                moderate_ocr_matches,
                key=lambda item: item["confidence"]
            )

            return {
                "currency": "INR",
                "denomination": best_match["denomination"],
                "confidence": best_match["confidence"],
                "source": "OCR+YOLO"
            }

        # ==================================================
        # 6. Evaluate YOLO evidence (multi vs. single detection)
        # ==================================================

        valid_yolo = []

        for item in yolo_candidates.values():
            count = item["count"]
            agg_conf = item["confidence"]
            max_conf = item["max_confidence"]

            # Multi-detection: count >= 2 with aggregated confidence >= 0.30
            if count >= 2 and agg_conf >= self.YOLO_MULTI_MIN_CONFIDENCE:
                valid_yolo.append(item)
            # Single detection: requires max confidence >= 0.35
            elif count == 1 and max_conf >= self.YOLO_SINGLE_MIN_CONFIDENCE:
                valid_yolo.append(item)

        if valid_yolo:

            best_yolo = max(
                valid_yolo,
                key=lambda item: item["confidence"]
            )

            return {
                "currency": "INR",
                "denomination": best_yolo["denomination"],
                "confidence": best_yolo["confidence"],
                "source": "YOLO"
            }

        # ==================================================
        # 7. Nothing reliable found
        # ==================================================

        return {
            "currency": "INR",
            "denomination": None,
            "confidence": 0.0,
            "source": "NONE"
        }


