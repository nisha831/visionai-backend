from fastapi import FastAPI

app = FastAPI(
    title="VisionAI Backend",
    description="Backend API for AI-Powered Smart Glasses",
    version="1.0.0"
)

@app.get("/")
def home():
    return {
        "project": "VisionAI",
        "status": "Backend Running 🚀"
    }

@app.get("/health")
def health():
    return {
        "status": "healthy"
    }