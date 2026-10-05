import * as Speech from 'expo-speech';
import { AnalyzeResult } from './api';

/**
 * Checks whether Android/iOS Text-to-Speech (TTS) engine is initialized and available.
 */
export async function checkTtsStatus(): Promise<boolean> {
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    if (voices && voices.length > 0) {
      console.log(`[VOICE] TTS available (${voices.length} voices found)`);
      return true;
    } else {
      console.warn('[VOICE] No compatible TTS voice found. Check Android Settings -> Text-to-speech output.');
      return false;
    }
  } catch (error) {
    console.warn('[VOICE] TTS unavailable or engine check failed:', error);
    return false;
  }
}

/**
 * Stops any active text-to-speech output immediately.
 */
export function stopSpeech(): void {
  try {
    Speech.stop();
    console.log('[VOICE] Speech stopped');
  } catch (error) {
    console.warn('[VOICE] Error stopping speech output:', error);
  }
}

/**
 * Builds a natural, concise, non-repetitive accessibility speech summary from AI analysis result.
 * Priorities:
 * 1. Immediate obstacle / distance warning (if close)
 * 2. Unified grounded scene description (people + objects)
 * 3. Reliable OCR text (only when present)
 * 4. Verified currency identification (only when present)
 */
export function buildSpokenSummary(result: AnalyzeResult): string {
  const parts: string[] = [];

  // 1. Distance & Immediate Obstacle Warning
  const distObj = result.distance;
  const distCm = distObj?.distance_cm;
  const distStatus = distObj?.status;

  if (distCm !== null && distCm !== undefined && !isNaN(distCm)) {
    const roundedDist = Math.round(distCm);
    if (distStatus === 'VERY CLOSE' || roundedDist <= 50) {
      parts.push(`Caution! Very close obstacle detected ${roundedDist} centimeters ahead.`);
    } else if (distStatus === 'CAUTION' || roundedDist <= 100) {
      parts.push(`Obstacle detected ${roundedDist} centimeters ahead.`);
    }
  }

  // 2. Grounded Scene Description
  const sceneDesc = result.scene?.description;
  if (sceneDesc && sceneDesc.trim().length > 0) {
    parts.push(sceneDesc.trim());
  }

  // 3. OCR Text Reading (Only speak when valid readable text is present)
  const ocrText = result.ocr_text;
  if (ocrText && ocrText.trim().length > 0) {
    parts.push(`Text detected: ${ocrText.trim()}.`);
  }

  // 4. Currency Identification (Only speak when currency was unambiguously identified)
  const finalCurrency = result.final_currency;
  if (finalCurrency && finalCurrency.name) {
    parts.push(`Currency identified: ${finalCurrency.name} Indian rupees.`);
  }

  // Fallback if parts is empty
  if (parts.length === 0) {
    parts.push('The area ahead appears clear and no readable text or objects were detected.');
  }

  return parts.join(' ');
}

/**
 * Automatically converts an AI analysis result into spoken audio output using expo-speech.
 * System default audio routing determines whether output plays through speaker or Bluetooth/wired headphones.
 */
export async function speakAnalysisResult(result: AnalyzeResult): Promise<void> {
  if (!result) return;

  stopSpeech();

  const spokenText = buildSpokenSummary(result);

  try {
    const isSpeaking = await Speech.isSpeakingAsync();
    if (isSpeaking) {
      await Speech.stop();
    }

    console.log('[VOICE] Starting speech:', spokenText);

    Speech.speak(spokenText, {
      language: 'en-US',
      rate: 0.90, // Accessible speech rate (0.85 - 0.95)
      pitch: 1.0, // Natural pitch
      volume: 1.0, // Maximum TTS volume output (100%)
      onStart: () => {
        console.log('[VOICE] Starting speech');
      },
      onDone: () => console.log('[VOICE] Speech finished'),
      onStopped: () => console.log('[VOICE] Speech stopped'),
      onError: (err) => console.error('[VOICE] TTS synthesis error:', err),
    });
  } catch (error) {
    console.warn('[VOICE] TTS unavailable or speech failed:', error);
  }
}
