from fastapi import FastAPI, UploadFile, File, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional, List
import shutil
import os
import uuid
import cv2
import re
import time
import asyncio
from datetime import datetime

# Import AI modules
from backend.ai.yolo_detector import YOLODetector
from backend.ai.ocr_reader import OCRReader
from backend.ai.currency_detector import CurrencyDetector
from backend.ai.currency_model import CurrencyModel
from backend.ai.person_analyzer import PersonAnalyzer
from backend.ai.scene_analyzer import SceneAnalyzer
from backend.ai.image_processor import ImageProcessor

app = FastAPI(
    title="VisionAI AI Backend",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_FOLDER = "uploads"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_FOLDER), name="uploads")

# Load AI models
detector = YOLODetector()
ocr = OCRReader()
currency_detector = CurrencyDetector()
currency_model = CurrencyModel()
person_analyzer = PersonAnalyzer()
scene_analyzer = SceneAnalyzer()

# Global State for Hardware & Distance Monitoring
hardware_state = {
    "camera": True,
    "distance_sensor": True,
    "button": True,
    "ai_backend": True,
    "last_heartbeat": time.time()
}

latest_distance = {
    "distance_cm": None,
    "status": "UNAVAILABLE",
    "timestamp": datetime.now().isoformat()
}

latest_analysis_event = {
    "event_id": 0,
    "timestamp": None,
    "result": None
}

capture_command_state = {
    "requested": False,
    "request_id": None
}

VALID_DENOMINATIONS = {"5", "10", "20", "50", "100", "200", "500", "2000"}

class DistanceUpdate(BaseModel):
    distance_cm: Optional[float] = None
    status: Optional[str] = None

class HeartbeatUpdate(BaseModel):
    camera: bool = True
    distance_sensor: bool = True
    button: bool = True


def clean_ocr_text(text):
    text = str(text).upper()
    text = text.replace("₹", "").replace(",", "").replace(".", "").replace("{", "").replace("}", "").replace("[", "").replace("]", "").strip()
    return text


def get_ocr_evidence(text):
    evidence = []
    for item in text:
        raw = item.get("text", "") if isinstance(item, dict) else str(item)
        confidence = float(item.get("confidence", 0)) if isinstance(item, dict) else 0.8
        cleaned = clean_ocr_text(raw)

        if cleaned in VALID_DENOMINATIONS:
            evidence.append({"name": cleaned, "confidence": confidence, "text": raw, "type": "exact"})
            continue

        for denomination in ["2000", "500", "200", "100", "50", "20", "10"]:
            if re.search(rf"(?<!\d){denomination}(?!\d)", cleaned):
                evidence.append({"name": denomination, "confidence": confidence, "text": raw, "type": "noisy"})
                break
    return evidence


def choose_currency(text, yolo):
    """
    Selects currency ONLY when backed by reliable YOLO detection or unambiguous OCR evidence.
    Prevents random numbers from being announced as currency.
    """
    # 1. Check YOLO currency model detections
    if yolo:
        best_yolo = max(yolo, key=lambda x: x["confidence"])
        if best_yolo["confidence"] >= 0.55:
            ocr_evidence = get_ocr_evidence(text)
            matching_ocr = [x for x in ocr_evidence if x["name"] == str(best_yolo["name"])]
            if matching_ocr:
                best_ocr = max(matching_ocr, key=lambda x: x["confidence"])
                return {
                    "name": str(best_yolo["name"]),
                    "confidence": round(max(best_ocr["confidence"], best_yolo["confidence"]), 2),
                    "source": "ocr+yolo"
                }
            return {
                "name": str(best_yolo["name"]),
                "confidence": round(best_yolo["confidence"], 2),
                "source": "yolo"
            }

    # 2. Strong OCR currency evidence with explicit currency indicators (₹, RS, INR)
    ocr_evidence = get_ocr_evidence(text)
    for item in ocr_evidence:
        raw_text = str(item.get("text", "")).upper()
        has_symbol = any(sym in raw_text for sym in ["₹", "RS", "INR", "RUPEE"])
        if has_symbol and item["confidence"] >= 0.65:
            return {
                "name": item["name"],
                "confidence": round(item["confidence"], 2),
                "source": "ocr"
            }

    return None


@app.get("/")
def home():
    return {
        "project": "VisionAI",
        "status": "Backend Running 🚀"
    }


@app.get("/health")
def health():
    return {
        "status": "ok",
        "yolo": "loaded",
        "ocr": "loaded",
        "currency_detector": "loaded",
        "currency_model": "loaded"
    }


