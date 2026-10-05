import re


class CurrencyDetector:

    CURRENCY_PATTERNS = [
        # Indian Rupee
        (r"₹\s*(\d+(?:[.,]\d{1,2})?)", "INR", "₹"),
        (r"\b(?:rs|rs\.|inr)\s*(\d+(?:[.,]\d{1,2})?)\b", "INR", "₹"),

        # US Dollar
        (r"\$\s*(\d+(?:[.,]\d{1,2})?)", "USD", "$"),
        (r"\b(?:usd)\s*(\d+(?:[.,]\d{1,2})?)\b", "USD", "$"),

        # Euro
        (r"€\s*(\d+(?:[.,]\d{1,2})?)", "EUR", "€"),
        (r"\b(?:eur)\s*(\d+(?:[.,]\d{1,2})?)\b", "EUR", "€"),

        # British Pound
        (r"£\s*(\d+(?:[.,]\d{1,2})?)", "GBP", "£"),
        (r"\b(?:gbp)\s*(\d+(?:[.,]\d{1,2})?)\b", "GBP", "£"),
    ]

    def detect(self, texts):

        currencies = []

        for item in texts:

            text = item["text"]
            confidence = item["confidence"]

            normalized_text = text.strip().lower()

            for pattern, currency, symbol in self.CURRENCY_PATTERNS:

                matches = re.findall(pattern, normalized_text)

                for amount in matches:

                    amount = amount.replace(",", ".")

                    try:
                        amount = float(amount)
                    except ValueError:
                        continue

                    currencies.append({
                        "amount": amount,
                        "currency": currency,
                        "symbol": symbol,
                        "confidence": confidence,
                        "source_text": text
                    })

        return currencies