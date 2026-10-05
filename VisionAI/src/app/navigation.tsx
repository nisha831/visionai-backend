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
import * as Device from "expo-device";
import * as Speech from "expo-speech";
import { WebView } from "react-native-webview";
import { API_BASE_URL } from "@/constants/api";

interface LocationCoords {
  latitude: number;
  longitude: number;
}

interface StepInstruction {
  step_index: number;
  instruction: string;
  type: string; // "left", "right", "straight", "uturn", "destination"
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

interface PlaceSearchResult {
  title: string;
  subtext: string;
  display_name: string;
  latitude: number;
  longitude: number;
}

interface PendingLocationSelection {
  coords: LocationCoords;
  title: string;
  subtext: string;
  display_name: string;
}

type NavStatus =
  | "Ready"
  | "Finding Route"
  | "Navigating"
  | "Arrived"
  | "Stopped"
  | "Permission Denied"
  | "Location Unavailable";

type LocationMode = "gps" | "manual";

export interface EnvironmentInfo {
  name: string;
  type:
    | "macOS"
    | "iOS_Physical"
    | "iOS_Simulator"
    | "Android_Physical"
    | "Android_Emulator"
    | "Web";
  isMac: boolean;
  isSimulator: boolean;
  description: string;
}

const PRESET_DESTINATIONS = [
  "Hospital",
  "Railway Station",
  "College",
  "Swargate",
  "Home",
];

// Helper to detect current running environment (macOS, Simulators, Physical Phones)
function detectEnvironmentInfo(): EnvironmentInfo {
  if (Platform.OS === "web") {
    const isMacUserAgent =
      typeof navigator !== "undefined" &&
      /Macintosh|Mac OS X/i.test(navigator.userAgent);
    if (isMacUserAgent) {
      return {
        name: "macOS Development Environment (Browser)",
        type: "macOS",
        isMac: true,
        isSimulator: false,
        description:
          "Obtaining live device location directly via macOS Location Services",
      };
    }
    return {
      name: "Web Browser Environment",
      type: "Web",
      isMac: false,
      isSimulator: false,
      description: "Obtaining live location via Browser OS Location Services",
    };
  }

  if (Platform.OS === "macos") {
    return {
      name: "macOS Native Environment",
      type: "macOS",
      isMac: true,
      isSimulator: false,
      description:
        "Obtaining live location directly via macOS CoreLocation API",
    };
  }

  if (Platform.OS === "ios") {
    if (Device.isDevice) {
      return {
        name: "Physical iPhone",
        type: "iOS_Physical",
        isMac: false,
        isSimulator: false,
        description:
          "Obtaining live location via iPhone GPS / CoreLocation Services",
      };
    } else {
      return {
        name: "iOS Simulator",
        type: "iOS_Simulator",
        isMac: false,
        isSimulator: true,
        description:
          "Using iOS Simulator configured location (Features → Location)",
      };
    }
  }

  if (Platform.OS === "android") {
    if (Device.isDevice) {
      return {
        name: "Physical Android Phone",
        type: "Android_Physical",
        isMac: false,
        isSimulator: false,
        description: "Obtaining live location via Android Device GPS Services",
      };
    } else {
      return {
        name: "Android Emulator",
        type: "Android_Emulator",
        isMac: false,
        isSimulator: true,
        description: "Using Android Emulator extended controls location",
      };
    }
  }

  return {
    name: `${Platform.OS} Environment`,
    type: "Web",
    isMac: false,
    isSimulator: false,
    description: "Obtaining location via OS Location Services",
  };
}

// Helper to calculate distance in meters between two lat/lon points using Haversine formula
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

// Helper to calculate perpendicular distance from user position P to line segment AB
function distanceToSegmentMeters(
  pLat: number,
  pLon: number,
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number
): number {
  const abDist = calculateDistanceMeters(aLat, aLon, bLat, bLon);
  if (abDist < 1) {
    return calculateDistanceMeters(pLat, pLon, aLat, aLon);
  }
  const dx = bLon - aLon;
  const dy = bLat - aLat;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return calculateDistanceMeters(pLat, pLon, aLat, aLon);

  let t = ((pLon - aLon) * dx + (pLat - aLat) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const projLat = aLat + t * dy;
  const projLon = aLon + t * dx;
  return calculateDistanceMeters(pLat, pLon, projLat, projLon);
}

// Helper to query places for search & autocomplete
const fetchPlaceSearchCandidates = async (
  query: string
): Promise<PlaceSearchResult[]> => {
  const cleanQ = query.trim();
  if (!cleanQ || cleanQ.length < 2) return [];

  // 1. Backend Search Endpoint
  try {
    const resp = await fetch(
      `${API_BASE_URL}/navigation/search?q=${encodeURIComponent(cleanQ)}`
    );
    if (resp.ok) {
      const data = await resp.json();
      if (Array.isArray(data) && data.length > 0) {
        return data;
      }
    }
  } catch (e) {
    console.warn("[NAV SEARCH] Backend search warning:", e);
  }

  // 2. Direct Nominatim Fallback
  try {
    const geoUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
      cleanQ
    )}&format=json&addressdetails=1&limit=6`;
    const resp = await fetch(geoUrl, {
      headers: { "User-Agent": "VisionAI/1.0" },
    });
    if (resp.ok) {
      const data = await resp.json();
      return data.map((item: any) => {
        const parts = (item.display_name || cleanQ)
          .split(",")
          .map((s: string) => s.trim());
        return {
          title: parts[0] || cleanQ,
          subtext: parts.slice(1, 3).join(", "),
          display_name: item.display_name,
          latitude: parseFloat(item.lat),
          longitude: parseFloat(item.lon),
        };
      });
    }
  } catch (e) {
    console.warn("[NAV SEARCH] Nominatim direct search warning:", e);
  }

  return [];
};

// Generate HTML for Leaflet OpenStreetMap View with Live/Manual Markers, Map Tap, Zoom, & Recenter
function generateMapHtml(
  currentLoc: LocationCoords | null,
  activeRoute: RouteData | null,
  isManualMode: boolean = false
) {
  const initLat = currentLoc ? currentLoc.latitude : 0;
  const initLon = currentLoc ? currentLoc.longitude : 0;
  const routeGeomJson = activeRoute
    ? JSON.stringify(activeRoute.route_geometry)
    : "[]";
  const destStep =
    activeRoute?.instructions[activeRoute.instructions.length - 1];
  const destLat = destStep ? destStep.latitude : "null";
  const destLon = destStep ? destStep.longitude : "null";
  const destName = activeRoute
    ? JSON.stringify(activeRoute.destination_name)
    : '""';

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
      <style>
        body, html, #map { margin: 0; padding: 0; width: 100%; height: 100%; background: #0f172a; }
        .user-dot {
          width: 22px; height: 22px; background-color: #2563eb; border: 3.5px solid #ffffff;
          border-radius: 50%; box-shadow: 0 0 14px rgba(37,99,235,0.9);
        }
        .user-pulse {
          position: absolute; width: 44px; height: 44px; top: -11px; left: -11px;
          background: rgba(37, 99, 235, 0.35); border-radius: 50%;
          animation: pulse 2s infinite ease-out;
        }
        .manual-dot {
          width: 28px; height: 28px; background-color: #d97706; border: 3px solid #ffffff;
          border-radius: 50%; box-shadow: 0 0 16px rgba(217,119,6,0.9);
          display: flex; align-items: center; justify-content: center; font-size: 15px; font-weight: bold; color: #ffffff;
        }
        .manual-pulse {
          position: absolute; width: 48px; height: 48px; top: -10px; left: -10px;
          background: rgba(217, 119, 6, 0.4); border-radius: 50%;
          animation: pulse 2s infinite ease-out;
        }
        @keyframes pulse {
          0% { transform: scale(0.5); opacity: 1; }
          100% { transform: scale(1.6); opacity: 0; }
        }
      </style>
    </head>
    <body>
      <div id="map"></div>
      <script>
        var map = L.map('map', { zoomControl: false });
        var currentIsManual = ${isManualMode ? "true" : "false"};

        if (${initLat} !== 0 && ${initLon} !== 0) {
          map.setView([${initLat}, ${initLon}], 16);
        } else {
          map.setView([20.5937, 78.9629], 5);
        }

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '© OpenStreetMap'
        }).addTo(map);

        var userMarker = null;
        var destMarker = null;
        var routePoly = null;
        var userPanned = false;
        var panTimeout = null;

        function createIcon(isMan) {
          if (isMan) {
            return L.divIcon({
              className: 'manual-container',
              html: '<div style="position:relative"><div class="manual-pulse"></div><div class="manual-dot">📌</div></div>',
              iconSize: [28, 28], iconAnchor: [14, 14]
            });
          }
          return L.divIcon({
            className: 'user-container',
            html: '<div style="position:relative"><div class="user-pulse"></div><div class="user-dot"></div></div>',
            iconSize: [22, 22], iconAnchor: [11, 11]
          });
        }

        map.on('dragstart zoomstart', function() {
          userPanned = true;
          if (panTimeout) clearTimeout(panTimeout);
          panTimeout = setTimeout(function() {
            userPanned = false;
          }, 12000);
        });

        // Tap on map to select manual location point
        map.on('click', function(e) {
          if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'MAP_TAP_LOCATION',
              lat: e.latlng.lat,
              lon: e.latlng.lng
            }));
          }
        });

        function updateMap(uLat, uLon, geom, dLat, dLon, dName, isMan) {
          if (isMan !== undefined) currentIsManual = isMan;

          if (uLat && uLon && uLat !== 0 && uLon !== 0) {
            if (!userMarker) {
              userMarker = L.marker([uLat, uLon], { icon: createIcon(currentIsManual) }).addTo(map);
              map.setView([uLat, uLon], 16);
            } else {
              userMarker.setLatLng([uLat, uLon]);
              userMarker.setIcon(createIcon(currentIsManual));
            }
            if (currentIsManual) {
              userMarker.bindPopup('<b>📌 Test Location (Simulated)</b>').openPopup();
            } else {
              userMarker.bindPopup('<b>📍 Live Device Location</b>');
            }
          }

          if (routePoly) { map.removeLayer(routePoly); routePoly = null; }
          if (destMarker) { map.removeLayer(destMarker); destMarker = null; }

          if (geom && geom.length > 0) {
            routePoly = L.polyline(geom, { color: '#2563eb', weight: 6, opacity: 0.85, lineJoin: 'round' }).addTo(map);
            if (!uLat || uLat === 0) {
              map.fitBounds(routePoly.getBounds(), { padding: [25, 25] });
            }
          }

          if (dLat && dLon && dLat !== 'null' && dLon !== 'null') {
            destMarker = L.marker([dLat, dLon]).addTo(map);
            if (dName) destMarker.bindPopup('<b>🏁 ' + dName + '</b>').openPopup();
          }
        }

        updateMap(${initLat}, ${initLon}, ${routeGeomJson}, ${destLat}, ${destLon}, ${destName}, ${
    isManualMode ? "true" : "false"
  });

        window.addEventListener('message', function(event) {
          try {
            var data = JSON.parse(event.data);
            if (data.type === 'ZOOM_IN') {
              map.zoomIn();
            } else if (data.type === 'ZOOM_OUT') {
              map.zoomOut();
            } else if (data.type === 'RECENTER') {
              userPanned = false;
              if (panTimeout) clearTimeout(panTimeout);
              if (userMarker) {
                var pos = userMarker.getLatLng();
                map.setView([pos.lat, pos.lng], 17);
              }
            } else if (data.type === 'UPDATE_LOCATION') {
              var isMan = data.isManual !== undefined ? data.isManual : currentIsManual;
              if (userMarker) {
                userMarker.setLatLng([data.lat, data.lon]);
                userMarker.setIcon(createIcon(isMan));
              } else {
                updateMap(data.lat, data.lon, null, null, null, null, isMan);
              }
              if (data.isNavigating && !userPanned) {
                map.panTo([data.lat, data.lon]);
              }
            } else if (data.type === 'UPDATE_ROUTE') {
              updateMap(data.uLat, data.uLon, data.geom, data.dLat, data.dLon, data.dName, data.isManual);
            } else if (data.type === 'GET_CENTER_LOCATION') {
              var center = map.getCenter();
              if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: 'MAP_TAP_LOCATION',
                  lat: center.lat,
                  lon: center.lng
                }));
              }
            }
          } catch(e) {}
        });
      </script>
    </body>
    </html>
  `;
}

export default function NavigationScreen() {
  const envInfo = detectEnvironmentInfo();

  // Overall Navigation Status State
  const [navStatus, setNavStatus] = useState<NavStatus>("Ready");

  // Backend Health & Connection State
  const [backendStatus, setBackendStatus] = useState<
    "checking" | "online" | "offline"
  >("checking");
  const [backendError, setBackendError] = useState<string | null>(null);

  // Location Source & Mode State (Default = Real Device GPS)
  const [locationMode, setLocationMode] = useState<LocationMode>("gps");
  const [permissionStatus, setPermissionStatus] = useState<
    "checking" | "granted" | "denied" | "unavailable"
  >("checking");

  const [currentLocation, setCurrentLocation] =
    useState<LocationCoords | null>(null);
  const [currentPlaceName, setCurrentPlaceName] = useState<string>(
    "Acquiring macOS device location..."
  );
  const [locationError, setLocationError] = useState<string | null>(null);

  // Manual Test Location Override States
  const [manualLocation, setManualLocation] = useState<LocationCoords | null>(
    null
  );
  const [manualPlaceName, setManualPlaceName] = useState<string>(
    "No manual test location set"
  );
  const [manualSearchInput, setManualSearchInput] = useState("");
  const [manualSearchResults, setManualSearchResults] = useState<
    PlaceSearchResult[]
  >([]);
  const [isSearchingManual, setIsSearchingManual] = useState(false);

  // Pending Selection for Confirmation Card
  const [pendingManualSelection, setPendingManualSelection] =
    useState<PendingLocationSelection | null>(null);

  // Map View State
  const [isFullScreenMap, setIsFullScreenMap] = useState<boolean>(false);

  // Destination & Autocomplete States
  const [destinationInput, setDestinationInput] = useState("");
  const [destinationSearchResults, setDestinationSearchResults] = useState<
    PlaceSearchResult[]
  >([]);
  const [isSearchingDest, setIsSearchingDest] = useState(false);
  const [selectedDestination, setSelectedDestination] = useState<
    string | null
  >(null);
  const [selectedDestCoords, setSelectedDestCoords] =
    useState<LocationCoords | null>(null);

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

  // Speech Input State
  const [isListening, setIsListening] = useState(false);

  // Voice Guidance State
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const lastSpokenInstructionRef = useRef<string>("");
  const hasAnnouncedMountRef = useRef<boolean>(false);

  // Announcement Milestones & Re-routing Refs
  const announcedMilestonesRef = useRef<Set<string>>(new Set());
  const isReroutingRef = useRef<boolean>(false);
  const lastRerouteTimestampRef = useRef<number>(0);

  // WebView, Subscription & State Sync Refs
  const webViewRef = useRef<WebView | null>(null);
  const locationSubscriptionRef =
    useRef<Location.LocationSubscription | null>(null);
  const webWatchIdRef = useRef<number | null>(null);
  const locationModeRef = useRef<LocationMode>("gps");
  const isNavigatingRef = useRef<boolean>(false);
  const routeRef = useRef<RouteData | null>(null);

  useEffect(() => {
    locationModeRef.current = locationMode;
  }, [locationMode]);

  useEffect(() => {
    isNavigatingRef.current = isNavigating;
  }, [isNavigating]);

  useEffect(() => {
    routeRef.current = route;
  }, [route]);

  // Effective Location & Place Name for Display and Calculations
  const effectiveLocation =
    locationMode === "manual" ? manualLocation : currentLocation;
  const effectivePlaceName =
    locationMode === "manual"
      ? manualPlaceName || "Test Location Selected"
      : currentPlaceName;

  // Check FastAPI Backend Connectivity via /health
  const checkBackendHealth = async (): Promise<boolean> => {
    try {
      console.log(`[NAV BACKEND] Checking health endpoint at ${API_BASE_URL}/health`);
      setBackendStatus("checking");
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const resp = await fetch(`${API_BASE_URL}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (resp.ok) {
        const data = await resp.json();
        if (data.status === "ok" || data.status === "healthy") {
          setBackendStatus("online");
          setBackendError(null);
          return true;
        }
      }
    } catch (e: any) {
      console.warn(
        `[NAV BACKEND] Health check failed for ${API_BASE_URL}/health:`,
        e
      );
    }

    setBackendStatus("offline");
    setBackendError(
      `VisionAI cannot connect to the navigation server at ${API_BASE_URL}. Check that the backend is running and that your phone and Mac are connected to the same network.`
    );
    return false;
  };

  // ==================================================
  // Initial Setup & Permission
  // ==================================================
  useEffect(() => {
    checkLocationPermission();
    checkBackendHealth();

    if (!hasAnnouncedMountRef.current) {
      hasAnnouncedMountRef.current = true;
      speakText("Nav is ready. Enter or speak your destination.", true);
    }

    return () => {
      stopNavigation();
    };
  }, []);

  // Continuous Location Watcher Hook for Operating System Location Services
  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;

    const startWatcher = async () => {
      if (locationMode !== "gps") {
        stopNavigationWatcherOnly();
        return;
      }

      // Check if Location Services are enabled on device / OS
      try {
        const servicesEnabled = await Location.hasServicesEnabledAsync();
        if (!servicesEnabled) {
          setPermissionStatus("unavailable");
          setNavStatus("Location Unavailable");
          setCurrentPlaceName("📍 Location unavailable");
          setLocationError(
            "macOS / OS location services are disabled on your device. Please enable Location Services in System Settings → Privacy & Security → Location Services."
          );
          speakText(
            "Your current location is unavailable. Please enable location services.",
            true
          );
          return;
        }
      } catch (e) {
        console.warn("[LOCATION] Services check warning:", e);
      }

      // Check Foreground Location Permissions
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== "granted") {
          setPermissionStatus("denied");
          setNavStatus("Permission Denied");
          setCurrentPlaceName("📍 Location unavailable");
          setLocationError(
            "Location permission is required for live navigation."
          );
          return;
        }
      } catch (e) {
        console.warn("[LOCATION] Permission check warning:", e);
      }

      // 1. Expo Native Watcher (iOS / Android / macOS native)
      try {
        sub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.BestForNavigation,
            timeInterval: 1000,
            distanceInterval: 1,
          },
          async (location) => {
            if (locationModeRef.current !== "gps") return;

            const userCoords = {
              latitude: location.coords.latitude,
              longitude: location.coords.longitude,
            };

            setCurrentLocation(userCoords);
            setPermissionStatus("granted");

            // Reverse-geocode latest macOS / OS position to human-readable landmark
            const geo = await reverseGeocodePosition(userCoords);
            setCurrentPlaceName(`📍 ${geo.full}`);

            // Notify WebView map with live blue marker
            if (webViewRef.current) {
              webViewRef.current.postMessage(
                JSON.stringify({
                  type: "UPDATE_LOCATION",
                  lat: userCoords.latitude,
                  lon: userCoords.longitude,
                  isManual: false,
                  isNavigating: isNavigatingRef.current,
                })
              );
            }

            // Process turn-by-turn guidance progress if active route exists
            if (routeRef.current && isNavigatingRef.current) {
              processNavigationProgress(userCoords, routeRef.current);
            }
          }
        );
        locationSubscriptionRef.current = sub;
      } catch (e) {
        console.warn(
          "[LOCATION WATCHER] Native watcher warning (falling back to web watcher if available):",
          e
        );
      }

      // 2. Web Geolocation Watcher Fallback for Browser on macOS
      if (
        Platform.OS === "web" &&
        typeof navigator !== "undefined" &&
        navigator.geolocation
      ) {
        try {
          const watchId = navigator.geolocation.watchPosition(
            async (pos) => {
              if (locationModeRef.current !== "gps") return;

              const userCoords = {
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
              };

              setCurrentLocation(userCoords);
              setPermissionStatus("granted");

              const geo = await reverseGeocodePosition(userCoords);
              setCurrentPlaceName(`📍 ${geo.full}`);

              if (webViewRef.current) {
                webViewRef.current.postMessage(
                  JSON.stringify({
                    type: "UPDATE_LOCATION",
                    lat: userCoords.latitude,
                    lon: userCoords.longitude,
                    isManual: false,
                    isNavigating: isNavigatingRef.current,
                  })
                );
              }

              if (routeRef.current && isNavigatingRef.current) {
                processNavigationProgress(userCoords, routeRef.current);
              }
            },
            (err) => {
              console.warn("[WEB GEOLOCATION WATCH ERROR]", err);
              if (err.code === err.PERMISSION_DENIED) {
                setPermissionStatus("denied");
                setNavStatus("Permission Denied");
                setCurrentPlaceName("📍 Location unavailable");
                setLocationError(
                  "Location permission is required for live navigation."
                );
              } else {
                setPermissionStatus("unavailable");
                setNavStatus("Location Unavailable");
                setCurrentPlaceName("📍 Location unavailable");
                setLocationError(
                  "Your current location is unavailable. Please enable location services."
                );
              }
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
          );
          webWatchIdRef.current = watchId;
        } catch (webErr) {
          console.warn("[WEB GEOLOCATION WATCH INIT ERROR]", webErr);
        }
      }
    };

    startWatcher();

    return () => {
      stopNavigationWatcherOnly();
    };
  }, [locationMode]);

  const checkLocationPermission = async () => {
    try {
      setPermissionStatus("checking");
      setLocationError(null);

      // 1. Check OS Location Services status
      try {
        const servicesEnabled = await Location.hasServicesEnabledAsync();
        if (!servicesEnabled) {
          setPermissionStatus("unavailable");
          setNavStatus("Location Unavailable");
          setCurrentPlaceName("📍 Location unavailable");
          setLocationError(
            "macOS / OS location services are turned off. Enable Location Services in System Settings."
          );
          speakText(
            "Your current location is unavailable. Please enable location services.",
            true
          );
          return;
        }
      } catch (e) {
        console.warn("[LOCATION] Services check warning:", e);
      }

      // 2. Request Foreground Location Permission
      const { status } = await Location.requestForegroundPermissionsAsync();

      // Trigger browser location permission prompt on Web platform if available
      if (
        Platform.OS === "web" &&
        typeof navigator !== "undefined" &&
        navigator.geolocation
      ) {
        navigator.geolocation.getCurrentPosition(
          () => {},
          () => {},
          { enableHighAccuracy: true }
        );
      }

      if (status !== "granted") {
        setPermissionStatus("denied");
        setNavStatus("Permission Denied");
        setCurrentPlaceName("📍 Location unavailable");
        setLocationError(
          "Location permission is required for live navigation."
        );
        speakText(
          "Location permission is required for live navigation. Please grant location access.",
          true
        );
        return;
      }

      setPermissionStatus("granted");
      await fetchCurrentLocation();
    } catch (err: any) {
      console.error("[LOCATION] Permission error:", err);
      setPermissionStatus("unavailable");
      setNavStatus("Location Unavailable");
      setCurrentPlaceName("📍 Location unavailable");
      setLocationError(
        "Could not access macOS / OS location services. Please check system settings."
      );
      speakText(
        "Your current location is unavailable. Please enable location services.",
        true
      );
    }
  };

  const reverseGeocodePosition = async (
    coords: LocationCoords
  ): Promise<{ primary: string; secondary: string; full: string }> => {
    // 1. Native Expo Reverse Geocode
    try {
      const addresses = await Location.reverseGeocodeAsync(coords);
      if (addresses && addresses.length > 0) {
        const addr = addresses[0];
        const primary =
          addr.name ||
          addr.street ||
          addr.district ||
          addr.subregion ||
          "Device Location";
        const secondary = addr.city || addr.subregion || addr.region || "";
        const full = secondary ? `${primary}, ${secondary}` : primary;
        return { primary, secondary, full };
      }
    } catch (e) {}

    // 2. Direct Nominatim Reverse Geocode Fallback
    try {
      const revUrl = `https://nominatim.openstreetmap.org/reverse?lat=${coords.latitude}&lon=${coords.longitude}&format=json&addressdetails=1`;
      const resp = await fetch(revUrl, {
        headers: { "User-Agent": "VisionAI/1.0" },
      });
      if (resp.ok) {
        const data = await resp.json();
        const addr = data.address || {};
        const primary =
          addr.amenity ||
          addr.building ||
          addr.road ||
          addr.suburb ||
          addr.neighbourhood ||
          addr.village ||
          addr.town ||
          "Device Location";
        const secondary = addr.city || addr.county || addr.state || "";
        const full = secondary ? `${primary}, ${secondary}` : primary;
        return { primary, secondary, full };
      }
    } catch (e) {
      console.warn("[REVERSE GEOCODE] Nominatim fetch error:", e);
    }

    return {
      primary: "Device Location",
      secondary: "",
      full: "Device Location",
    };
  };

  const fetchCurrentLocation = async () => {
    if (locationMode === "manual") {
      return manualLocation;
    }

    // 1. Try Native Expo Location API
    try {
      setLocationError(null);
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.BestForNavigation,
      });
      const coords = {
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      };
      setCurrentLocation(coords);

      const geo = await reverseGeocodePosition(coords);
      setCurrentPlaceName(`📍 ${geo.full}`);

      if (locationMode === "gps" && webViewRef.current) {
        webViewRef.current.postMessage(
          JSON.stringify({
            type: "UPDATE_LOCATION",
            lat: coords.latitude,
            lon: coords.longitude,
            isManual: false,
            isNavigating,
          })
        );
      }
      return coords;
    } catch (err: any) {
      console.warn(
        "[GPS] Native location fetch warning, attempting Web Geolocation API fallback:",
        err
      );
    }

    // 2. Try HTML5 Browser Geolocation API for macOS Browser
    if (
      Platform.OS === "web" &&
      typeof navigator !== "undefined" &&
      navigator.geolocation
    ) {
      return new Promise<LocationCoords | null>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            const coords = {
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
            };
            setCurrentLocation(coords);
            setPermissionStatus("granted");

            const geo = await reverseGeocodePosition(coords);
            setCurrentPlaceName(`📍 ${geo.full}`);

            if (locationMode === "gps" && webViewRef.current) {
              webViewRef.current.postMessage(
                JSON.stringify({
                  type: "UPDATE_LOCATION",
                  lat: coords.latitude,
                  lon: coords.longitude,
                  isManual: false,
                  isNavigating,
                })
              );
            }
            resolve(coords);
          },
          (err) => {
            console.warn("[WEB GEOLOCATION ERROR]", err);
            setPermissionStatus("unavailable");
            setNavStatus("Location Unavailable");
            setCurrentPlaceName("📍 Location unavailable");
            setLocationError(
              "Your current location is unavailable. Please enable location services."
            );
            resolve(null);
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
      });
    }

    setPermissionStatus("unavailable");
    setNavStatus("Location Unavailable");
    setCurrentPlaceName("📍 Location unavailable");
    setLocationError(
      "Your current location is unavailable. Please enable location services."
    );
    return null;
  };

  // Map Control Actions
  const handleZoomIn = () =>
    webViewRef.current?.postMessage(JSON.stringify({ type: "ZOOM_IN" }));
  const handleZoomOut = () =>
    webViewRef.current?.postMessage(JSON.stringify({ type: "ZOOM_OUT" }));
  const handleRecenter = () => {
    webViewRef.current?.postMessage(JSON.stringify({ type: "RECENTER" }));
    if (locationMode === "gps" && currentLocation) {
      webViewRef.current?.postMessage(
        JSON.stringify({
          type: "UPDATE_LOCATION",
          lat: currentLocation.latitude,
          lon: currentLocation.longitude,
          isManual: false,
          isNavigating,
        })
      );
    }
  };

  // Request Map Center as Pending Manual Location
  const handleSetLocationToMapCenter = () => {
    webViewRef.current?.postMessage(
      JSON.stringify({ type: "GET_CENTER_LOCATION" })
    );
  };

  // Reset to Live GPS
  const handleResetToLiveGps = async () => {
    setLocationMode("gps");
    setManualLocation(null);
    setManualSearchInput("");
    setManualSearchResults([]);
    setPendingManualSelection(null);

    speakText("Resetting to live GPS location.", true);
    const liveCoords = await fetchCurrentLocation();

    if (webViewRef.current && liveCoords) {
      webViewRef.current.postMessage(
        JSON.stringify({
          type: "UPDATE_LOCATION",
          lat: liveCoords.latitude,
          lon: liveCoords.longitude,
          isManual: false,
          isNavigating,
        })
      );
    }

    if (isNavigating && (selectedDestination || route?.destination_name)) {
      handleStartRouteCalculation(
        selectedDestination || route?.destination_name,
        liveCoords || undefined
      );
    }
  };

  // Select Candidate in Recommended Manual Places List -> Sets Pending Selection
  const handleSelectPendingManualPlace = (place: PlaceSearchResult) => {
    setPendingManualSelection({
      coords: { latitude: place.latitude, longitude: place.longitude },
      title: place.title || place.display_name.split(",")[0],
      subtext:
        place.subtext || place.display_name.split(",").slice(1, 3).join(", "),
      display_name: place.display_name,
    });
    setManualSearchResults([]);
    speakText(
      `Selected ${place.title}. Tap Use This Location to confirm.`,
      true
    );
  };

  // Confirm "Use This Location" -> Applies Manual Simulated Current Location
  const handleConfirmManualLocation = () => {
    if (!pendingManualSelection) return;

    const { coords, title, subtext } = pendingManualSelection;
    const fullPlaceStr = subtext ? `${title}, ${subtext}` : title;

    setManualLocation(coords);
    setManualPlaceName(fullPlaceStr);
    setLocationMode("manual");
    setManualSearchInput(fullPlaceStr);
    setPendingManualSelection(null);

    // Stop real device GPS watcher so it NEVER overwrites manual location
    stopNavigationWatcherOnly();

    speakText(`Current location set manually to ${title}.`, true);

    if (webViewRef.current) {
      webViewRef.current.postMessage(
        JSON.stringify({
          type: "UPDATE_LOCATION",
          lat: coords.latitude,
          lon: coords.longitude,
          isManual: true,
          isNavigating,
        })
      );
    }

    if (selectedDestination || route?.destination_name) {
      handleStartRouteCalculation(
        selectedDestination || route?.destination_name,
        coords
      );
    }
  };

  // Handle Manual Place Search Input
  const handleManualSearchTextChange = async (text: string) => {
    setManualSearchInput(text);
    if (text.trim().length >= 2) {
      setIsSearchingManual(true);
      const results = await fetchPlaceSearchCandidates(text);
      setManualSearchResults(results);
      setIsSearchingManual(false);
    } else {
      setManualSearchResults([]);
    }
  };

  // Handle Destination Search Autocomplete Input
  const handleDestinationTextChange = async (text: string) => {
    setDestinationInput(text);
    setSelectedDestination(text);
    setSelectedDestCoords(null);

    if (text.trim().length >= 2) {
      setIsSearchingDest(true);
      const results = await fetchPlaceSearchCandidates(text);
      setDestinationSearchResults(results);
      setIsSearchingDest(false);
    } else {
      setDestinationSearchResults([]);
    }
  };

  // Select Destination from Autocomplete Dropdown
  const handleSelectDestinationPlace = (place: PlaceSearchResult) => {
    const name = place.title || place.display_name.split(",")[0];
    setDestinationInput(name);
    setSelectedDestination(name);
    setSelectedDestCoords({
      latitude: place.latitude,
      longitude: place.longitude,
    });
    setDestinationSearchResults([]);
    speakText(`Destination set to ${name}.`, true);
  };

  // Handle WebView Messages (Map Tap / Center Pin Location Selection)
  const handleWebViewMessage = async (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === "MAP_TAP_LOCATION") {
        const coords = { latitude: data.lat, longitude: data.lon };
        const geo = await reverseGeocodePosition(coords);
        setPendingManualSelection({
          coords,
          title: geo.primary,
          subtext: geo.secondary,
          display_name: geo.full,
        });
        speakText(
          "Location point selected from map. Tap Use This Location to confirm.",
          true
        );
      }
    } catch (e) {}
  };

  // Speech Helper
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

  // Voice Input Handler
  const handleSpeakDestination = () => {
    if (isNavigating || isCalculatingRoute) return;

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
            handleDestinationTextChange(transcript);
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
            "Could not recognize destination. Please type your destination.",
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
  // Route Calculation Engine
  // ==================================================
  const handleStartRouteCalculation = async (
    targetDest?: string,
    overrideOrigin?: LocationCoords
  ) => {
    const destToSearch = (targetDest || destinationInput).trim();
    if (!destToSearch) {
      speakText("Please enter or select a destination.", true);
      Alert.alert(
        "Destination Required",
        "Please enter or select a destination."
      );
      return;
    }

    // 1. Verify backend health before making route request
    const isHealthy = await checkBackendHealth();
    if (!isHealthy) {
      setNavStatus("Ready");
      setIsCalculatingRoute(false);
      setIsGeocoding(false);
      Alert.alert(
        "Backend Connection Error",
        "VisionAI cannot connect to the navigation server. Check that the backend is running and that your phone and Mac are on the same network."
      );
      setCurrentInstructionText(
        "Backend Connection Error: Check navigation server & Wi-Fi network."
      );
      speakText(
        "VisionAI backend is unavailable. Make sure the backend is running and your phone and Mac are connected to the same network.",
        true
      );
      return;
    }

    let origin = overrideOrigin;
    if (!origin) {
      if (locationMode === "manual") {
        origin = manualLocation || undefined;
      } else {
        origin = currentLocation || undefined;
      }
    }

    if (!origin && locationMode === "manual") {
      Alert.alert(
        "Manual Location Required",
        "Please search and confirm a manual test location first."
      );
      speakText("Please set and confirm a test location first.", true);
      return;
    }

    if (!origin) {
      origin = (await fetchCurrentLocation()) || undefined;
    }

    if (!origin) {
      Alert.alert(
        "Location Error",
        "Your current GPS location is unavailable. Please enable location services."
      );
      speakText(
        "Your current location is unavailable. Please enable location services.",
        true
      );
      return;
    }

    setNavStatus("Finding Route");
    setIsCalculatingRoute(true);
    setIsGeocoding(true);

    try {
      console.log(
        `[NAV] Requesting walking route to "${destToSearch}" from origin:`,
        origin,
        `target URL: ${API_BASE_URL}/navigation/route`
      );

      const reqBody: any = {
        origin: origin,
        destination_name: destToSearch,
      };
      if (selectedDestCoords) {
        reqBody.destination_coords = selectedDestCoords;
      }

      const response = await fetch(`${API_BASE_URL}/navigation/route`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody),
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(
          errJson.detail || `Backend returned HTTP status ${response.status}`
        );
      }

      const routeData: RouteData = await response.json();
      if (!routeData.success || !routeData.instructions.length) {
        throw new Error(
          "No valid route instructions found for this destination."
        );
      }

      setRoute(routeData);
      setSelectedDestination(routeData.destination_name);
      setCurrentStepIndex(0);
      setRemainingDistance(routeData.total_distance_meters);
      setNavStatus("Navigating");
      const isInitialStart = !isReroutingRef.current;
      isReroutingRef.current = false;
      announcedMilestonesRef.current.clear();

      const firstInstruction = routeData.instructions[0].instruction;
      setCurrentInstructionText(firstInstruction);

      // Update WebView Map with Route & Pin style
      const destStep =
        routeData.instructions[routeData.instructions.length - 1];
      if (webViewRef.current) {
        webViewRef.current.postMessage(
          JSON.stringify({
            type: "UPDATE_ROUTE",
            uLat: origin.latitude,
            uLon: origin.longitude,
            geom: routeData.route_geometry,
            dLat: destStep.latitude,
            dLon: destStep.longitude,
            dName: routeData.destination_name,
            isManual: locationMode === "manual",
          })
        );
      }

      // Start continuous navigation tracking
      startNavigationTracking(routeData);

      const originDesc =
        locationMode === "manual" ? `from ${effectivePlaceName}` : "";
      const startSpeechMsg = isInitialStart
        ? `Navigation started ${originDesc} to ${routeData.destination_name}. ${firstInstruction}`
        : `Route updated. ${firstInstruction}`;
      speakText(startSpeechMsg, true);
    } catch (err: any) {
      console.error("[NAV] Route calculation error:", err);
      setNavStatus("Ready");
      isReroutingRef.current = false;

      const isConnectionErr =
        err.message?.includes("fetch failed") ||
        err.message?.includes("ConnectException") ||
        err.message?.includes("Network request failed") ||
        err.message?.includes("Failed to fetch") ||
        err.message?.includes("Aborted");

      const userMsg = isConnectionErr
        ? "VisionAI cannot connect to the navigation server. Check that the backend is running and that your phone and Mac are on the same network."
        : err.message || "Failed to calculate navigation route.";

      setBackendStatus(isConnectionErr ? "offline" : "online");
      Alert.alert("Backend Connection Error", userMsg);
      setCurrentInstructionText(`Route Error: ${userMsg}`);
      speakText(
        "Navigation server unavailable. Please check backend connection.",
        true
      );
    } finally {
      setIsCalculatingRoute(false);
      setIsGeocoding(false);
    }
  };

  // ==================================================
  // Continuous Location Tracking & Turn-by-Turn Logic
  // ==================================================
  const startNavigationTracking = async (activeRoute: RouteData) => {
    setIsNavigating(true);

    if (locationMode === "manual") {
      stopNavigationWatcherOnly();
      if (manualLocation) {
        processNavigationProgress(manualLocation, activeRoute);
      }
      return;
    }
  };

  const processNavigationProgress = (
    userPos: LocationCoords,
    activeRoute: RouteData
  ) => {
    if (!activeRoute || !activeRoute.instructions.length) return;

    const instructions = activeRoute.instructions;
    const destStep = instructions[instructions.length - 1];

    // 1. Distance remaining to final destination
    const distToDest = calculateDistanceMeters(
      userPos.latitude,
      userPos.longitude,
      destStep.latitude,
      destStep.longitude
    );
    setRemainingDistance(distToDest);

    // 2. Arrival Detection (< 15 meters)
    if (distToDest < 15) {
      const arrivedText = `You have arrived at ${activeRoute.destination_name}.`;
      setCurrentInstructionText(arrivedText);
      setNavStatus("Arrived");
      speakText(arrivedText, true);
      stopNavigationWatcherOnly();
      setIsNavigating(false);
      return;
    }

    // 3. Off-Route Detection & Automatic Re-routing (> 40m off route segment)
    let stepIdx = currentStepIndex;
    const activeStep = instructions[stepIdx];
    const prevStep =
      stepIdx > 0
        ? instructions[stepIdx - 1]
        : { latitude: userPos.latitude, longitude: userPos.longitude };

    const offRouteDist = distanceToSegmentMeters(
      userPos.latitude,
      userPos.longitude,
      prevStep.latitude,
      prevStep.longitude,
      activeStep.latitude,
      activeStep.longitude
    );

    const now = Date.now();
    if (
      offRouteDist > 40 &&
      !isReroutingRef.current &&
      now - lastRerouteTimestampRef.current > 6000
    ) {
      console.warn(
        `[NAV] Off-route detected (${Math.round(
          offRouteDist
        )}m off route). Recalculating...`
      );
      isReroutingRef.current = true;
      lastRerouteTimestampRef.current = now;
      speakText("You are off route. Recalculating.", true);
      setCurrentInstructionText("Recalculating route...");
      handleStartRouteCalculation(
        selectedDestination || activeRoute.destination_name,
        userPos
      );
      return;
    }

    // 4. Distance to Next Maneuver & Milestone Announcements
    const distToManeuver = calculateDistanceMeters(
      userPos.latitude,
      userPos.longitude,
      activeStep.latitude,
      activeStep.longitude
    );

    let maneuverTypeLabel = "Turn right";
    if (activeStep.type === "left") maneuverTypeLabel = "Turn left";
    else if (activeStep.type === "uturn") maneuverTypeLabel = "Make a U-turn";
    else if (activeStep.type === "straight")
      maneuverTypeLabel = "Continue straight";

    const milestoneSet = announcedMilestonesRef.current;
    let spokenAnnouncement: string | null = null;
    let displayInstructionText = activeStep.instruction;

    const roundedDist = Math.round(distToManeuver);

    if (distToManeuver <= 15) {
      const keyNow = `now_${stepIdx}`;
      if (!milestoneSet.has(keyNow)) {
        milestoneSet.add(keyNow);
        spokenAnnouncement = `${maneuverTypeLabel} now.`;
        displayInstructionText = `${maneuverTypeLabel} now.`;

        if (stepIdx < instructions.length - 1) {
          const nextIdx = stepIdx + 1;
          setCurrentStepIndex(nextIdx);
          const nextStep = instructions[nextIdx];
          const distToNext = calculateDistanceMeters(
            userPos.latitude,
            userPos.longitude,
            nextStep.latitude,
            nextStep.longitude
          );
          spokenAnnouncement += ` Continue straight for ${Math.round(
            distToNext
          )} meters.`;
        }
      }
    } else if (roundedDist >= 40 && roundedDist <= 60) {
      const key50 = `50m_${stepIdx}`;
      if (!milestoneSet.has(key50)) {
        milestoneSet.add(key50);
        spokenAnnouncement = `${maneuverTypeLabel} in 50 meters.`;
        displayInstructionText = `${maneuverTypeLabel} in 50 meters.`;
      }
    } else if (roundedDist >= 90 && roundedDist <= 115) {
      const key100 = `100m_${stepIdx}`;
      if (!milestoneSet.has(key100)) {
        milestoneSet.add(key100);
        spokenAnnouncement = `${maneuverTypeLabel} in 100 meters.`;
        displayInstructionText = `${maneuverTypeLabel} in 100 meters.`;
      }
    } else if (roundedDist >= 180 && roundedDist <= 220) {
      const key200 = `200m_${stepIdx}`;
      if (!milestoneSet.has(key200)) {
        milestoneSet.add(key200);
        spokenAnnouncement = `${maneuverTypeLabel} in 200 meters.`;
        displayInstructionText = `${maneuverTypeLabel} in 200 meters.`;
      }
    } else {
      if (
        activeStep.type === "left" ||
        activeStep.type === "right" ||
        activeStep.type === "uturn"
      ) {
        displayInstructionText = `In ${roundedDist} meters, ${activeStep.instruction.toLowerCase()}.`;
      } else {
        displayInstructionText = `Continue straight for ${roundedDist} meters towards ${activeRoute.destination_name}.`;
      }
    }

    setCurrentInstructionText(displayInstructionText);
    if (spokenAnnouncement) {
      speakText(spokenAnnouncement);
    }

    // Push context to AI backend
    fetch(`${API_BASE_URL}/navigation/context`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        current_location: userPos,
        destination_name: activeRoute.destination_name,
        current_instruction: displayInstructionText,
        distance_to_turn_meters: distToManeuver,
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
    if (
      webWatchIdRef.current !== null &&
      typeof navigator !== "undefined" &&
      navigator.geolocation
    ) {
      navigator.geolocation.clearWatch(webWatchIdRef.current);
      webWatchIdRef.current = null;
    }
  };

  const stopNavigation = () => {
    stopNavigationWatcherOnly();
    setIsNavigating(false);
    setNavStatus("Stopped");
    setRoute(null);
    setRemainingDistance(null);
    setCurrentInstructionText(
      "Navigation stopped. Enter or speak a destination to start."
    );
    lastSpokenInstructionRef.current = "";
    announcedMilestonesRef.current.clear();
    Speech.stop();
    speakText("Navigation stopped.", true);
  };

  // Distance Display Formatter (<1000m -> meters, >=1000m -> km, unstarted -> "—")
  const formatDistanceDisplay = (meters: number | null) => {
    if (meters === null || !isNavigating) return "—";
    if (meters >= 1000) {
      return `${(meters / 1000).toFixed(1)} km`;
    }
    return `${Math.round(meters)} m`;
  };

  const mapHtml = generateMapHtml(
    effectiveLocation,
    route,
    locationMode === "manual"
  );

  // ==================================================
  // UI Render
  // ==================================================
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      keyboardShouldPersistTaps="handled"
    >
      {/* HEADER */}
      <View style={styles.headerBox} accessibilityRole="header">
        <Text style={styles.titleText}>Nav</Text>
        <Text style={styles.subtitleText}>
          Hands-Free Voice GPS Assistant for Visually Impaired Users
        </Text>
      </View>

      {/* DETECTED ENVIRONMENT CARD */}
      <View style={styles.environmentBannerCard}>
        <View style={styles.environmentHeaderRow}>
          <Text style={styles.environmentTitleText}>
            {envInfo.type === "macOS" ? "💻" : envInfo.isSimulator ? "🧪" : "📱"}{" "}
            {envInfo.name}
          </Text>
          <View
            style={[
              styles.envStatusBadge,
              permissionStatus === "granted"
                ? styles.envStatusBadgeGranted
                : permissionStatus === "denied"
                ? styles.envStatusBadgeDenied
                : styles.envStatusBadgeWarn,
            ]}
          >
            <Text style={styles.envStatusBadgeText}>
              {permissionStatus === "granted"
                ? "OS Location Active"
                : permissionStatus === "denied"
                ? "Permission Denied"
                : "Checking Location"}
            </Text>
          </View>
        </View>
        <Text style={styles.environmentDescText}>{envInfo.description}</Text>
      </View>

      {/* BACKEND CONNECTION ERROR CARD */}
      {backendStatus === "offline" && (
        <View style={styles.backendErrorCard}>
          <Text style={styles.backendErrorTitle}>
            🔌 Backend Connection Error
          </Text>
          <Text style={styles.backendErrorMsg}>
            VisionAI cannot connect to the navigation server at{" "}
            <Text style={{ fontWeight: "800", color: "#991b1b" }}>
              {API_BASE_URL}
            </Text>
            . Check that the backend is running and that your phone and Mac are
            connected to the same network.
          </Text>
          <View style={styles.backendHelpBox}>
            <Text style={styles.backendHelpTitle}>💡 Quick Troubleshooting:</Text>
            <Text style={styles.backendHelpStep}>
              1. Run on your Mac:{"\n"}
              <Text
                style={{
                  fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
                  fontSize: 12,
                  fontWeight: "700",
                  color: "#1e1b4b",
                }}
              >
                python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
              </Text>
            </Text>
            <Text style={styles.backendHelpStep}>
              2. Ensure Mac and phone are on the same Wi-Fi network.
            </Text>
            <Text style={styles.backendHelpStep}>
              3. Target Server URL:{" "}
              <Text style={{ fontWeight: "800", color: "#1e1b4b" }}>
                {API_BASE_URL}
              </Text>
            </Text>
          </View>
          <Pressable
            style={styles.retryBackendButton}
            onPress={checkBackendHealth}
            accessibilityLabel="Retry Backend Connection"
            accessibilityRole="button"
          >
            <Text style={styles.retryBackendButtonText}>
              🔄 Retry Backend Connection
            </Text>
          </Pressable>
        </View>
      )}

      {/* LOCATION PERMISSION REQUIRED / DENIED WARNING CARD */}
      {(permissionStatus === "denied" || permissionStatus === "unavailable") && (
        <View style={styles.permissionDeniedCard}>
          <Text style={styles.permissionDeniedTitle}>
            🔒 Location Permission Required for Live Navigation
          </Text>
          <Text style={styles.permissionDeniedMsg}>
            {locationError ||
              "Location permission is required for live navigation."}
          </Text>

          {envInfo.isMac && (
            <View style={styles.macOsSettingsGuideBox}>
              <Text style={styles.macOsSettingsGuideTitle}>
                ⚙️ How to Enable macOS Location Services:
              </Text>
              <Text style={styles.macOsStepText}>
                1. Open{" "}
                <Text style={{ fontWeight: "800", color: "#111827" }}>
                  System Settings
                </Text>{" "}
                on your Mac.
              </Text>
              <Text style={styles.macOsStepText}>
                2. Go to{" "}
                <Text style={{ fontWeight: "800", color: "#111827" }}>
                  Privacy & Security
                </Text>{" "}
                →{" "}
                <Text style={{ fontWeight: "800", color: "#111827" }}>
                  Location Services
                </Text>
                .
              </Text>
              <Text style={styles.macOsStepText}>
                3. Ensure{" "}
                <Text style={{ fontWeight: "800", color: "#111827" }}>
                  Location Services
                </Text>{" "}
                is toggled ON.
              </Text>
              <Text style={styles.macOsStepText}>
                4. Enable location access for{" "}
                <Text style={{ fontWeight: "800", color: "#111827" }}>
                  VisionAI / Web Browser / Terminal
                </Text>
                .
              </Text>
            </View>
          )}

          <Pressable
            style={styles.retryPermissionButton}
            onPress={checkLocationPermission}
            accessibilityLabel="Request Location Permission Again"
            accessibilityRole="button"
          >
            <Text style={styles.retryPermissionButtonText}>
              🔄 Request Location Access
            </Text>
          </Pressable>
        </View>
      )}

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
        accessibilityLabel={`Navigation Status: ${
          isNavigating ? navStatus : "Stopped"
        }`}
      >
        <Text style={styles.statusBadgeLabelText}>
          Navigation Status:{" "}
          <Text style={styles.statusBadgeValueText}>
            {isNavigating ? navStatus : "Stopped"}
          </Text>
        </Text>
      </View>

      {/* PROMINENT INTERACTIVE ROUTE MAP CARD */}
      <View
        style={[styles.card, isFullScreenMap && styles.fullScreenCardOverlay]}
      >
        <View
          style={[
            styles.mapHeaderRow,
            isFullScreenMap && styles.fullScreenMapHeaderRow,
          ]}
        >
          {isFullScreenMap ? (
            <Pressable
              style={styles.exitFullScreenButton}
              onPress={() => setIsFullScreenMap(false)}
              accessibilityLabel="Exit Full Map View"
              accessibilityRole="button"
            >
              <Text style={styles.exitFullScreenButtonText}>
                ← Exit Full Map
              </Text>
            </Pressable>
          ) : (
            <>
              <Text style={styles.cardTitle}>
                🗺️{" "}
                {locationMode === "manual"
                  ? "Test Location Map"
                  : "Live Device GPS Map"}
              </Text>
              <Pressable
                style={styles.fullScreenToggleButton}
                onPress={() => setIsFullScreenMap(true)}
                accessibilityLabel="Expand Full Map View"
                accessibilityRole="button"
              >
                <Text style={styles.fullScreenToggleText}>⛶ Full Map</Text>
              </Pressable>
            </>
          )}
        </View>

        {/* Full Screen Mode Guidance Banner */}
        {isFullScreenMap && (
          <View style={styles.fullScreenGuidanceBanner}>
            <Text style={styles.fullScreenGuidanceText}>
              {currentInstructionText}
            </Text>
            <Text style={styles.fullScreenMetricsText}>
              {formatDistanceDisplay(remainingDistance)} •{" "}
              {isNavigating ? navStatus : "Stopped"}
            </Text>
          </View>
        )}

        <View
          style={[
            styles.mapContainer,
            isFullScreenMap && styles.fullScreenMapContainer,
          ]}
        >
          <WebView
            ref={webViewRef}
            originWhitelist={["*"]}
            source={{ html: mapHtml }}
            style={{ flex: 1 }}
            scrollEnabled={true}
            onMessage={handleWebViewMessage}
          />

          {/* Map Controls Floating Overlay */}
          <View style={styles.mapControlsOverlay}>
            <Pressable
              style={styles.mapControlButton}
              onPress={handleZoomIn}
              accessibilityLabel="Zoom In Map"
              accessibilityRole="button"
            >
              <Text style={styles.mapControlIconText}>＋</Text>
            </Pressable>

            <Pressable
              style={styles.mapControlButton}
              onPress={handleZoomOut}
              accessibilityLabel="Zoom Out Map"
              accessibilityRole="button"
            >
              <Text style={styles.mapControlIconText}>－</Text>
            </Pressable>

            <Pressable
              style={[styles.mapControlButton, styles.recenterButton]}
              onPress={handleRecenter}
              accessibilityLabel="Recenter Map on Current Location"
              accessibilityRole="button"
            >
              <Text style={styles.recenterIconText}>◎</Text>
            </Pressable>
          </View>
        </View>
      </View>

      {/* LOCATION SOURCE CONTROLLER & LIVE ADDRESS DISPLAY */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>📍 Location Source</Text>

        {/* Source Switcher Segmented Buttons */}
        <View style={styles.segmentedContainer}>
          <Pressable
            style={[
              styles.segmentedButton,
              locationMode === "gps" && styles.segmentedButtonActiveGps,
            ]}
            onPress={handleResetToLiveGps}
            accessibilityLabel="Use Live Device GPS"
            accessibilityRole="button"
          >
            <Text
              style={[
                styles.segmentedText,
                locationMode === "gps" && styles.segmentedTextActive,
              ]}
            >
              🟢 Live Device Location
            </Text>
          </Pressable>

          <Pressable
            style={[
              styles.segmentedButton,
              locationMode === "manual" && styles.segmentedButtonActiveManual,
            ]}
            onPress={() => setLocationMode("manual")}
            accessibilityLabel="Set Test Location Manually"
            accessibilityRole="button"
          >
            <Text
              style={[
                styles.segmentedText,
                locationMode === "manual" && styles.segmentedTextActive,
              ]}
            >
              📌 Test Location Mode
            </Text>
          </Pressable>
        </View>

        {/* Active Source Badge & Human-Readable Location Display */}
        <View style={styles.activeSourceRow}>
          <View
            style={[
              styles.sourceBadge,
              locationMode === "manual"
                ? styles.sourceBadgeManual
                : styles.sourceBadgeGps,
            ]}
          >
            <Text style={styles.sourceBadgeText}>
              {locationMode === "manual"
                ? "📌 Test Location (Simulated)"
                : "🟢 Live Device Location Active"}
            </Text>
          </View>

          {locationMode === "manual" && (
            <Pressable
              style={styles.resetGpsSmallButton}
              onPress={handleResetToLiveGps}
              accessibilityLabel="Reset to Live GPS"
              accessibilityRole="button"
            >
              <Text style={styles.resetGpsSmallText}>Use Live GPS</Text>
            </Pressable>
          )}
        </View>

        <Text style={styles.placeNameText}>{effectivePlaceName}</Text>

        {/* MANUAL LOCATION SIMULATOR (DEV/TESTING ONLY) */}
        {locationMode === "manual" && (
          <View style={styles.manualSimulatorBox}>
            <Text style={styles.manualBoxTitle}>
              📌 Developer/Testing Location Simulation:
            </Text>

            <TextInput
              style={styles.textInputLarge}
              placeholder="Search test origin (e.g. SIES GST, Swargate, Railway Station)"
              placeholderTextColor="#9ca3af"
              value={manualSearchInput}
              onChangeText={handleManualSearchTextChange}
              accessibilityLabel="Test Location Search Field"
            />

            {isSearchingManual && (
              <ActivityIndicator
                color="#3b82f6"
                size="small"
                style={{ marginVertical: 8 }}
              />
            )}

            {/* RECOMMENDED LOCATION RESULTS LIST */}
            {manualSearchResults.length > 0 && (
              <View style={styles.searchResultsDropdownLarge}>
                <Text style={styles.recommendationsHeaderTitle}>
                  Recommended Places (Tap to select):
                </Text>
                {manualSearchResults.map((item, idx) => (
                  <Pressable
                    key={idx}
                    style={styles.searchResultRowItem}
                    onPress={() => handleSelectPendingManualPlace(item)}
                    accessibilityLabel={`Select test location ${item.title}`}
                    accessibilityRole="button"
                  >
                    <Text style={styles.searchResultRowTitle}>
                      📍 {item.title}
                    </Text>
                    {!!item.subtext && (
                      <Text style={styles.searchResultRowSubtext}>
                        {item.subtext}
                      </Text>
                    )}
                  </Pressable>
                ))}
              </View>
            )}

            {/* MANUAL LOCATION CONFIRMATION CARD */}
            {pendingManualSelection && (
              <View style={styles.confirmationCardBox}>
                <Text style={styles.confirmationCardHeader}>
                  📍 Selected Test Location
                </Text>
                <Text style={styles.confirmationTitleText}>
                  {pendingManualSelection.title}
                </Text>
                {!!pendingManualSelection.subtext && (
                  <Text style={styles.confirmationSubtext}>
                    {pendingManualSelection.subtext}
                  </Text>
                )}

                <Pressable
                  style={styles.confirmLocationButton}
                  onPress={handleConfirmManualLocation}
                  accessibilityLabel="Use This Location"
                  accessibilityRole="button"
                >
                  <Text style={styles.confirmLocationButtonText}>
                    ✅ Use This Location
                  </Text>
                </Pressable>
              </View>
            )}

            <Pressable
              style={styles.mapPickerButton}
              onPress={handleSetLocationToMapCenter}
              accessibilityLabel="Select Map Center as Location"
              accessibilityRole="button"
            >
              <Text style={styles.mapPickerButtonText}>
                🎯 Select Map Center Location
              </Text>
            </Pressable>
            <Text style={styles.mapPickerHint}>
              Hint: You can also tap anywhere directly on the map to pick a
              point, then tap "Use This Location".
            </Text>
          </View>
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
          Type or select your target destination.
        </Text>

        <TextInput
          style={styles.textInputLarge}
          placeholder="Destination (e.g. Nerul Railway Station, Hospital)"
          placeholderTextColor="#9ca3af"
          value={destinationInput}
          onChangeText={handleDestinationTextChange}
          editable={!isNavigating && !isCalculatingRoute}
          accessibilityLabel="Destination Input Field"
        />

        {isSearchingDest && (
          <ActivityIndicator
            color="#3b82f6"
            size="small"
            style={{ marginVertical: 8 }}
          />
        )}

        {/* Destination Search Autocomplete Dropdown Candidate List */}
        {destinationSearchResults.length > 0 && !isNavigating && (
          <View style={styles.searchResultsDropdownLarge}>
            <Text style={styles.recommendationsHeaderTitle}>
              Matching Destinations (Tap to select):
            </Text>
            {destinationSearchResults.map((item, idx) => (
              <Pressable
                key={idx}
                style={styles.searchResultRowItem}
                onPress={() => handleSelectDestinationPlace(item)}
                accessibilityLabel={`Select destination ${item.title}`}
                accessibilityRole="button"
              >
                <Text style={styles.searchResultRowTitle}>🏁 {item.title}</Text>
                {!!item.subtext && (
                  <Text style={styles.searchResultRowSubtext}>
                    {item.subtext}
                  </Text>
                )}
              </Pressable>
            ))}
          </View>
        )}

        {/* PRESET SUGGESTIONS CHIPS */}
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
                handleDestinationTextChange(preset);
                handleStartRouteCalculation(preset);
              }}
              disabled={isNavigating || isCalculatingRoute}
              accessibilityLabel={`Quick select destination ${preset}`}
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
              isCalculatingRoute && styles.disabledButton,
            ]}
            onPress={() => handleStartRouteCalculation()}
            disabled={isCalculatingRoute}
            accessibilityLabel="Start Navigation"
            accessibilityRole="button"
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
          >
            <Text style={styles.dangerButtonText}>🛑 Stop Navigation</Text>
          </Pressable>
        )}
      </View>

      {/* ACTIVE NAVIGATION GUIDANCE CARD */}
      <View style={styles.instructionDisplayCard}>
        <Text style={styles.instructionHeaderTitle}>
          Current Guidance Instruction
        </Text>

        <View
          style={styles.instructionBox}
          accessibilityRole="text"
          accessibilityLiveRegion="assertive"
          accessibilityLabel={`Current instruction: ${currentInstructionText}`}
        >
          <Text style={styles.instructionText}>{currentInstructionText}</Text>
        </View>

        {/* METRICS ROW */}
        <View style={styles.metricsRow}>
          <View style={styles.metricItem}>
            <Text style={styles.metricLabel}>Distance Remaining</Text>
            <Text style={styles.metricValue}>
              {formatDistanceDisplay(remainingDistance)}
            </Text>
          </View>

          <View style={styles.metricItem}>
            <Text style={styles.metricLabel}>Navigation State</Text>
            <Text style={styles.metricValue}>
              {isNavigating ? navStatus : "Stopped"}
            </Text>
          </View>
        </View>

        {/* VOICE REPEAT / MUTE CONTROLS */}
        <View style={styles.controlsRow}>
          <Pressable
            style={styles.controlButton}
            onPress={() => speakText(currentInstructionText, true)}
            accessibilityLabel="Repeat Voice Guidance"
            accessibilityRole="button"
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
  environmentBannerCard: {
    backgroundColor: "#f0f9ff",
    borderColor: "#bae6fd",
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
  },
  environmentHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  environmentTitleText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#0369a1",
    flex: 1,
  },
  envStatusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  envStatusBadgeGranted: {
    backgroundColor: "#dcfce7",
  },
  envStatusBadgeDenied: {
    backgroundColor: "#fee2e2",
  },
  envStatusBadgeWarn: {
    backgroundColor: "#fef3c7",
  },
  envStatusBadgeText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#1e293b",
  },
  environmentDescText: {
    fontSize: 13,
    color: "#0284c7",
    lineHeight: 18,
  },
  backendErrorCard: {
    backgroundColor: "#fef2f2",
    borderColor: "#f87171",
    borderWidth: 2,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
  },
  backendErrorTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#991b1b",
    marginBottom: 6,
  },
  backendErrorMsg: {
    fontSize: 14,
    color: "#7f1d1d",
    lineHeight: 20,
    marginBottom: 12,
  },
  backendHelpBox: {
    backgroundColor: "#ffffff",
    borderColor: "#fca5a5",
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
  },
  backendHelpTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: "#991b1b",
    marginBottom: 6,
  },
  backendHelpStep: {
    fontSize: 13,
    color: "#374151",
    lineHeight: 18,
    marginBottom: 6,
  },
  retryBackendButton: {
    backgroundColor: "#dc2626",
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 46,
  },
  retryBackendButtonText: {
    color: "#ffffff",
    fontWeight: "800",
    fontSize: 15,
  },
  permissionDeniedCard: {
    backgroundColor: "#fef2f2",
    borderColor: "#fca5a5",
    borderWidth: 2,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
  },
  permissionDeniedTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#991b1b",
    marginBottom: 6,
  },
  permissionDeniedMsg: {
    fontSize: 14,
    color: "#7f1d1d",
    lineHeight: 20,
    marginBottom: 12,
  },
  macOsSettingsGuideBox: {
    backgroundColor: "#ffffff",
    borderColor: "#fecaca",
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
  },
  macOsSettingsGuideTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: "#991b1b",
    marginBottom: 8,
  },
  macOsStepText: {
    fontSize: 13,
    color: "#374151",
    lineHeight: 20,
    marginBottom: 4,
  },
  retryPermissionButton: {
    backgroundColor: "#dc2626",
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 46,
  },
  retryPermissionButtonText: {
    color: "#ffffff",
    fontWeight: "800",
    fontSize: 15,
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
  fullScreenCardOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 999,
    borderRadius: 0,
    padding: 14,
    paddingTop: Platform.OS === "ios" ? 54 : 36,
    backgroundColor: "#0f172a",
    marginBottom: 0,
  },
  cardTitle: {
    fontSize: 19,
    fontWeight: "800",
    color: "#111827",
    marginBottom: 10,
  },
  mapHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  fullScreenMapHeaderRow: {
    marginBottom: 12,
  },
  exitFullScreenButton: {
    backgroundColor: "#2563eb",
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 12,
    alignSelf: "flex-start",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
    minHeight: 48,
    justifyContent: "center",
  },
  exitFullScreenButtonText: {
    color: "#ffffff",
    fontWeight: "800",
    fontSize: 16,
  },
  fullScreenToggleButton: {
    backgroundColor: "#3b82f6",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
  },
  fullScreenToggleText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 14,
  },
  fullScreenGuidanceBanner: {
    backgroundColor: "#1e293b",
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderLeftWidth: 4,
    borderLeftColor: "#38bdf8",
  },
  fullScreenGuidanceText: {
    color: "#f8fafc",
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 4,
  },
  fullScreenMetricsText: {
    color: "#38bdf8",
    fontSize: 14,
    fontWeight: "700",
  },
  mapContainer: {
    height: 420,
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1.5,
    borderColor: "#cbd5e1",
    backgroundColor: "#0f172a",
    position: "relative",
  },
  fullScreenMapContainer: {
    flex: 1,
    height: undefined,
  },
  mapControlsOverlay: {
    position: "absolute",
    right: 14,
    bottom: 16,
    gap: 10,
    zIndex: 10,
  },
  mapControlButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(15, 23, 42, 0.90)",
    borderWidth: 2,
    borderColor: "#3b82f6",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  recenterButton: {
    backgroundColor: "rgba(37, 99, 235, 0.95)",
    borderColor: "#ffffff",
  },
  mapControlIconText: {
    color: "#ffffff",
    fontSize: 26,
    fontWeight: "900",
    lineHeight: 28,
  },
  recenterIconText: {
    color: "#ffffff",
    fontSize: 24,
    fontWeight: "900",
  },
  segmentedContainer: {
    flexDirection: "row",
    backgroundColor: "#e2e8f0",
    borderRadius: 12,
    padding: 4,
    marginBottom: 14,
  },
  segmentedButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
    borderRadius: 10,
    minHeight: 48,
    justifyContent: "center",
  },
  segmentedButtonActiveGps: {
    backgroundColor: "#059669",
  },
  segmentedButtonActiveManual: {
    backgroundColor: "#d97706",
  },
  segmentedText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#475569",
  },
  segmentedTextActive: {
    color: "#ffffff",
  },
  activeSourceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  sourceBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  sourceBadgeGps: {
    backgroundColor: "#dcfce7",
  },
  sourceBadgeManual: {
    backgroundColor: "#fef3c7",
  },
  sourceBadgeText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#1e293b",
  },
  resetGpsSmallButton: {
    backgroundColor: "#e0e7ff",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  resetGpsSmallText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#3730a3",
  },
  placeNameText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1d4ed8",
    marginTop: 4,
    marginBottom: 10,
  },
  manualSimulatorBox: {
    backgroundColor: "#fffbe6",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1.5,
    borderColor: "#fde68a",
    marginTop: 6,
  },
  manualBoxTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: "#92400e",
    marginBottom: 10,
  },
  textInputLarge: {
    backgroundColor: "#ffffff",
    borderWidth: 1.5,
    borderColor: "#d1d5db",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    color: "#111827",
    marginBottom: 10,
    minHeight: 52,
  },
  searchResultsDropdownLarge: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#3b82f6",
    marginBottom: 14,
    maxHeight: 260,
    overflow: "hidden",
  },
  recommendationsHeaderTitle: {
    backgroundColor: "#eff6ff",
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 12,
    fontWeight: "700",
    color: "#1d4ed8",
    borderBottomWidth: 1,
    borderBottomColor: "#bfdbfe",
  },
  searchResultRowItem: {
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
    minHeight: 52,
    justifyContent: "center",
  },
  searchResultRowTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#0f172a",
  },
  searchResultRowSubtext: {
    fontSize: 13,
    color: "#475569",
    marginTop: 3,
  },
  confirmationCardBox: {
    backgroundColor: "#f0fdf4",
    borderColor: "#86efac",
    borderWidth: 2,
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
  },
  confirmationCardHeader: {
    fontSize: 13,
    fontWeight: "700",
    color: "#166534",
    textTransform: "uppercase",
    marginBottom: 6,
  },
  confirmationTitleText: {
    fontSize: 18,
    fontWeight: "800",
    color: "#0f172a",
    marginBottom: 4,
  },
  confirmationSubtext: {
    fontSize: 14,
    color: "#334155",
    marginBottom: 12,
  },
  confirmLocationButton: {
    backgroundColor: "#16a34a",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 52,
  },
  confirmLocationButtonText: {
    color: "#ffffff",
    fontWeight: "800",
    fontSize: 16,
  },
  mapPickerButton: {
    backgroundColor: "#d97706",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 8,
    minHeight: 50,
    justifyContent: "center",
  },
  mapPickerButtonText: {
    color: "#ffffff",
    fontWeight: "800",
    fontSize: 15,
  },
  mapPickerHint: {
    fontSize: 12,
    color: "#78350f",
    fontStyle: "italic",
    textAlign: "center",
    lineHeight: 16,
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
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    minHeight: 40,
    justifyContent: "center",
  },
  presetChipSelected: {
    backgroundColor: "#3730a3",
  },
  presetChipText: {
    color: "#3730a3",
    fontSize: 14,
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
    minHeight: 48,
    justifyContent: "center",
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