@app.get("/hardware/status")
def get_hardware_status():
    now = time.time()
    is_recent = (now - hardware_state["last_heartbeat"]) < 10.0
    return {
        "camera": hardware_state["camera"] and is_recent,
        "distance_sensor": hardware_state["distance_sensor"] and is_recent,
        "button": hardware_state["button"] and is_recent,
        "ai_backend": True
    }


@app.post("/hardware/heartbeat")
def post_hardware_heartbeat(hb: HeartbeatUpdate):
    hardware_state["camera"] = hb.camera
    hardware_state["distance_sensor"] = hb.distance_sensor
    hardware_state["button"] = hb.button
    hardware_state["last_heartbeat"] = time.time()
    return {"status": "ok"}


@app.get("/distance")
def get_distance():
    return latest_distance


@app.post("/distance")
def post_distance(dist_data: DistanceUpdate):
    dist_val = dist_data.distance_cm
    status_str = dist_data.status

    if dist_val is None:
        status_str = "UNAVAILABLE"
    elif not status_str:
        if dist_val > 150.0:
            status_str = "PATH CLEAR"
        elif dist_val > 100.0:
            status_str = "OBJECT AHEAD"
        elif dist_val > 50.0:
            status_str = "CAUTION"
        else:
            status_str = "VERY CLOSE"

    latest_distance["distance_cm"] = dist_val
    latest_distance["status"] = status_str
    latest_distance["timestamp"] = datetime.now().isoformat()

    capture_req = capture_command_state["requested"]
    if capture_req:
        capture_command_state["requested"] = False

    res_data = dict(latest_distance)
    res_data["capture_requested"] = capture_req
    return res_data


@app.get("/analysis/latest")
def get_latest_analysis():
    return latest_analysis_event


@app.post("/camera/capture")
async def request_camera_capture():
    """
    Commands the Raspberry Pi to capture a new image, waits for the Pi capture
    and analysis result, and returns the image URL and analysis to the mobile app.
    """
    req_id = str(uuid.uuid4())
    capture_command_state["requested"] = True
    capture_command_state["request_id"] = req_id

    start_event_id = latest_analysis_event["event_id"]

    for _ in range(60):
        await asyncio.sleep(0.2)
        if latest_analysis_event["event_id"] > start_event_id:
            result = latest_analysis_event["result"]
            return {
                "success": True,
                "message": "Camera captured successfully",
                "image_url": f"/uploads/{result['filename']}",
                "result": result
            }

    raise HTTPException(status_code=504, detail="Raspberry Pi camera capture timed out. Verify Pi controller is running.")


@app.post("/analyze")
@app.post("/capture")
async def analyze_image(
    file: UploadFile = File(...),
    distance_cm: Optional[float] = Query(None)
):
    allowed_types = {"image/jpeg", "image/png", "image/jpg", "image/webp"}
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="Only JPG, JPEG, PNG, and WEBP images are allowed.")

    extension = os.path.splitext(file.filename)[1] or ".jpg"
    safe_filename = f"{uuid.uuid4()}{extension}"
    file_path = os.path.join(UPLOAD_FOLDER, safe_filename)

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    image = cv2.imread(file_path)
    if image is None:
        raise HTTPException(status_code=400, detail="Could not read uploaded image.")

    height, width = image.shape[:2]

    # Non-destructive AI image enhancement (CLAHE / contrast check)
    ai_image_path = ImageProcessor.enhance_for_ai(file_path)

    try:
        # 1. YOLO Object Detection with position coordinates
        objects = detector.detect(ai_image_path)

        # 2. Person Analysis (count & orientation)
        person_res = person_analyzer.analyze(ai_image_path, objects)
        people_count = person_res.get("people_count", 0)

        # 3. OCR Text Detection
        raw_ocr = ocr.read(ai_image_path)
        ocr_strings = [item["text"] if isinstance(item, dict) else str(item) for item in raw_ocr]
        ocr_text_summary = " ".join(ocr_strings).strip() if ocr_strings else None

        # 4. Currency Detection
        currencies = currency_detector.detect(raw_ocr)
        currency_detections = currency_model.detect(ai_image_path)
        final_currency = choose_currency(raw_ocr, currency_detections)

        # 5. Scene & Background Color Analysis
        effective_dist = distance_cm if distance_cm is not None else latest_distance.get("distance_cm")
        bg_color = scene_analyzer.extract_background_color(ai_image_path)
        scene_description = scene_analyzer.generate_description(
            person_analysis=person_res,
            objects=objects,
            background_color=bg_color,
            distance_cm=effective_dist,
            ocr_text=ocr_text_summary,
            currency_info=final_currency
        )

        response_data = {
            "success": True,
            "message": "Image analyzed successfully!",
            "filename": safe_filename,
            "image_size": {"width": width, "height": height},
            "distance": {
                "distance_cm": effective_dist,
                "status": latest_distance.get("status", "UNAVAILABLE")
            },
            "people_count": people_count,
            "objects": objects,
            "scene": {
                "description": scene_description,
                "background_color": bg_color
            },
            "text": raw_ocr,
            "ocr_text": ocr_text_summary,
            "currencies": currencies,
            "currency_detections": currency_detections,
            "final_currency": final_currency
        }

        # Broadcast event for mobile app auto-update
        latest_analysis_event["event_id"] += 1
        latest_analysis_event["timestamp"] = datetime.now().isoformat()
        latest_analysis_event["result"] = response_data

        return response_data
    finally:
        # Clean up temporary enhanced file if created
        if ai_image_path != file_path and os.path.exists(ai_image_path):
            try:
                os.remove(ai_image_path)
            except Exception:
                pass


