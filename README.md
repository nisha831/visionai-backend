# VisionAI Backend

VisionAI is a FastAPI-based computer vision backend that analyzes uploaded images using YOLO object detection, Indian currency detection, and OCR.

## Features

- Object detection using YOLO
- Indian currency note detection
- OCR text extraction
- Image upload and analysis API
- Automatic image metadata extraction
- Structured JSON API responses
- Interactive Swagger API documentation
- Secure upload handling
- Modular AI components

## Tech Stack

- Python
- FastAPI
- Uvicorn
- Ultralytics YOLO
- PyTorch
- EasyOCR
- OpenCV
- Pydantic

## Project Structure

```text
VisionAI/
│
├── backend/
│   ├── ai/
│   │   ├── __init__.py
│   │   ├── currency_detector.py
│   │   ├── currency_model.py
│   │   ├── ocr_reader.py
│   │   └── yolo_detector.py
│   │
│   ├── main.py
│   └── test_yolo.py
│
├── docs/
│   └── .gitkeep
│
├── images/
│   ├── Car.PNG
│   ├── objects.PNG
│   ├── person.PNG
│   └── room.PNG
│
├── notes/
│   └── day1.md
│
├── tests/
│   └── .gitkeep
│
├── .gitignore
├── README.md
├── requirements.txt
├── indian_currency_pretrained.pt
└── yolo11s.pt

AI Models
Object Detection

The project uses an Ultralytics YOLO model for general object detection.

The API can detect common objects such as:

person
car
truck
and other supported COCO classes
Indian Currency Detection

The project includes a pretrained Indian currency detection model:

indian_currency_pretrained.pt

Supported denominations:

₹10
₹20
₹50
₹100
₹200
₹500
₹2000

The model maps detections to denomination names such as:

10
20
50
100
200
500
2000
Installation

Clone the repository:

git clone https://github.com/nisha831/visionai-backend.git
cd visionai-backend

Create a virtual environment:

python -m venv venv

Activate the virtual environment on Windows Git Bash:

source venv/Scripts/activate

Install dependencies:

pip install -r requirements.txt
Running the API

Start the FastAPI server:

uvicorn backend.main:app --reload

The server will start at:

http://127.0.0.1:8000
API Documentation

Once the server is running, open:

http://127.0.0.1:8000/docs

This opens the interactive Swagger UI.

You can use it to test the /analyze endpoint directly from the browser.

Analyze an Image

The main endpoint is:

POST /analyze

Upload an image using the Swagger UI or curl.

Example:

curl -X POST \
  "http://127.0.0.1:8000/analyze" \
  -H "accept: application/json" \
  -H "Content-Type: multipart/form-data" \
  -F "file=@images/Car.PNG;type=image/png"
Example Response
{
  "message": "Image analyzed successfully!",
  "filename": "Car.PNG",
  "image_size": {
    "width": 483,
    "height": 318
  },
  "objects": [
    {
      "name": "truck",
      "confidence": 0.67,
      "box": {
        "x1": 24,
        "y1": 39,
        "x2": 461,
        "y2": 280
      }
    },
    {
      "name": "car",
      "confidence": 0.57,
      "box": {
        "x1": 20,
        "y1": 39,
        "x2": 457,
        "y2": 281
      }
    }
  ],
  "text": [],
  "currencies": []
}
Response Fields
Field	Description
message	Status message
filename	Uploaded image filename
image_size	Width and height of the uploaded image
objects	YOLO object detections
text	OCR results
currencies	Indian currency detections

Each object detection contains:

{
  "name": "car",
  "confidence": 0.57,
  "box": {
    "x1": 20,
    "y1": 39,
    "x2": 457,
    "y2": 281
  }
}
Currency Detection

Currency detection can also be tested directly through Python:

python -c "from backend.ai.currency_model import CurrencyModel; c=CurrencyModel(); print(c.detect('uploads/126812eb-bec3-43e1-9926-51f3a6a5852f.jpeg'))"

Example output:

[
  {
    'name': '200',
    'confidence': 0.42,
    'box': {
      'x1': 136,
      'y1': 0,
      'x2': 1159,
      'y2': 806
    }
  }
]

Detection confidence can vary depending on:

image quality
lighting
note orientation
distance from camera
background
multiple notes in the image
Testing Object Detection

The YOLO detector can be tested with:

python -c "from backend.ai.yolo_detector import YOLODetector; print('YOLO detector import OK')"

Example test images are stored in:

images/

Current test images include:

Car.PNG
objects.PNG
person.PNG
room.PNG
OCR

OCR processing is handled by:

backend/ai/ocr_reader.py

OCR results are returned through the text field of the /analyze response.

Security

Uploaded files are stored outside the Git repository:

uploads/

The uploads/ directory is excluded using .gitignore.

Environment files are also excluded:

.env

Virtual environments and Python cache files are excluded as well.

Git Ignore

The repository does not track temporary or local development files such as:

venv/
__pycache__/
*.pyc
.env
uploads/
.vscode/
runs/
training_data/
Current Status
 FastAPI server
 Swagger documentation
 Image upload
 YOLO object detection
 Indian currency detection
 OCR
 Structured API responses
 Secure upload handling
 GitHub repository organization
 Indian currency pretrained model
Future Improvements

Possible future improvements include:

Improve currency detection accuracy
Add more currency image training data
Improve multi-note detection
Add confidence filtering
Add annotated output images
Improve OCR accuracy
Add automated API tests
Add frontend integration
Add GPU support for faster inference
Deploy the backend to a cloud service
License

This project is intended for educational and development purposes.


After saving, **don't change anything else yet**. Run these three commands:

```bash
git diff -- README.md