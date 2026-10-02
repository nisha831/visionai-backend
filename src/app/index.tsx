import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  CameraView,
  useCameraPermissions,
} from "expo-camera";

import { API_BASE_URL } from "@/constants/api";

export default function HomeScreen() {
  // ==================================================
  // CAMERA
  // ==================================================

  const [permission, requestPermission] =
    useCameraPermissions();

  const cameraRef = useRef<CameraView | null>(null);

  const [cameraReady, setCameraReady] =
    useState(false);

  const [imageUri, setImageUri] =
    useState<string | null>(null);

  const [loading, setLoading] =
    useState(false);

  const [result, setResult] = useState(
    "Allow camera access, then capture an image."
  );

  // ==================================================
  // PERMISSION LOADING
  // ==================================================

  if (!permission) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" />

        <Text style={styles.infoText}>
          Checking camera permission...
        </Text>
      </View>
    );
  }

  // ==================================================
  // PERMISSION NOT GRANTED
  // ==================================================

  if (!permission.granted) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.title}>
          VisionAI
        </Text>

        <Text style={styles.infoText}>
          VisionAI needs access to your laptop camera.
        </Text>

        <Pressable
          style={styles.primaryButton}
          onPress={requestPermission}
        >
          <Text style={styles.primaryButtonText}>
            Allow Camera
          </Text>
        </Pressable>
      </View>
    );
  }

  // ==================================================
  // CAPTURE + ANALYZE
  // ==================================================

  const handleCapture = async () => {
    console.log(
      "================================"
    );

    console.log(
      "[CAMERA] Capture button pressed"
    );

    console.log(
      "[CAMERA] cameraReady:",
      cameraReady
    );

    console.log(
      "[CAMERA] cameraRef:",
      cameraRef.current
    );

    console.log(
      "================================"
    );

    if (!cameraRef.current) {
      const message =
        "Camera reference is not available.";

      console.error(
        "[CAMERA]",
        message
      );

      setResult(
        `CAPTURE ERROR\n\n${message}`
      );

      return;
    }

    if (!cameraReady) {
      const message =
        "Camera is not ready yet.";

      console.error(
        "[CAMERA]",
        message
      );

      setResult(
        `CAPTURE ERROR\n\n${message}`
      );

      return;
    }

    try {
      setLoading(true);

      setResult(
        "Taking picture..."
      );

      // ==================================================
      // TAKE PHOTO
      // ==================================================

      console.log(
        "[CAMERA] Calling takePictureAsync..."
      );

      const photo =
        await cameraRef.current.takePictureAsync({
          base64: true,
          quality: 0.8,
        });

      console.log(
        "[CAMERA] Photo returned:",
        photo
      );

      if (!photo) {
        throw new Error(
          "Camera returned no photo."
        );
      }

      console.log(
        "[CAMERA] Photo width:",
        photo.width
      );

      console.log(
        "[CAMERA] Photo height:",
        photo.height
      );

      console.log(
        "[CAMERA] Photo URI:",
        photo.uri
      );

      console.log(
        "[CAMERA] Base64 exists:",
        !!photo.base64
      );

      if (!photo.base64) {
        throw new Error(
          "Camera returned no base64 image data."
        );
      }

      console.log(
        "[CAMERA] Base64 length:",
        photo.base64.length
      );

      // ==================================================
      // NORMALIZE BASE64
      // ==================================================

      /*
       * On Web, Expo gives us the image as base64.
       *
       * Depending on the implementation/version,
       * it can be either:
       *
       * 1. pure base64
       *
       * OR
       *
       * 2. data:image/jpeg;base64,...
       *
       * So we remove the data URI prefix if it exists.
       */

      let cleanBase64 =
        photo.base64;

      if (
        cleanBase64.includes(",")
      ) {
        cleanBase64 =
          cleanBase64.substring(
            cleanBase64.indexOf(",") + 1
          );
      }

      // Remove whitespace/newlines
      cleanBase64 =
        cleanBase64.replace(
          /\s/g,
          ""
        );

      console.log(
        "[CAMERA] Clean base64 length:",
        cleanBase64.length
      );

      // ==================================================
      // DISPLAY IMAGE
      // ==================================================

      const imageDataUri =
        `data:image/jpeg;base64,${cleanBase64}`;

      setImageUri(
        imageDataUri
      );

      console.log(
        "[CAMERA] Captured image displayed successfully."
      );

      // ==================================================
      // CONVERT BASE64 -> BLOB
      // ==================================================

      setResult(
        "Photo captured successfully.\n\nConverting image..."
      );

      console.log(
        "[BACKEND] Converting base64 to Blob..."
      );

      let binaryString: string;

      try {
        binaryString =
          atob(cleanBase64);
      } catch (decodeError) {
        console.error(
          "[BACKEND] Base64 decode failed:",
          decodeError
        );

        throw new Error(
          "The captured image base64 could not be decoded."
        );
      }

      console.log(
        "[BACKEND] Base64 decoded successfully."
      );

      const byteLength =
        binaryString.length;

      const bytes =
        new Uint8Array(
          byteLength
        );

      for (
        let i = 0;
        i < byteLength;
        i++
      ) {
        bytes[i] =
          binaryString.charCodeAt(i);
      }

      const imageBlob =
        new Blob(
          [bytes],
          {
            type: "image/jpeg",
          }
        );

      console.log(
        "[BACKEND] Blob created."
      );

      console.log(
        "[BACKEND] Blob size:",
        imageBlob.size,
        "bytes"
      );

      console.log(
        "[BACKEND] Blob type:",
        imageBlob.type
      );

      if (imageBlob.size === 0) {
        throw new Error(
          "Generated image Blob is empty."
        );
      }

      // ==================================================
      // CREATE FILE
      // ==================================================

      const imageFile =
        new File(
          [imageBlob],
          "camera_capture.jpg",
          {
            type: "image/jpeg",
          }
        );

      console.log(
        "[BACKEND] File created."
      );

      console.log(
        "[BACKEND] File name:",
        imageFile.name
      );

      console.log(
        "[BACKEND] File size:",
        imageFile.size
      );

      // ==================================================
      // CREATE FORM DATA
      // ==================================================

      const formData =
        new FormData();

      formData.append(
        "file",
        imageFile
      );

      console.log(
        "[BACKEND] FormData prepared."
      );

      // ==================================================
      // SEND TO FASTAPI
      // ==================================================

      const backendUrl =
        `${API_BASE_URL}/analyze`;

      console.log(
        "================================"
      );

      console.log(
        "[BACKEND] Sending image to:"
      );

      console.log(
        backendUrl
      );

      console.log(
        "================================"
      );

      setResult(
        "Image captured.\n\nSending image to VisionAI backend...\n\nYOLO + OCR processing..."
      );

      const response =
        await fetch(
          backendUrl,
          {
            method: "POST",
            body: formData,
          }
        );

      // ==================================================
      // BACKEND RESPONSE
      // ==================================================

      console.log(
        "[BACKEND] HTTP status:",
        response.status
      );

      console.log(
        "[BACKEND] HTTP OK:",
        response.ok
      );

      const responseText =
        await response.text();

      console.log(
        "[BACKEND] Raw response:"
      );

      console.log(
        responseText
      );

      // ==================================================
      // BACKEND ERROR
      // ==================================================

      if (!response.ok) {
        throw new Error(
          `Backend returned HTTP ${response.status}.\n\n${responseText}`
        );
      }

      // ==================================================
      // PARSE JSON
      // ==================================================

      let data: any;

      try {
        data =
          JSON.parse(
            responseText
          );
      } catch {
        throw new Error(
          `Backend returned invalid JSON.\n\n${responseText}`
        );
      }

      console.log(
        "[BACKEND] Parsed JSON:",
        data
      );

      // ==================================================
      // SHOW JSON
      // ==================================================

      setResult(
        JSON.stringify(
          data,
          null,
          2
        )
      );

      console.log(
        "================================"
      );

      console.log(
        "[VISIONAI] ANALYSIS SUCCESSFUL"
      );

      console.log(
        "================================"
      );
    } catch (error) {
      console.error(
        "================================"
      );

      console.error(
        "[VISIONAI] ERROR"
      );

      console.error(
        error
      );

      console.error(
        "================================"
      );

      const errorMessage =
        error instanceof Error
          ? error.message
          : String(error);

      setResult(
        `CAPTURE / ANALYZE ERROR\n\n${errorMessage}\n\nCheck the browser console (F12) for details.`
      );
    } finally {
      setLoading(false);
    }
  };

  // ==================================================
  // UI
  // ==================================================

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={
        styles.content
      }
    >
      {/* HEADER */}

      <View style={styles.header}>
        <Text style={styles.title}>
          VisionAI
        </Text>

        <Text style={styles.subtitle}>
          Camera → YOLO + OCR → FastAPI
        </Text>
      </View>

      {/* CAMERA */}

      <View
        style={
          styles.cameraContainer
        }
      >
        <CameraView
          ref={cameraRef}
          style={styles.camera}
          facing="front"
          mode="picture"
          onCameraReady={() => {
            console.log(
              "[CAMERA] Camera is ready"
            );

            setCameraReady(true);

            setResult(
              "Camera ready.\n\nPlace an object or currency note in front of the camera and press Capture & Analyze."
            );
          }}
          onMountError={(error) => {
            console.error(
              "[CAMERA] Mount error:",
              error
            );

            setCameraReady(false);

            setResult(
              `CAMERA MOUNT ERROR\n\n${error.message}`
            );
          }}
        />

        <View
          style={
            styles.cameraStatus
          }
        >
          <View
            style={[
              styles.statusDot,
              {
                backgroundColor:
                  cameraReady
                    ? "#22c55e"
                    : "#f59e0b",
              },
            ]}
          />

          <Text
            style={
              styles.statusText
            }
          >
            {cameraReady
              ? "Camera Ready"
              : "Starting Camera..."}
          </Text>
        </View>
      </View>

      {/* CAPTURE BUTTON */}

      <Pressable
        style={[
          styles.primaryButton,
          (!cameraReady ||
            loading) &&
            styles.disabledButton,
        ]}
        onPress={handleCapture}
        disabled={
          !cameraReady ||
          loading
        }
      >
        {loading ? (
          <View
            style={
              styles.buttonRow
            }
          >
            <ActivityIndicator
              size="small"
              color="#ffffff"
            />

            <Text
              style={
                styles.primaryButtonText
              }
            >
              Processing...
            </Text>
          </View>
        ) : (
          <Text
            style={
              styles.primaryButtonText
            }
          >
            Capture & Analyze
          </Text>
        )}
      </Pressable>

      {/* CAPTURED IMAGE */}

      {imageUri && (
        <View
          style={styles.section}
        >
          <Text
            style={
              styles.sectionTitle
            }
          >
            Captured Image
          </Text>

          <Image
            source={{
              uri: imageUri,
            }}
            style={
              styles.previewImage
            }
            resizeMode="contain"
          />
        </View>
      )}

      {/* RESULT */}

      <View
        style={styles.section}
      >
        <Text
          style={
            styles.sectionTitle
          }
        >
          VisionAI Backend Result
        </Text>

        <View
          style={
            styles.resultBox
          }
        >
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={
              true
            }
          >
            <Text
              style={
                styles.resultText
              }
            >
              {result}
            </Text>
          </ScrollView>
        </View>
      </View>

      {/* PIPELINE */}

      <View
        style={
          styles.architectureBox
        }
      >
        <Text
          style={
            styles.architectureTitle
          }
        >
          Current Pipeline
        </Text>

        <Text
          style={
            styles.architectureText
          }
        >
          Laptop Camera
          {"\n"}↓
          {"\n"}VisionAI App
          {"\n"}↓
          {"\n"}POST /analyze
          {"\n"}↓
          {"\n"}YOLO + EasyOCR
          {"\n"}↓
          {"\n"}Currency Fusion
          {"\n"}↓
          {"\n"}JSON Result
        </Text>
      </View>

      {/* BACKEND */}

      <View
        style={
          styles.backendBox
        }
      >
        <Text
          style={
            styles.backendTitle
          }
        >
          Backend
        </Text>

        <Text
          style={
            styles.backendText
          }
        >
          {API_BASE_URL}
        </Text>

        <Text
          style={
            styles.backendEndpoint
          }
        >
          POST /analyze
        </Text>
      </View>
    </ScrollView>
  );
}