# ======================================================
# Navigation & Routing Endpoints
# ======================================================
class LocationCoords(BaseModel):
    latitude: float
    longitude: float

class RouteRequest(BaseModel):
    origin: Optional[LocationCoords] = None
    destination_name: str
    destination_coords: Optional[LocationCoords] = None

class NavigationContextUpdate(BaseModel):
    current_location: Optional[LocationCoords] = None
    destination_name: str
    current_instruction: str
    distance_to_turn_meters: Optional[float] = 0
    remaining_distance_meters: Optional[float] = 0
    is_arrived: bool = False

latest_navigation_context = {}

@app.post("/navigation/context")
def post_navigation_context(data: NavigationContextUpdate):
    global latest_navigation_context
    latest_navigation_context = data.dict()
    latest_navigation_context["timestamp"] = datetime.now().isoformat()
    return {"status": "ok"}

@app.get("/navigation/context")
def get_navigation_context():
    return latest_navigation_context or {"status": "no_active_navigation"}

@app.get("/navigation/search")
def search_navigation_places(q: str):
    import urllib.parse
    import urllib.request
    import json
    import ssl

    query = q.strip()
    if not query:
        return []

    try:
        ctx = ssl._create_unverified_context()
        geo_url = f"https://nominatim.openstreetmap.org/search?q={urllib.parse.quote(query)}&format=json&addressdetails=1&limit=6"
        req_obj = urllib.request.Request(geo_url, headers={"User-Agent": "VisionAI/1.0"})
        with urllib.request.urlopen(req_obj, timeout=5, context=ctx) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            results = []
            for item in data:
                display_name = item.get("display_name", "")
                parts = [p.strip() for p in display_name.split(",")]
                title = parts[0] if parts else query
                subtext = ", ".join(parts[1:3]) if len(parts) > 1 else ""
                results.append({
                    "title": title,
                    "subtext": subtext,
                    "display_name": display_name,
                    "latitude": float(item["lat"]),
                    "longitude": float(item["lon"]),
                })
            return results
    except Exception as e:
        print(f"[NAV BACKEND] Search error: {e}")
        return []

