import React, { useState, useEffect, useRef } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Alert,
  Platform,
} from "react-native";
import * as Location from "expo-location";
import * as Speech from "expo-speech";
import { API_BASE_URL } from "@/constants/api";

interface LocationCoords {
  latitude: number;
  longitude: number;
}

interface StepInstruction {
  step_index: number;
  instruction: string;
  type: string; // "left", "right", "straight", "destination"
  distance_meters: number;
  latitude: number;
  longitude: number;
}

interface RouteData {
  success: boolean;
  destination_name: string;
  total_distance_meters: number;
  total_duration_seconds: number;
  instructions: StepInstruction[];
  route_geometry: number[][];
}

type NavStatus = "Ready" | "Finding Route" | "Navigating" | "Arrived" | "Stopped" | "Permission Denied";

const PRESET_DESTINATIONS = [
  "Hospital",
  "Railway Station",
  "College",
  "Swargate",
  "Home",
];

// Helper to calculate distance in meters between two lat/lon points
function calculateDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export default function NavigationScreen() {
  // Navigation Overall Status State
  const [navStatus, setNavStatus] = useState<NavStatus>("Ready");

  // Location States
  const [permissionStatus, setPermissionStatus] = useState<
    "checking" | "granted" | "denied" | "unavailable"
  >("checking");
  const [currentLocation, setCurrentLocation] = useState<LocationCoords | null>(
    null
  );
  const [locationError, setLocationError] = useState<string | null>(null);

  // Navigation & Destination States
  const [destinationInput, setDestinationInput] = useState("");
  const [selectedDestination, setSelectedDestination] = useState<string | null>(
    null
  );
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [isCalculatingRoute, setIsCalculatingRoute] = useState(false);
  const [route, setRoute] = useState<RouteData | null>(null);

  // Active Navigation Tracking
  const [isNavigating, setIsNavigating] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [remainingDistance, setRemainingDistance] = useState<number | null>(
    null
  );
  const [currentInstructionText, setCurrentInstructionText] = useState<string>(
    "Enter or speak a destination to calculate route."
  );

  // Speech Input / Recognition State
  const [isListening, setIsListening] = useState(false);

  // Voice Guidance State
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const lastSpokenInstructionRef = useRef<string>("");
  const hasAnnouncedMountRef = useRef<boolean>(false);

  // Location Watcher Subscription Ref
  const locationSubscriptionRef = useRef<Location.LocationSubscription | null>(
    null
  );

  // ==================================================
  // Initial Permission & Screen Announcement
  // ==================================================
  useEffect(() => {
    checkLocationPermission();

    // Voice-First Welcome Message (announced once on initial load)
    if (!hasAnnouncedMountRef.current) {
      hasAnnouncedMountRef.current = true;
      speakText("Nav is ready. Enter or speak your destination.", true);
    }

    return () => {
      stopNavigation();
    };
  }, []);

  const checkLocationPermission = async () => {
    try {
      setPermissionStatus("checking");
      setLocationError(null);

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setPermissionStatus("denied");
        setNavStatus("Permission Denied");
        setLocationError(
          "Location permission was denied. Please grant location access in your device settings to enable GPS navigation."
        );
        speakText(
          "Location permission is required for navigation. Please enable location access.",
          true
        );
        return;
      }

      setPermissionStatus("granted");
      await fetchCurrentLocation();
    } catch (err: any) {
      console.error("[GPS] Permission error:", err);
      setPermissionStatus("unavailable");
      setLocationError(
        "Could not access GPS services. Please check device location settings."
      );
    }
  };

  const fetchCurrentLocation = async () => {
    try {
      setLocationError(null);
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const coords = {
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      };
      setCurrentLocation(coords);
      return coords;
    } catch (err: any) {
      console.warn("[GPS] Current location fetch warning:", err);
      // Fallback sample coordinates if device GPS fails or web simulator
      const fallbackCoords = { latitude: 18.5204, longitude: 73.8567 };
      setCurrentLocation(fallbackCoords);
      return fallbackCoords;
    }
  };

  // ==================================================
  // Voice Guidance Speech Helper
  // ==================================================
  const speakText = (text: string, force: boolean = false) => {
    if (!voiceEnabled && !force) return;
    if (text === lastSpokenInstructionRef.current && !force) return;

    try {
      Speech.stop();
      Speech.speak(text, {
        language: "en-US",
        pitch: 1.0,
        rate: 0.95,
      });
      lastSpokenInstructionRef.current = text;
    } catch (e) {
      console.warn("[SPEECH] Speech synthesis error:", e);
    }
  };

  // ==================================================
  // Voice Destination Input (Web Speech Recognition API)
  // ==================================================
  const handleSpeakDestination = () => {
    if (isNavigating || isCalculatingRoute) return;

    // Check if Web Speech API is supported in current browser environment
    if (
      typeof window !== "undefined" &&
      ("webkitSpeechRecognition" in window || "SpeechRecognition" in window)
    ) {
      try {
        const SpeechRecognition =
          (window as any).SpeechRecognition ||
          (window as any).webkitSpeechRecognition;
        const recognition = new SpeechRecognition();

        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = "en-US";

        recognition.onstart = () => {
          setIsListening(true);
          speakText("Listening for destination...", true);
        };

        recognition.onresult = (event: any) => {
          const transcript = event.results[0][0].transcript;
          console.log("[VOICE INPUT] Recognized transcript:", transcript);
          if (transcript) {
            setDestinationInput(transcript);
            speakText(
              `Destination set to ${transcript}. Press Start Navigation to begin.`,
              true
            );
          }
        };

        recognition.onerror = (event: any) => {
          console.warn("[VOICE INPUT] Error:", event.error);
          setIsListening(false);
          speakText(
            "Could not recognize destination. Please try typing your destination.",
            true
          );
        };

        recognition.onend = () => {
          setIsListening(false);
        };

        recognition.start();
      } catch (err) {
        console.error("[VOICE INPUT] Initialization failed:", err);
        setIsListening(false);
        speakText(
          "Voice recognition is unavailable on this device. Please type your destination.",
          true
        );
      }
    } else {
      // Speech recognition fallback notice
      speakText(
        "Voice recognition is unavailable on this device. Please type your destination into the input field.",
        true
      );
      Alert.alert(
        "Voice Input Notice",
        "Speech recognition is not natively supported in this browser/device environment. Please type your destination in the text field."
      );
    }
  };

  // ==================================================
  // Route Calculation & Geocoding
  // ==================================================
  const handleStartRouteCalculation = async (targetDest?: string) => {
    const destToSearch = (targetDest || destinationInput).trim();
    if (!destToSearch) {
      speakText("Please enter or speak a destination.", true);
      Alert.alert(
        "Destination Required",
        "Please enter or speak a destination."
      );
      return;
    }

    setNavStatus("Finding Route");
    setIsCalculatingRoute(true);
    setIsGeocoding(true);
    setSelectedDestination(destToSearch);

    try {
      // 1. Ensure current location is ready
      let origin = currentLocation;
      if (!origin) {
        origin = await fetchCurrentLocation();
      }

      // 2. Geocode / Route via Backend API
      const response = await fetch(`${API_BASE_URL}/navigation/route`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origin: origin,
          destination_name: destToSearch,
        }),
      });

      if (!response.ok) {
        throw new Error(
          `Backend returned HTTP status ${response.status}`
        );
      }

      const routeData: RouteData = await response.json();
      if (!routeData.success || !routeData.instructions.length) {
        throw new Error("No valid route instructions found for this destination.");
      }

      setRoute(routeData);
      setCurrentStepIndex(0);
      setRemainingDistance(routeData.total_distance_meters);
      setNavStatus("Navigating");

      const firstInstruction = routeData.instructions[0].instruction;
      setCurrentInstructionText(firstInstruction);

      // Start continuous location tracking
      startNavigationTracking(routeData);

      const startSpeechMsg = `Navigation started to ${destToSearch}. ${firstInstruction}`;
      speakText(startSpeechMsg, true);
    } catch (err: any) {
      console.error("[NAV] Route calculation error:", err);
      setNavStatus("Ready");
      const errMessage =
        err.message || "Failed to calculate route. Please try again.";
      Alert.alert("Route Error", errMessage);
      setCurrentInstructionText(`Route Error: ${errMessage}`);
      speakText("Destination not found. Please try again.", true);
    } finally {
      setIsCalculatingRoute(false);
      setIsGeocoding(false);
    }
  };

  // ==================================================
  // Continuous Location Tracking & Maneuver Logic
  // ==================================================
  const startNavigationTracking = async (activeRoute: RouteData) => {
    stopNavigationWatcherOnly();
    setIsNavigating(true);

    try {
      locationSubscriptionRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 3000, // update every 3s
          distanceInterval: 5, // or every 5 meters
        },
        (location) => {
          const userCoords = {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
          };
          setCurrentLocation(userCoords);
          processNavigationProgress(userCoords, activeRoute);
        }
      );
    } catch (err) {
      console.warn("[GPS] Location watcher failed to start:", err);
    }
  };

  const processNavigationProgress = (
    userPos: LocationCoords,
    activeRoute: RouteData
  ) => {
    if (!activeRoute || !activeRoute.instructions.length) return;

    const instructions = activeRoute.instructions;
    const destStep = instructions[instructions.length - 1];

    // Distance to final destination
    const distToDest = calculateDistanceMeters(
      userPos.latitude,
      userPos.longitude,
      destStep.latitude,
      destStep.longitude
    );
    setRemainingDistance(distToDest);

    // Check arrival (< 15 meters)
    if (distToDest < 15) {
      const arrivedText = `You have arrived at ${activeRoute.destination_name}`;
      setCurrentInstructionText(arrivedText);
      setNavStatus("Arrived");
      speakText(arrivedText, true);
      stopNavigationWatcherOnly();
      setIsNavigating(false);
      return;
    }

    // Check step progression
    let stepIdx = currentStepIndex;
    if (stepIdx < instructions.length - 1) {
      const currentStep = instructions[stepIdx];
      const distToStep = calculateDistanceMeters(
        userPos.latitude,
        userPos.longitude,
        currentStep.latitude,
        currentStep.longitude
      );

      // Advance to next step if user is close to turn (< 18 meters)
      if (distToStep < 18) {
        stepIdx += 1;
        setCurrentStepIndex(stepIdx);
      }
    }

    const activeStep = instructions[stepIdx];
    let instructionMsg = activeStep.instruction;

    // Append remaining step distance info if available
    if (activeStep.distance_meters > 0) {
      if (activeStep.type === "left" || activeStep.type === "right") {
        instructionMsg = `${activeStep.instruction} in ${Math.round(
          activeStep.distance_meters
        )} meters`;
      }
    }

    setCurrentInstructionText(instructionMsg);
    speakText(instructionMsg);

    // Context update to backend for AI readiness (fire and forget)
    fetch(`${API_BASE_URL}/navigation/context`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        current_location: userPos,
        destination_name: activeRoute.destination_name,
        current_instruction: instructionMsg,
        distance_to_turn_meters: activeStep.distance_meters,
        remaining_distance_meters: distToDest,
        is_arrived: false,
      }),
    }).catch(() => {});
  };

  const stopNavigationWatcherOnly = () => {
    if (locationSubscriptionRef.current) {
      locationSubscriptionRef.current.remove();
      locationSubscriptionRef.current = null;
    }
  };

  const stopNavigation = () => {
    stopNavigationWatcherOnly();
    setIsNavigating(false);
    setNavStatus("Stopped");
    setRoute(null);
    setCurrentInstructionText("Navigation stopped. Enter or speak a destination to start.");
    lastSpokenInstructionRef.current = "";
    Speech.stop();
    speakText("Navigation stopped.", true);
  };

  const formatDistanceDisplay = (meters: number | null) => {
    if (meters === null) return "--";
    if (meters >= 1000) {
      return `${(meters / 1000).toFixed(1)} km`;
    }
    return `${Math.round(meters)} m`;
  };

  // ==================================================
  // UI Render
  // ==================================================
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
    >
      {/* HEADER */}
      <View style={styles.headerBox} accessibilityRole="header">
        <Text style={styles.titleText}>Nav</Text>
        <Text style={styles.subtitleText}>
          Voice-First Navigation for Visually Impaired Users
        </Text>
      </View>

      {/* SAFETY DISCLAIMER */}
      <View style={styles.warningCard} accessibilityRole="summary">
        <Text style={styles.warningTitle}>⚠️ Safety Disclaimer</Text>
        <Text style={styles.warningText}>
          GPS & navigation data may be inaccurate. Always maintain physical
          awareness of your surroundings.
        </Text>
      </View>

      {/* ACCESSIBLE NAVIGATION STATUS BADGE */}
      <View
        style={styles.statusBadgeCard}
        accessibilityRole="text"
        accessibilityLiveRegion="polite"
        accessibilityLabel={`Navigation Status: ${navStatus}`}
      >
        <Text style={styles.statusBadgeLabelText}>
          Navigation Status: <Text style={styles.statusBadgeValueText}>{navStatus}</Text>
        </Text>
      </View>

      {/* LOCATION STATUS CARD */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>GPS Location Status</Text>
        <View style={styles.statusRow}>
          <View
            style={[
              styles.statusIndicator,
              permissionStatus === "granted"
                ? styles.statusGreen
                : permissionStatus === "denied" || permissionStatus === "unavailable"
                ? styles.statusRed
                : styles.statusYellow,
            ]}
          />
          <Text style={styles.statusLabelText}>
            {permissionStatus === "granted"
              ? "Location Available"
              : permissionStatus === "denied"
              ? "Permission Denied"
              : permissionStatus === "unavailable"
              ? "GPS Unavailable"
              : "Getting Location..."}
          </Text>
        </View>

        {currentLocation && (
          <Text style={styles.coordsText}>
            Coordinates: {currentLocation.latitude.toFixed(4)},{" "}
            {currentLocation.longitude.toFixed(4)}
          </Text>
        )}

        {permissionStatus !== "granted" && (
          <Pressable
            style={styles.secondaryButton}
            onPress={checkLocationPermission}
            accessibilityLabel="Grant location permission"
            accessibilityRole="button"
          >
            <Text style={styles.secondaryButtonText}>Grant Location Access</Text>
          </Pressable>
        )}
      </View>

      {/* DESTINATION INPUT CARD */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Destination</Text>

        {/* SPEAK DESTINATION BUTTON */}
        <Pressable
          style={[
            styles.voiceInputButton,
            isListening && styles.voiceInputButtonListening,
            (isNavigating || isCalculatingRoute) && styles.disabledButton,
          ]}
          onPress={handleSpeakDestination}
          disabled={isNavigating || isCalculatingRoute}
          accessibilityLabel="Speak Destination"
          accessibilityRole="button"
          accessibilityHint="Tap to speak your destination using voice input"
        >
          {isListening ? (
            <ActivityIndicator color="#ffffff" size="small" />
          ) : (
            <Text style={styles.voiceInputButtonText}>
              🎙️ Speak Destination
            </Text>
          )}
        </Pressable>

        <Text style={styles.labelSubtext}>
          Type your destination, or use Speak Destination.
        </Text>

        <TextInput
          style={styles.textInput}
          placeholder="Destination (e.g. Railway Station, Hospital)"
          placeholderTextColor="#9ca3af"
          value={destinationInput}
          onChangeText={setDestinationInput}
          accessibilityLabel="Destination"
          accessibilityHint="Type your destination, or use Speak Destination."
          editable={!isNavigating && !isCalculatingRoute}
        />

        {/* PRESET CHIPS */}
        <Text style={styles.presetLabel}>Quick Suggestions:</Text>
        <View style={styles.presetContainer}>
          {PRESET_DESTINATIONS.map((preset) => (
            <Pressable
              key={preset}
              style={[
                styles.presetChip,
                destinationInput === preset && styles.presetChipSelected,
              ]}
              onPress={() => {
                setDestinationInput(preset);
                handleStartRouteCalculation(preset);
              }}
              disabled={isNavigating || isCalculatingRoute}
              accessibilityLabel={`Select destination ${preset}`}
              accessibilityRole="button"
            >
              <Text
                style={[
                  styles.presetChipText,
                  destinationInput === preset && styles.presetChipTextSelected,
                ]}
              >
                {preset}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* START / STOP NAVIGATION BUTTONS */}
        {!isNavigating ? (
          <Pressable
            style={[
              styles.primaryButton,
              (isCalculatingRoute || permissionStatus !== "granted") &&
                styles.disabledButton,
            ]}
            onPress={() => handleStartRouteCalculation()}
            disabled={isCalculatingRoute || permissionStatus !== "granted"}
            accessibilityLabel="Start Navigation"
            accessibilityRole="button"
            accessibilityHint="Calculates route and begins turn by turn guidance"
          >
            {isCalculatingRoute ? (
              <ActivityIndicator color="#ffffff" size="small" />
            ) : (
              <Text style={styles.primaryButtonText}>🚀 Start Navigation</Text>
            )}
          </Pressable>
        ) : (
          <Pressable
            style={styles.dangerButton}
            onPress={stopNavigation}
            accessibilityLabel="Stop Navigation"
            accessibilityRole="button"
            accessibilityHint="Immediately stops location tracking and voice guidance"
          >
            <Text style={styles.dangerButtonText}>🛑 Stop Navigation</Text>
          </Pressable>
        )}
      </View>

      {/* ACTIVE NAVIGATION STATUS & INSTRUCTION DISPLAY */}
      <View style={styles.instructionDisplayCard}>
        <Text style={styles.instructionHeaderTitle}>Current Guidance Instruction</Text>

        <View
          style={styles.instructionBox}
          accessibilityRole="text"
          accessibilityLiveRegion="assertive"
          accessibilityLabel={`Current instruction: ${currentInstructionText}`}
        >
          <Text style={styles.instructionText}>{currentInstructionText}</Text>
        </View>

        {/* DISTANCE & METRICS ROW */}
        <View style={styles.metricsRow}>
          <View style={styles.metricItem}>
            <Text style={styles.metricLabel}>Distance Remaining</Text>
            <Text style={styles.metricValue}>
              {formatDistanceDisplay(remainingDistance)}
            </Text>
          </View>

          <View style={styles.metricItem}>
            <Text style={styles.metricLabel}>Navigation State</Text>
            <Text style={styles.metricValue}>{navStatus}</Text>
          </View>
        </View>

        {/* VOICE CONTROLS */}
        <View style={styles.controlsRow}>
          <Pressable
            style={styles.controlButton}
            onPress={() => speakText(currentInstructionText, true)}
            accessibilityLabel="Repeat Voice"
            accessibilityRole="button"
            accessibilityHint="Repeats the current spoken navigation instruction"
          >
            <Text style={styles.controlButtonText}>🔊 Repeat Voice</Text>
          </Pressable>

          <Pressable
            style={[
              styles.controlButton,
              !voiceEnabled && styles.controlButtonMuted,
            ]}
            onPress={() => {
              const nextState = !voiceEnabled;
              setVoiceEnabled(nextState);
              speakText(
                nextState ? "Voice guidance enabled" : "Voice guidance muted",
                true
              );
            }}
            accessibilityLabel="Toggle Voice Guidance"
            accessibilityRole="button"
            accessibilityHint="Enables or mutes automatic spoken guidance"
          >
            <Text style={styles.controlButtonText}>
              {voiceEnabled ? "Mute Voice" : "Enable Voice"}
            </Text>
          </Pressable>
        </View>
      </View>

      {/* OSM ATTRIBUTION */}
      <View style={styles.attributionBox}>
        <Text style={styles.attributionText}>
          Map & routing data © OpenStreetMap contributors
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
    backgroundColor: "#f3f4f6",
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 60,
  },
  headerBox: {
    marginTop: Platform.OS === "ios" ? 40 : 10,
    marginBottom: 14,
  },
  titleText: {
    fontSize: 32,
    fontWeight: "900",
    color: "#111827",
  },
  subtitleText: {
    fontSize: 15,
    color: "#4b5563",
    marginTop: 2,
  },
  warningCard: {
    backgroundColor: "#fffbe6",
    borderColor: "#ffe58f",
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  warningTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#d48806",
    marginBottom: 4,
  },
  warningText: {
    fontSize: 13,
    color: "#8c6800",
    lineHeight: 18,
  },
  statusBadgeCard: {
    backgroundColor: "#1e1b4b",
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 16,
    borderLeftWidth: 5,
    borderLeftColor: "#6366f1",
  },
  statusBadgeLabelText: {
    color: "#e0e7ff",
    fontSize: 16,
    fontWeight: "600",
  },
  statusBadgeValueText: {
    color: "#38bdf8",
    fontSize: 18,
    fontWeight: "800",
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  cardTitle: {
    fontSize: 19,
    fontWeight: "800",
    color: "#111827",
    marginBottom: 12,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
  statusIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 8,
  },
  statusGreen: {
    backgroundColor: "#10b981",
  },
  statusYellow: {
    backgroundColor: "#f59e0b",
  },
  statusRed: {
    backgroundColor: "#ef4444",
  },
  statusLabelText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1f2937",
  },
  coordsText: {
    fontSize: 12,
    color: "#6b7280",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    marginTop: 4,
  },
  voiceInputButton: {
    backgroundColor: "#059669",
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 56,
    marginBottom: 14,
  },
  voiceInputButtonListening: {
    backgroundColor: "#d97706",
  },
  voiceInputButtonText: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "800",
  },
  labelSubtext: {
    fontSize: 14,
    color: "#4b5563",
    marginBottom: 10,
  },
  textInput: {
    backgroundColor: "#f9fafb",
    borderWidth: 1.5,
    borderColor: "#d1d5db",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    color: "#111827",
    marginBottom: 14,
  },
  presetLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#6b7280",
    marginBottom: 8,
  },
  presetContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 18,
  },
  presetChip: {
    backgroundColor: "#e0e7ff",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },
  presetChipSelected: {
    backgroundColor: "#3730a3",
  },
  presetChipText: {
    color: "#3730a3",
    fontSize: 13,
    fontWeight: "600",
  },
  presetChipTextSelected: {
    color: "#ffffff",
  },
  primaryButton: {
    backgroundColor: "#2563eb",
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 56,
  },
  disabledButton: {
    opacity: 0.5,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "800",
  },
  secondaryButton: {
    marginTop: 10,
    backgroundColor: "#e5e7eb",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  secondaryButtonText: {
    color: "#1f2937",
    fontWeight: "600",
    fontSize: 14,
  },
  dangerButton: {
    backgroundColor: "#dc2626",
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 56,
  },
  dangerButtonText: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "800",
  },
  instructionDisplayCard: {
    backgroundColor: "#1e293b",
    borderRadius: 16,
    padding: 18,
    marginBottom: 20,
  },
  instructionHeaderTitle: {
    color: "#94a3b8",
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  instructionBox: {
    backgroundColor: "#0f172a",
    borderRadius: 12,
    padding: 16,
    minHeight: 85,
    justifyContent: "center",
    borderLeftWidth: 5,
    borderLeftColor: "#38bdf8",
    marginBottom: 16,
  },
  instructionText: {
    color: "#f8fafc",
    fontSize: 22,
    fontWeight: "700",
    lineHeight: 30,
  },
  metricsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: "#334155",
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  metricItem: {
    alignItems: "center",
    flex: 1,
  },
  metricLabel: {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 4,
  },
  metricValue: {
    color: "#f8fafc",
    fontSize: 18,
    fontWeight: "700",
  },
  controlsRow: {
    flexDirection: "row",
    gap: 10,
  },
  controlButton: {
    flex: 1,
    backgroundColor: "#475569",
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  controlButtonMuted: {
    backgroundColor: "#94a3b8",
  },
  controlButtonText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 14,
  },
  attributionBox: {
    marginTop: 20,
    alignItems: "center",
  },
  attributionText: {
    fontSize: 12,
    color: "#6b7280",
    textAlign: "center",
  },
});