// ======================================================
// STYLES
// ======================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f7fb",
  },

  content: {
    padding: 20,
    paddingBottom: 50,
  },

  centerContainer: {
    flex: 1,
    minHeight: 600,
    justifyContent: "center",
    alignItems: "center",
    padding: 30,
    backgroundColor: "#f5f7fb",
  },

  header: {
    marginBottom: 20,
  },

  title: {
    fontSize: 32,
    fontWeight: "800",
    color: "#111827",
    marginBottom: 5,
  },

  subtitle: {
    fontSize: 15,
    color: "#6b7280",
  },

  infoText: {
    fontSize: 16,
    color: "#4b5563",
    textAlign: "center",
    marginTop: 12,
    marginBottom: 20,
    lineHeight: 24,
  },

  cameraContainer: {
    width: "100%",
    height: 420,
    backgroundColor: "#111827",
    borderRadius: 18,
    overflow: "hidden",
    position: "relative",
  },

  camera: {
    width: "100%",
    height: "100%",
  },

  cameraStatus: {
    position: "absolute",
    top: 14,
    left: 14,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor:
      "rgba(0,0,0,0.70)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },

  statusDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    marginRight: 8,
  },

  statusText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "600",
  },

  primaryButton: {
    marginTop: 18,
    backgroundColor: "#2563eb",
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },

  disabledButton: {
    opacity: 0.5,
  },

  primaryButtonText: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "700",
  },

  buttonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  section: {
    marginTop: 24,
  },

  sectionTitle: {
    fontSize: 19,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 10,
  },

  previewImage: {
    width: "100%",
    height: 300,
    backgroundColor: "#111827",
    borderRadius: 14,
  },

  resultBox: {
    backgroundColor: "#111827",
    borderRadius: 14,
    padding: 16,
    minHeight: 220,
  },

  resultText: {
    color: "#e5e7eb",
    fontSize: 13,
    lineHeight: 20,
    fontFamily: "monospace",
  },

  architectureBox: {
    marginTop: 24,
    backgroundColor: "#ffffff",
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },

  architectureTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 12,
  },

  architectureText: {
    fontSize: 14,
    lineHeight: 22,
    color: "#4b5563",
    fontFamily: "monospace",
  },

  backendBox: {
    marginTop: 24,
    backgroundColor: "#ffffff",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },

  backendTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 6,
  },

  backendText: {
    fontSize: 13,
    color: "#2563eb",
    marginBottom: 4,
  },

  backendEndpoint: {
    fontSize: 13,
    color: "#6b7280",
  },
});