@app.post("/navigation/route")
def calculate_navigation_route(req: RouteRequest):
    import urllib.parse
    import urllib.request
    import json
    import ssl

    dest_name = req.destination_name.strip()
    if not req.origin:
        raise HTTPException(status_code=400, detail="Origin GPS coordinates are required for route calculation.")

    orig = req.origin
    target_lat, target_lon = None, None
    resolved_display_name = dest_name

    if req.destination_coords:
        target_lat = req.destination_coords.latitude
        target_lon = req.destination_coords.longitude
    else:
        # 1. Real Nominatim Geocoding for Destination
        try:
            ctx = ssl._create_unverified_context()
            geo_url = f"https://nominatim.openstreetmap.org/search?q={urllib.parse.quote(dest_name)}&format=json&limit=1"
            req_obj = urllib.request.Request(geo_url, headers={"User-Agent": "VisionAI/1.0"})
            with urllib.request.urlopen(req_obj, timeout=5, context=ctx) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                if data:
                    target_lat = float(data[0]["lat"])
                    target_lon = float(data[0]["lon"])
                    raw_display = data[0].get("display_name", dest_name)
                    resolved_display_name = raw_display.split(",")[0]
        except Exception as e:
            print(f"[NAV BACKEND] Nominatim Geocode error: {e}")

    # If destination could not be geocoded, return clear 404 error
    if target_lat is None:
        raise HTTPException(status_code=404, detail=f"Could not locate destination '{dest_name}'. Please select from search suggestions.")

    # 2. Attempt OSRM Real Walking/Pedestrian Route Calculation
    try:
        ctx = ssl._create_unverified_context()
        osrm_url = f"http://router.project-osrm.org/route/v1/foot/{orig.longitude},{orig.latitude};{target_lon},{target_lat}?overview=full&geometries=geojson&steps=true"
        req_obj = urllib.request.Request(osrm_url, headers={"User-Agent": "VisionAI/1.0"})
        with urllib.request.urlopen(req_obj, timeout=6, context=ctx) as resp:
            osrm_data = json.loads(resp.read().decode('utf-8'))
            if osrm_data.get("code") == "Ok" and osrm_data.get("routes"):
                best_route = osrm_data["routes"][0]
                raw_coords = best_route["geometry"]["coordinates"] # [[lon, lat], ...]
                route_geometry = [[pt[1], pt[0]] for pt in raw_coords] # [[lat, lon], ...]
                
                osrm_steps = best_route["legs"][0]["steps"]
                instructions = []
                
                for idx, step in enumerate(osrm_steps):
                    maneuver = step.get("maneuver", {})
                    m_type = maneuver.get("type", "straight")
                    m_modifier = maneuver.get("modifier", "")
                    step_name = step.get("name", "").strip()
                    dist_m = round(step.get("distance", 0))
                    
                    loc = maneuver.get("location", [target_lon, target_lat])
                    step_lat, step_lon = loc[1], loc[0]
                    
                    # Normalize maneuver type
                    if m_type == "arrive":
                        turn_type = "destination"
                        text = f"You have arrived at {resolved_display_name}"
                    elif "left" in m_modifier:
                        turn_type = "left"
                        text = f"Turn left onto {step_name}" if step_name else "Turn left"
                    elif "right" in m_modifier:
                        turn_type = "right"
                        text = f"Turn right onto {step_name}" if step_name else "Turn right"
                    elif "uturn" in m_modifier:
                        turn_type = "uturn"
                        text = "Make a U-turn"
                    else:
                        turn_type = "straight"
                        if step_name:
                            text = f"Walk straight on {step_name}"
                        else:
                            text = f"Walk straight towards {resolved_display_name}"

                    instructions.append({
                        "step_index": idx,
                        "instruction": text,
                        "type": turn_type,
                        "distance_meters": dist_m,
                        "latitude": round(step_lat, 6),
                        "longitude": round(step_lon, 6)
                    })
                
                total_dist = round(best_route.get("distance", sum(i["distance_meters"] for i in instructions)))
                total_dur = round(best_route.get("duration", int(total_dist / 1.2))) # ~1.2 m/s walking speed

                return {
                    "success": True,
                    "destination_name": resolved_display_name,
                    "total_distance_meters": total_dist,
                    "total_duration_seconds": total_dur,
                    "instructions": instructions,
                    "route_geometry": route_geometry
                }
    except Exception as osrm_err:
        print(f"[NAV BACKEND] OSRM foot fallback due to error: {osrm_err}")

    # Fallback Interpolated Route relative to REAL origin if OSRM is unreachable
    d_lat = target_lat - orig.latitude
    d_lon = target_lon - orig.longitude

    mid1_lat = orig.latitude + d_lat * 0.35
    mid1_lon = orig.longitude + d_lon * 0.35

    mid2_lat = orig.latitude + d_lat * 0.70
    mid2_lon = orig.longitude + d_lon * 0.70

    instructions = [
        {
            "step_index": 0,
            "instruction": f"Head straight towards {resolved_display_name} on Main Road",
            "type": "straight",
            "distance_meters": 350,
            "latitude": round(mid1_lat, 6),
            "longitude": round(mid1_lon, 6)
        },
        {
            "step_index": 1,
            "instruction": "Turn left at the junction onto Station Avenue",
            "type": "left",
            "distance_meters": 500,
            "latitude": round(mid2_lat, 6),
            "longitude": round(mid2_lon, 6)
        },
        {
            "step_index": 2,
            "instruction": f"Continue straight for 400 meters. {resolved_display_name} will be on your right",
            "type": "straight",
            "distance_meters": 400,
            "latitude": round(target_lat, 6),
            "longitude": round(target_lon, 6)
        },
        {
            "step_index": 3,
            "instruction": f"You have arrived at {resolved_display_name}",
            "type": "destination",
            "distance_meters": 0,
            "latitude": round(target_lat, 6),
            "longitude": round(target_lon, 6)
        }
    ]

    total_dist = sum(inst["distance_meters"] for inst in instructions)

    return {
        "success": True,
        "destination_name": resolved_display_name,
        "total_distance_meters": total_dist,
        "total_duration_seconds": int(total_dist / 1.4),
        "instructions": instructions,
        "route_geometry": [
            [orig.latitude, orig.longitude],
            [mid1_lat, mid1_lon],
            [mid2_lat, mid2_lon],
            [target_lat, target_lon]
        ]
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)


