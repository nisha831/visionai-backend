
import re


class CurrencyDetector:

    # Indian currency denominations
    INR_DENOMINATIONS = {
        10,
        20,
        50,
        100,
        200,
        500,
        2000
    }

    # Explicit English word-based denomination mapping
    WORD_DENOMINATIONS = {
        "ten rupees": 10,
        "twenty rupees": 20,
        "fifty rupees": 50,
        "one hundred rupees": 100,
        "two hundred rupees": 200,
        "five hundred rupees": 500,
        "two thousand rupees": 2000,
        "ten": 10,
        "twenty": 20,
        "fifty": 50,
        "one hundred": 100,
        "two hundred": 200,
        "five hundred": 500,
        "two thousand": 2000,
    }

    # Patterns for explicit Indian currency text
    CURRENCY_PATTERNS = [

        # ₹20, ₹50, ₹100 etc.
        (
            r"\u20b9\s*(\d+(?:[.,]\d{1,2})?)",
            "INR",
            "\u20b9"
        ),

        # Rs 20, Rs. 20, INR 20
        (
            r"\b(?:rs|rs\.|inr)\s*(\d+(?:[.,]\d{1,2})?)\b",
            "INR",
            "\u20b9"
        ),
    ]


    def detect(self, texts):

        currencies = []

        for item in texts:

            text = item["text"]
            confidence = item["confidence"]

            normalized_text = text.strip().lower()


            # --------------------------------------------------
            # 1. Detect explicit Indian currency symbols/codes
            # --------------------------------------------------

            for pattern, currency, symbol in self.CURRENCY_PATTERNS:

                matches = re.findall(
                    pattern,
                    normalized_text
                )

                for amount in matches:

                    amount = amount.replace(",", ".")

                    try:
                        amount = float(amount)

                    except ValueError:
                        continue


                    # Only accept known Indian denominations
                    if amount in self.INR_DENOMINATIONS:

                        currencies.append({
                            "amount": int(amount) if amount.is_integer() else amount,
                            "currency": "INR",
                            "symbol": "\u20b9",
                            "confidence": confidence,
                            "source_text": text
                        })


            # --------------------------------------------------
            # 2. OCR fallback
            #
            # If OCR sees just "20", "50", "100", etc.
            # (or with leading/trailing punctuation noise like "{200"),
            # accept it ONLY if it is a valid Indian banknote denomination.
            # --------------------------------------------------

            clean_num_text = normalized_text.strip("{}()[],.:;\"'#$!@%^&*`~_")

            if re.fullmatch(
                r"\d+(?:[.,]\d{1,2})?",
                clean_num_text
            ):

                amount_text = clean_num_text.replace(",", ".")

                try:
                    amount = float(amount_text)

                except ValueError:
                    continue


                if amount in self.INR_DENOMINATIONS:

                    currencies.append({
                        "amount": int(amount) if amount.is_integer() else amount,
                        "currency": "INR",
                        "symbol": "\u20b9",
                        "confidence": confidence,
                        "source_text": text
                    })


            # --------------------------------------------------
            # 3. Word-based denomination recognition
            #
            # Handles text such as "FIFTY RUPEES", "FIFTY", etc.
            # --------------------------------------------------

            clean_word_text = re.sub(r"[\s-]+", " ", normalized_text).strip(".,!?")

            if clean_word_text in self.WORD_DENOMINATIONS:

                amount = self.WORD_DENOMINATIONS[clean_word_text]

                currencies.append({
                    "amount": amount,
                    "currency": "INR",
                    "symbol": "\u20b9",
                    "confidence": confidence,
                    "source_text": text
                })


        return currencies

