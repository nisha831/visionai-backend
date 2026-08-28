# VisionAI — AI-Powered Image Analysis Backend

VisionAI is a FastAPI-based computer vision backend that analyzes uploaded images using **YOLO object detection, Indian currency detection, and OCR**.

The project is designed to identify objects, extract text, and detect Indian currency denominations from images.

## Features

* ��� YOLO object detection
* ��� Indian currency denomination detection
* ��� OCR text extraction
* ��� Combines OCR and YOLO results for currency identification
* ⚡ FastAPI REST API
* ��� JPG, JPEG, PNG, and WEBP image support
* ��� Health-check endpoint
* ��� Trained Indian currency YOLO model

## Supported Indian Currency

The currency detection system supports:

* ₹5
* ₹10
* ₹20
* ₹50
* ₹100
* ₹200
* ₹500
* ₹2000

## Project Structure

```text
VisionAI/
│
├── backend/
│   ├── ai/
│   │   ├── currency_detector.py
│   │   ├── currency_model.py
│   │   ├── ocr_reader.py
│   │   ├── yolo_detector.py
│   │   └── __init__.py
│   │
│   ├── main.py
│   └── test_yolo.py
│
├── images/
│   ├── ocr_test.jpg
│   └── test.jpg
│
├── docs/
├── notes/
├── tests/
│
├── indian_currency_pretrained.pt
├── yolo11n.pt
├── yolo11s.pt
├── requirements.txt
├── .gitignore
└── README.md
```

## Requirements

* Python 3.10+
* FastAPI
* Uvicorn
* Ultralytics YOLO
* PyTorch
* OpenCV
* OCR dependencies

Install the required Python packages with:

```bash
pip install -r requirements.txt
```

## Running the Backend

Activate the virtual environment:

### Windows / Git Bash

```bash
source venv/Scripts/activate
```

Then start the FastAPI server:

```bash
python -m uvicorn backend.main:app
```

The API will be available at:

```text
http://127.0.0.1:8000
```

## Health Check

Open:

```text
http://127.0.0.1:8000/health
```

Or use:

```bash
curl http://127.0.0.1:8000/health
```

A successful response looks like:

```json
{
  "status": "healthy",
  "yolo": "loaded",
  "ocr": "loaded",
  "currency_detector": "loaded",
  "currency_model": "loaded"
}
```

## Analyze an Image

Send an image to the `/analyze` endpoint:

```bash
curl -X POST "http://127.0.0.1:8000/analyze" \
  -F "file=@uploads/500.jpeg"
```

The API returns:

* image dimensions
* detected objects
* extracted OCR text
* currency detections
* final currency prediction

Example:

```json
{
  "message": "Image analyzed successfully!",
  "filename": "500.jpeg",
  "final_currency": {
    "name": "500",
    "confidence": 0.20,
    "source": "yolo"
  }
}
```

## Currency Detection

VisionAI uses two signals:

### YOLO

The trained Indian currency model detects denominations and provides:

* denomination
* confidence
* bounding box

Example:

```json
{
  "name": "500",
  "confidence": 0.20,
  "box": {
    "x1": 299,
    "y1": 8,
    "x2": 1347,
    "y2": 1038
  }
}
```

### OCR

OCR extracts visible text from the currency note.

For example:

```text
RESERVE BANK OF INDIA
MAHATMA GANDHI
500
```

The backend combines OCR and YOLO information to determine the final denomination.

## API Endpoints

| Method | Endpoint   | Description               |
| ------ | ---------- | ------------------------- |
| GET    | `/`        | Backend information       |
| GET    | `/health`  | Check AI model status     |
| POST   | `/analyze` | Analyze an uploaded image |

## API Documentation

FastAPI automatically provides interactive API documentation.

After starting the backend, open:

```text
http://127.0.0.1:8000/docs
```

This allows you to test `/analyze` directly from the browser.

## Models

The repository contains:

```text
indian_currency_pretrained.pt
yolo11n.pt
yolo11s.pt
```

`indian_currency_pretrained.pt` is the trained Indian currency detection model used by the backend.

## Important Notes

The project is currently focused on the **backend/API**. There is no frontend application included.

The backend currently runs on CPU on systems without a compatible NVIDIA GPU.

## Development

Run the server normally:

```bash
python -m uvicorn backend.main:app
```

For development with automatic reload:

```bash
python -m uvicorn backend.main:app --reload
```

## Repository

GitHub:

https://github.com/nisha831/visionai-backend

## License

This project is intended for educational and development purposes.
