import * as FileSystem from 'expo-file-system/legacy';
import { RASPI_BACKEND_URL } from '@/config';
import { API_BASE_URL } from '@/constants/api';

const AI_BACKEND_URL = API_BASE_URL;

export interface DetectedObject {
  name: string;
  label?: string;
  confidence: number;
  position?: 'left' | 'center' | 'right' | string;
  box: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  };
}

export interface OCRItem {
  text: string;
  confidence: number;
}

export interface FinalCurrency {
  name: string;
  confidence: number;
  source: string;
}

export interface SceneInfo {
  description: string;
  background_color: string;
}

export interface DistanceInfo {
  distance_cm: number | null;
  status: string;
}

export interface AnalyzeResult {
  success?: boolean;
  message: string;
  filename: string;
  image_size: {
    width: number;
    height: number;
  };
  distance?: DistanceInfo;
  people_count?: number;
  objects: DetectedObject[];
  scene?: SceneInfo;
  text: (string | OCRItem)[];
  ocr_text?: string | null;
  currencies: any[];
  currency_detections: any[];
  final_currency: FinalCurrency | null;
}

export interface HardwareStatus {
  camera: boolean;
  distance_sensor: boolean;
  button: boolean;
  ai_backend: boolean;
}

// 1. Check AI Backend Health
export async function checkAiBackend(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(`${AI_BACKEND_URL}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) return false;
    const data = await response.json();
    return data.status === 'ok' || data.status === 'healthy';
  } catch (error) {
    return false;
  }
}

// 2. Check Raspberry Pi Backend Status
export async function checkRaspiBackend(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    let response = await fetch(`${RASPI_BACKEND_URL}/`, { signal: controller.signal });
    if (!response.ok) {
      response = await fetch(`${AI_BACKEND_URL}/`, { signal: controller.signal });
    }
    clearTimeout(timeoutId);

    if (!response.ok) return false;
    const data = await response.json();
    return data.status === 'online' || data.project === 'VisionAI';
  } catch (error) {
    return false;
  }
}

// 3. Fetch Real-Time Continuous Distance
export async function getContinuousDistance(): Promise<{ distance_cm: number | null; status: string } | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    let response = await fetch(`${AI_BACKEND_URL}/distance`, { signal: controller.signal });
    if (!response.ok && RASPI_BACKEND_URL !== AI_BACKEND_URL) {
      response = await fetch(`${RASPI_BACKEND_URL}/sensor/distance`, { signal: controller.signal });
    }
    clearTimeout(timeoutId);

    if (!response.ok) return null;
    const data = await response.json();
    return {
      distance_cm: data.distance_cm !== undefined ? data.distance_cm : null,
      status: data.status || (data.obstacle ? 'OBJECT AHEAD' : 'UNAVAILABLE'),
    };
  } catch (error) {
    return null;
  }
}

// 4. Fetch Hardware Status
export async function getHardwareStatus(): Promise<HardwareStatus> {
  try {
    const response = await fetch(`${AI_BACKEND_URL}/hardware/status`);
    if (response.ok) {
      return await response.json();
    }
  } catch (error) { }

  const [aiOk, piOk] = await Promise.all([checkAiBackend(), checkRaspiBackend()]);
  return {
    camera: piOk,
    distance_sensor: piOk,
    button: piOk,
    ai_backend: aiOk,
  };
}

// 5. Fetch Latest Analysis Broadcast Event (for physical button press auto-update)
export async function getLatestAnalysisEvent(): Promise<{ event_id: number; result: AnalyzeResult | null } | null> {
  try {
    const response = await fetch(`${AI_BACKEND_URL}/analysis/latest`);
    if (response.ok) {
      return await response.json();
    }
  } catch (error) { }
  return null;
}

// 6. Trigger Image Capture on Raspberry Pi Camera
export async function triggerRaspiCapture(): Promise<{ success: boolean; imageUrl: string; result?: AnalyzeResult }> {
  console.log('[VisionAI] Requesting Raspberry Pi capture via AI Backend...');
  try {
    let response: Response | null = null;

    try {
      response = await fetch(`${AI_BACKEND_URL}/camera/capture`, {
        method: 'POST',
        headers: { Accept: 'application/json' },
      });
    } catch (e) {
      if (RASPI_BACKEND_URL !== AI_BACKEND_URL) {
        response = await fetch(`${RASPI_BACKEND_URL}/camera/capture`, {
          method: 'POST',
          headers: { Accept: 'application/json' },
        });
      }
    }

    if (!response || !response.ok) {
      const err = response ? await response.text() : 'No response from server';
      throw new Error(`Camera capture request failed: ${err}`);
    }

    const data = await response.json();
    console.log('[VisionAI] Pi capture successful');
    const imageUrl = `${AI_BACKEND_URL}${data.image_url || '/camera/image'}`;
    return { success: true, imageUrl, result: data.result };
  } catch (error: any) {
    console.error('Raspberry Pi trigger capture error:', error);
    throw new Error(
      error.message || `Unable to reach camera server at ${AI_BACKEND_URL}.`
    );
  }
}

// 7. Download Remote Image to Local Device Cache
export async function downloadPiImageToLocal(remoteImageUrl: string): Promise<string> {
  console.log('[VisionAI] Downloading captured Pi image...');
  try {
    const filename = `visionai_capture_${Date.now()}.jpg`;
    const localUri = `${FileSystem.cacheDirectory}${filename}`;

    const downloadResult = await FileSystem.downloadAsync(remoteImageUrl, localUri);
    console.log(`[VisionAI] Local image URI: ${downloadResult.uri}`);
    return downloadResult.uri;
  } catch (error: any) {
    console.error('Failed to download Pi image to local cache:', error);
    throw new Error(`Failed to download image from camera server: ${error.message}`);
  }
}

// 8. Upload Local Image URI to AI Backend for YOLO + OCR + Currency + Scene Analysis
export async function analyzeImage(localImageUri: string): Promise<AnalyzeResult> {
  console.log('[VisionAI] Uploading image to AI backend...');

  try {
    const uploadResult = await FileSystem.uploadAsync(
      `${AI_BACKEND_URL}/analyze`,
      localImageUri,
      {
        httpMethod: 'POST',
        uploadType: FileSystem.FileSystemUploadType.MULTIPART,
        fieldName: 'file',
        mimeType: 'image/jpeg',
      }
    );

    console.log(`[VisionAI] AI backend HTTP status: ${uploadResult.status}`);

    if (uploadResult.status < 200 || uploadResult.status >= 300) {
      throw new Error(`AI Backend error (${uploadResult.status}): ${uploadResult.body}`);
    }

    const result: AnalyzeResult = JSON.parse(uploadResult.body);
    console.log('[VisionAI] AI analysis response received');
    return result;
  } catch (error: any) {
    console.error('[VisionAI] analyzeImage upload error:', error);
    if (
      error.message?.includes('Network request failed') ||
      error.message?.includes('Failed to fetch')
    ) {
      throw new Error(`Unable to connect to VisionAI AI backend at ${AI_BACKEND_URL}.`);
    }
    throw error;
  }
}

// 9. Full Pipeline: Trigger Pi Capture -> Download Image to Local Cache -> Upload Local File URI to AI Backend
export async function captureAndAnalyzeFromRaspi(): Promise<{
  imageUri: string;
  result: AnalyzeResult;
}> {
  const { imageUrl: remoteImageUrl, result: serverResult } =
    await triggerRaspiCapture();

  let localImageUri = remoteImageUrl;
  try {
    localImageUri = await downloadPiImageToLocal(remoteImageUrl);
  } catch (err) {
    console.warn('[VisionAI] Failed to download Pi image to local cache:', err);
  }

  // Backend already analyzed the image
  if (serverResult) {
    const finalUri = serverResult.filename
      ? `${AI_BACKEND_URL}/uploads/${serverResult.filename}`
      : remoteImageUrl;
    return {
      imageUri: finalUri,
      result: serverResult,
    };
  }

  // Fallback: analyze downloaded image
  const result = await analyzeImage(localImageUri);
  const finalUri = result.filename
    ? `${AI_BACKEND_URL}/uploads/${result.filename}`
    : localImageUri;

  return {
    imageUri: finalUri,
    result,
  };
}