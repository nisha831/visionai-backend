import { useState, useEffect } from "react";
import {
  useAudioRecorder,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from "expo-audio";
import * as Speech from "expo-speech";
import { uploadAsync, FileSystemUploadType, getInfoAsync } from "expo-file-system/legacy";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { API_BASE_URL } from "@/constants/api";

const PRESET_QUESTIONS = [
  "What is in front of me?",
  "Describe the situation around me.",
  "What objects are around me?",
  "Is there an obstacle nearby?",
  "What note is in my hand?",
  "What is written on this?",
  "What do you see?",
];

export default function HomeScreen() {
  const [result, setResult] = useState("Press Start Camera or ask a question.");
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingUri, setRecordingUri] = useState<string | null>(null);
  const [voiceStartedCamera, setVoiceStartedCamera] = useState(false);

  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  // Poll camera status & preview when camera is active
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    if (isCapturing) {
      interval = setInterval(() => {
        // Refresh preview image
        setImageUri(`${API_BASE_URL}/camera/image?t=${Date.now()}`);
      }, 2000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isCapturing]);

  // Check backend camera status on mount
  useEffect(() => {
    fetch(`${API_BASE_URL}/camera/status`)
      .then((res) => res.json())
      .then((data) => {
        if (data && typeof data.is_capturing === "boolean") {
          setIsCapturing(data.is_capturing);
          if (data.is_capturing) {
            setImageUri(`${API_BASE_URL}/camera/image?t=${Date.now()}`);
            setResult("Camera is active and continuously capturing frames.");
          }
        }
      })
      .catch(() => {
        // Backend off or unreachable on initial check
      });
  }, []);

  // Toggle Camera ON/OFF
  const handleToggleCamera = async () => {
    try {
      setLoading(true);
      const endpoint = isCapturing ? "/camera/stop" : "/camera/start";
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(`Failed to ${isCapturing ? "stop" : "start"} camera`);
      }

      const data = await response.json();
      const newCaptureState = !isCapturing;
      setIsCapturing(newCaptureState);

      if (newCaptureState) {
        setResult("Camera is ON. Capturing images every 1–2 seconds.");
        setImageUri(`${API_BASE_URL}/camera/image?t=${Date.now()}`);
      } else {
        setResult(`Camera is OFF. Frames are stored for analysis. Total captured: ${data.captured_frames_count || 0}`);
      }
    } catch (error) {
      console.log(error);
      setResult(`Network Error: Could not connect to Raspberry Pi at ${API_BASE_URL}`);
    } finally {
      setLoading(false);
    }
  };

  // Instant single capture (preserved existing behavior)
  const handleManualCapture = async () => {
    try {
      setLoading(true);
      setResult("Capturing single frame...");
      const response = await fetch(`${API_BASE_URL}/camera/capture`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Single camera capture failed");
      }

      const data = await response.json();
      const imageUrl = `${API_BASE_URL}${data.image_url}?t=${Date.now()}`;
      setImageUri(imageUrl);
      setResult("Frame captured successfully!");
    } catch (error) {
      console.log(error);
      setResult("Could not capture single image from Raspberry Pi.");
    } finally {
      setLoading(false);
    }
  };

  // Ask Gemini Question (Text Flow)
  const handleAsk = async (promptQuestion?: string) => {
    const query = (promptQuestion || question).trim();
    if (!query) {
      setResult("Please enter or select a question first.");
      return;
    }

    try {
      setAsking(true);
      setResult(`Analyzing visual memory with Gemini for: "${query}"...`);

      const response = await fetch(`${API_BASE_URL}/ask`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ question: query }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || "Failed to analyze question with Gemini");
      }

      const data = await response.json();
      const answer = data.answer || "No response generated by Gemini.";
      setResult(answer);

      if (data.images && data.images.length > 0) {
        setImageUri(`${API_BASE_URL}${data.images[data.images.length - 1]}?t=${Date.now()}`);
      }

      // Speak answer for text flow as well
      if (answer) {
        try {
          Speech.stop();
          Speech.speak(answer, { language: "en" });
        } catch (ttsErr) {
          console.log("TTS Error:", ttsErr);
        }
      }
    } catch (error: any) {
      console.log(error);
      setResult(`Error: ${error.message || "Failed to reach backend."}`);
    } finally {
      setAsking(false);
    }
  };

  const handleDistance = () => {
    setResult("Distance sensor data (HC-SR04) reserved for future update.");
  };

  const handleVoice = async () => {
    console.log("[VOICE] Button pressed. isRecording:", isRecording);
    try {
      if (!isRecording) {
        let startedCam = false;

        // 1. If camera is NOT currently running, start camera for this voice session
        if (!isCapturing) {
          try {
                    console.log("[VOICE] Starting camera for voice session...");
            const camRes = await fetch(`${API_BASE_URL}/camera/start`, { method: "POST" });
            if (camRes.ok) {
              setIsCapturing(true);
              setImageUri(`${API_BASE_URL}/camera/image?t=${Date.now()}`);
              setVoiceStartedCamera(true);
              startedCam = true;
              console.log("[VOICE] Camera started successfully.");
            } else {
              console.log("[VOICE] Camera start returned non-OK:", camRes.status);
              setResult("Could not start camera for voice session.");
              return;
            }
          } catch (camErr) {
            console.log("[VOICE] Camera start error:", camErr);
            setResult("Could not start camera for voice session.");
            return;
          }
        } else {
          console.log("[VOICE] Camera already running, skipping camera start.");
          setVoiceStartedCamera(false);
        }

        // 2. Request microphone permission
        console.log("[VOICE] Requesting microphone permission...");
        const permission = await requestRecordingPermissionsAsync();
        console.log("[VOICE] Microphone permission:", JSON.stringify(permission));

        if (!permission.granted) {
          console.log("[VOICE] Microphone permission denied.");
          if (startedCam) {
            fetch(`${API_BASE_URL}/camera/stop`, { method: "POST" }).catch(() => {});
            setIsCapturing(false);
            setVoiceStartedCamera(false);
          }
          setResult("Microphone permission is required. Please allow microphone access in device settings.");
          return;
        }

        // 3. Configure audio mode for recording
        console.log("[VOICE] Setting audio mode for recording...");
        await setAudioModeAsync({
          allowsRecording: true,
          playsInSilentMode: true,
        });
        console.log("[VOICE] Audio mode set.");

        // 4. Prepare recorder — only call if not already prepared
        console.log("[VOICE] Creating recorder (useAudioRecorder already created it).");
        const statusBefore = audioRecorder.getStatus();
        console.log("[VOICE] Recorder status before prepare:", JSON.stringify(statusBefore));

        if (!statusBefore.canRecord) {
          console.log("[VOICE] Preparing recorder...");
          await audioRecorder.prepareToRecordAsync();
          console.log("[VOICE] Recorder prepared.");
        } else {
          console.log("[VOICE] Recorder already prepared (canRecord=true), skipping prepareToRecordAsync.");
        }

        // 5. Start recording
        console.log("[VOICE] Starting recording...");
        audioRecorder.record();

        // Verify recording actually started
        const statusAfter = audioRecorder.getStatus();
        console.log("[VOICE] Recording started. isRecording:", statusAfter.isRecording, "canRecord:", statusAfter.canRecord);

        setIsRecording(true);
        setResult("🔴 Voice session active — recording audio and capturing camera frames.");

      } else {
        // --- STOP RECORDING ---
        console.log("[VOICE] Stopping recording...");
        await audioRecorder.stop();
        console.log("[VOICE] Recording stopped.");

        // Give the OS 300ms to flush the audio file to disk (critical on Android)
        await new Promise((resolve) => setTimeout(resolve, 300));

        const uri = audioRecorder.uri;
        const duration = audioRecorder.currentTime;
        console.log("[VOICE] Recording URI:", uri);
        console.log("[VOICE] Recording duration (s):", duration);

        setIsRecording(false);
        setRecordingUri(uri ?? null);

        // Stop camera ONLY if Voice itself started it
        if (voiceStartedCamera) {
          console.log("[VOICE] Stopping camera (voice started it)...");
          try {
            await fetch(`${API_BASE_URL}/camera/stop`, { method: "POST" });
            setIsCapturing(false);
          } catch (camErr) {
            console.log("[VOICE] Camera stop error:", camErr);
          }
          setVoiceStartedCamera(false);
        } else {
          console.log("[VOICE] Camera was already running before voice session — leaving it ON.");
        }

        if (!uri) {
          setResult("Recording stopped, but no audio file was created.");
          return;
        }

        // Check file size before uploading
        let fileSize = 0;
        try {
          const fileInfo = await getInfoAsync(uri);
          if (fileInfo.exists) {
            fileSize = (fileInfo as any).size ?? 0;
          }
          console.log("[VOICE] Recording file size:", fileSize, "bytes");
        } catch (infoErr) {
          console.log("[VOICE] Could not get file info:", infoErr);
        }

        if (fileSize > 0 && fileSize < 1000) {
          setResult(`Recording is too short or empty (${fileSize} bytes). Please speak clearly and try again.`);
          return;
        }

        // --- PHASE 2: VOICE PROCESSING PIPELINE ---
        console.log("[VOICE] Uploading audio...");
        setResult("🎙️ Processing voice question...");

        try {
          const uploadResult = await uploadAsync(
            `${API_BASE_URL}/voice/process`,
            uri,
            {
              fieldName: "file",
              httpMethod: "POST",
              uploadType: FileSystemUploadType.MULTIPART,
              headers: {
                Accept: "application/json",
              },
            }
          );

          console.log("[VOICE] Upload status:", uploadResult.status);
          console.log("[VOICE] Upload response:", uploadResult.body);

          if (uploadResult.status < 200 || uploadResult.status >= 300) {
            let detailMsg = "";
            try {
              const errData = JSON.parse(uploadResult.body);
              detailMsg = errData.detail || "";
            } catch (e) {}

            console.log("[VOICE] Upload error detail:", detailMsg);
            setResult(`Voice error: ${detailMsg || "Could not process recording. Please try again."}`);
            return;
          }

          const data = JSON.parse(uploadResult.body);
          const transcript = data.transcript || "";
          const answer = data.answer || "";

          console.log("[VOICE] Transcription result:", transcript);
          console.log("[VOICE] AI answer (first 100 chars):", answer.substring(0, 100));

          if (transcript) {
            setQuestion(transcript);
          }

          const fullText = `📝 You said:\n"${transcript}"\n\nAI:\n"${answer}"`;
          setResult(fullText);

          if (data.images && data.images.length > 0) {
            setImageUri(`${API_BASE_URL}${data.images[data.images.length - 1]}?t=${Date.now()}`);
          }

          // Speak answer aloud
          if (answer) {
            try {
              Speech.stop();
              Speech.speak(answer, { language: "en" });
            } catch (ttsErr) {
              console.log("[VOICE] TTS Error:", ttsErr);
            }
          }
        } catch (uploadErr) {
          console.log("[VOICE] Upload error:", uploadErr);
          setResult("Could not send voice recording to VisionAI. Check network connection.");
        }
      }
    } catch (error) {
      console.log("[VOICE] Unhandled error:", error);
      setIsRecording(false);
      setResult("Voice error: " + (error instanceof Error ? error.message : String(error)));
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>VisionAI</Text>
      <Text style={styles.subtitle}>AI-Powered Assistive Visual Memory</Text>

      {/* Status Badge */}
      <View style={[styles.statusBadge, isCapturing ? styles.statusOn : styles.statusOff]}>
        <Text style={styles.statusText}>
          Camera Status: {isCapturing ? "🟢 ON (Capturing every 1-2s)" : "🔴 OFF"}
        </Text>
      </View>

      {/* Camera Toggle Button */}
      <Pressable
        style={[styles.button, isCapturing ? styles.buttonStop : styles.buttonStart]}
        onPress={handleToggleCamera}
        disabled={loading}
      >
        <Text style={styles.icon}>{isCapturing ? "🛑" : "📷"}</Text>
        <Text style={styles.buttonTitle}>
          {loading ? "Processing..." : isCapturing ? "Stop Camera" : "Start Camera"}
        </Text>
        <Text style={styles.buttonSubtitle}>
          {isCapturing
            ? "Stop continuous background capturing"
            : "Start continuous background image capture on Raspberry Pi"}
        </Text>
      </Pressable>

      {/* Manual Instant Capture Button */}
      <Pressable
        style={[styles.button, styles.buttonSecondary]}
        onPress={handleManualCapture}
        disabled={loading}
      >
        <Text style={styles.buttonTitleSecondary}>📸 Take Single Photo</Text>
      </Pressable>

      {/* Preview Box */}
      {imageUri && (
        <View style={styles.imageBox}>
          <Text style={styles.resultHeading}>Recent Camera View</Text>
          <Image
            source={{ uri: imageUri }}
            style={styles.image}
            resizeMode="contain"
          />
        </View>
      )}

      {/* Question Section */}
      <View style={styles.askContainer}>
        <Text style={styles.resultHeading}>Ask VisionAI</Text>
        <Text style={styles.askSubtext}>
          Ask a question about your surroundings based on recent captured images.
        </Text>

        <TextInput
          style={styles.textInput}
          placeholder="e.g. What is in front of me?"
          value={question}
          onChangeText={setQuestion}
          editable={!asking}
        />

        {/* Quick Suggestion Pills */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pillContainer}>
          {PRESET_QUESTIONS.map((item, index) => (
            <Pressable
              key={index}
              style={styles.pill}
              onPress={() => {
                setQuestion(item);
                handleAsk(item);
              }}
            >
              <Text style={styles.pillText}>{item}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <Pressable
          style={[styles.askButton, asking && styles.buttonDisabled]}
          onPress={() => handleAsk()}
          disabled={asking}
        >
          {asking ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.askButtonText}>🔍 ASK GEMINI</Text>
          )}
        </Pressable>
      </View>

      {/* Secondary Features */}
      <View style={styles.rowButtons}>
        <Pressable style={[styles.buttonSmall]} onPress={handleDistance}>
          <Text style={styles.iconSmall}>📏</Text>
          <Text style={styles.buttonTitleSmall}>Distance</Text>
        </Pressable>

        <Pressable
          style={[styles.buttonSmall, isRecording && styles.voiceRecording]}
          onPress={handleVoice}
        >
          <Text style={styles.iconSmall}>{isRecording ? "🛑" : "🎙️"}</Text>
          <Text style={styles.buttonTitleSmall}>
            {isRecording ? "Stop Recording" : "Voice"}
          </Text>
        </Pressable>
      </View>

      {/* Result Output */}
      <View style={styles.resultBox}>
        <Text style={styles.resultHeading}>AI Description & Result</Text>
        <Text style={styles.resultText}>{result}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: "#f5f5f5",
    padding: 20,
    alignItems: "center",
  },
  title: {
    fontSize: 36,
    fontWeight: "bold",
    marginTop: 20,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 15,
    textAlign: "center",
    color: "#555",
    marginBottom: 20,
  },
  statusBadge: {
    width: "100%",
    padding: 10,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 15,
  },
  statusOn: {
    backgroundColor: "#e6f4ea",
  },
  statusOff: {
    backgroundColor: "#fce8e6",
  },
  statusText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
  },
  button: {
    width: "100%",
    borderRadius: 18,
    padding: 18,
    marginBottom: 12,
  },
  buttonStart: {
    backgroundColor: "#222",
  },
  buttonStop: {
    backgroundColor: "#d93025",
  },
  buttonSecondary: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#ccc",
    padding: 14,
    alignItems: "center",
  },
  buttonTitleSecondary: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
  },
  icon: {
    fontSize: 28,
    marginBottom: 6,
  },
  buttonTitle: {
    color: "white",
    fontSize: 20,
    fontWeight: "bold",
  },
  buttonSubtitle: {
    color: "#e0e0e0",
    fontSize: 13,
    marginTop: 4,
  },
  imageBox: {
    width: "100%",
    backgroundColor: "white",
    borderRadius: 18,
    padding: 15,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  image: {
    width: "100%",
    height: 240,
    borderRadius: 12,
  },
  askContainer: {
    width: "100%",
    backgroundColor: "white",
    borderRadius: 18,
    padding: 18,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  askSubtext: {
    fontSize: 13,
    color: "#666",
    marginBottom: 12,
  },
  textInput: {
    width: "100%",
    backgroundColor: "#f9f9f9",
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    marginBottom: 12,
  },
  pillContainer: {
    flexDirection: "row",
    marginBottom: 12,
  },
  pill: {
    backgroundColor: "#e8f0fe",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    marginRight: 8,
  },
  pillText: {
    color: "#1a73e8",
    fontSize: 13,
    fontWeight: "500",
  },
  askButton: {
    backgroundColor: "#1a73e8",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  askButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "bold",
  },
  rowButtons: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: "100%",
    marginBottom: 15,
  },
  buttonSmall: {
    width: "48%",
    backgroundColor: "#ffffff",
    borderRadius: 14,
    padding: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#ddd",
  },
  iconSmall: {
    fontSize: 20,
    marginBottom: 4,
  },
  buttonTitleSmall: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
  },
  resultBox: {
    width: "100%",
    backgroundColor: "white",
    borderRadius: 18,
    padding: 20,
    marginBottom: 30,
    borderWidth: 1,
    borderColor: "#ddd",
  },
  resultHeading: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 8,
  },
  resultText: {
    fontSize: 15,
    color: "#333",
    lineHeight: 22,
  },
  voiceRecording: {
    backgroundColor: "#ffe8e8",
    borderColor: "#d93025",
  },
});