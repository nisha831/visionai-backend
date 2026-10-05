import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  captureAndAnalyzeFromRaspi,
  getContinuousDistance,
  getHardwareStatus,
  getLatestAnalysisEvent,
  AnalyzeResult,
  HardwareStatus,
} from '@/services/api';
import { speakAnalysisResult, stopSpeech, checkTtsStatus } from '@/services/voice';
import { AI_BACKEND_URL } from '@/config';
import { useTheme } from '@/hooks/use-theme';

export default function HomeScreen() {
  const theme = useTheme();

  // Hardware Status State
  const [hardware, setHardware] = useState<HardwareStatus>({
    camera: false,
    distance_sensor: false,
    button: false,
    ai_backend: false,
  });
  const [isCheckingStatus, setIsCheckingStatus] = useState<boolean>(false);

  // Distance Monitoring State
  const [distanceVal, setDistanceVal] = useState<number | null>(null);
  const [distanceStatus, setDistanceStatus] = useState<string>('CONNECTING...');

  // Capture & Analysis State
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [raspiImageUri, setRaspiImageUri] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalyzeResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Refs for tracking broadcast event updates
  const lastEventIdRef = useRef<number>(0);
  const isLoadingRef = useRef<boolean>(false);

  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  // Initial load
  useEffect(() => {
    checkAllConnections();
    checkTtsStatus();
  }, []);

  // Continuous polling loop for distance, hardware status, and physical button events
  useEffect(() => {
    const interval = setInterval(async () => {
      // 1. Poll distance
      const dInfo = await getContinuousDistance();
      if (dInfo) {
        setDistanceVal(dInfo.distance_cm);
        setDistanceStatus(dInfo.status);
      } else {
        setDistanceVal(null);
        setDistanceStatus('UNAVAILABLE');
      }

      // 2. Poll hardware status
      const hStatus = await getHardwareStatus();
      setHardware(hStatus);

      // 3. Poll latest analysis broadcast event (Physical button press on Pi)
      const evt = await getLatestAnalysisEvent();
      if (evt && evt.event_id > lastEventIdRef.current) {
        lastEventIdRef.current = evt.event_id;
        if (evt.result && !isLoadingRef.current) {
          console.log('[VisionAI] New capture broadcast received from backend! Triggering voice output...');
          setAnalysisResult(evt.result);
          if (evt.result.filename) {
            console.log('[IMAGE DEBUG] filename:', evt.result.filename);
            console.log(
              '[IMAGE DEBUG] image URL:',
              `${AI_BACKEND_URL}/uploads/${evt.result.filename}`
            );

            setRaspiImageUri(`${AI_BACKEND_URL}/uploads/${evt.result.filename}?t=${Date.now()}`);
          }
          speakAnalysisResult(evt.result);
        }
      }
    }, 600);

    return () => clearInterval(interval);
  }, []);

  const checkAllConnections = async () => {
    setIsCheckingStatus(true);
    setErrorMessage(null);
    const hStatus = await getHardwareStatus();
    setHardware(hStatus);

    const dInfo = await getContinuousDistance();
    if (dInfo) {
      setDistanceVal(dInfo.distance_cm);
      setDistanceStatus(dInfo.status);
    } else {
      setDistanceVal(null);
      setDistanceStatus('UNAVAILABLE');
    }
    setIsCheckingStatus(false);
  };

  const handleRaspiCapture = async () => {
    stopSpeech();
    setErrorMessage(null);
    setAnalysisResult(null);
    setIsLoading(true);

    try {
      setStatusMessage('CAPTURING...');
      const { imageUri, result } = await captureAndAnalyzeFromRaspi();

      setStatusMessage('ANALYZING...');
      let finalUri = imageUri;
      if (result?.filename) {
        finalUri = `${AI_BACKEND_URL}/uploads/${result.filename}`;
        console.log('[IMAGE DEBUG] filename:', result.filename);
        console.log(
          '[IMAGE DEBUG] image URL:',
          `${AI_BACKEND_URL}/uploads/${result.filename}`
        );
      }
      const cacheBustUri = `${finalUri}?t=${Date.now()}`;
      setRaspiImageUri(cacheBustUri);
      setAnalysisResult(result);
      speakAnalysisResult(result);

      // Keep lastEventIdRef in sync with backend
      const latestEvt = await getLatestAnalysisEvent();
      if (latestEvt) {
        lastEventIdRef.current = latestEvt.event_id;
      }
    } catch (error: any) {
      console.error('Raspberry Pi Capture/Analyze error:', error);
      setErrorMessage(
        error.message ||
        'Failed to capture from camera server. Please verify backend services are running.'
      );
    } finally {
      setIsLoading(false);
      setStatusMessage('');
    }
  };

  const formatOcrText = (item: any): string => {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object' && item.text) return item.text;
    return String(item);
  };

  // Determine Distance Banner Theme
  const getBannerStyle = () => {
    if (distanceVal === null || distanceStatus === 'UNAVAILABLE' || distanceStatus === 'CONNECTING...') {
      return styles.bannerUnavailable;
    }
    if (distanceVal <= 50) return styles.bannerVeryClose;
    if (distanceVal <= 100) return styles.bannerCaution;
    if (distanceVal <= 150) return styles.bannerObjectAhead;
    return styles.bannerClear;
  };

  const getBannerIcon = () => {
    if (distanceVal === null || distanceStatus === 'UNAVAILABLE' || distanceStatus === 'CONNECTING...') {
      return '📡';
    }
    if (distanceVal <= 50) return '🛑';
    if (distanceVal <= 100) return '⚠️';
    if (distanceVal <= 150) return '⚠';
    return '✓';
  };

  const peopleCount = analysisResult?.people_count ?? 0;
  const ocrText = analysisResult?.ocr_text || (analysisResult?.text && analysisResult.text.length > 0 ? analysisResult.text.map(formatOcrText).join(' ') : null);

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.background }]}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={[styles.title, { color: theme.text }]}>VisionAI</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
            Assistive Hardware & Vision System
          </Text>
        </View>

        {/* Real-Time Continuous Distance Banner */}
        <View style={[styles.distanceBanner, getBannerStyle()]}>
          <View style={styles.distanceRow}>
            <Text style={styles.distanceStatusText}>
              {getBannerIcon()} {distanceStatus}
            </Text>
            <Text style={styles.distanceValueText}>
              {distanceVal !== null ? `${Math.round(distanceVal)} cm` : '---'}
            </Text>
          </View>
        </View>

        {/* Hardware & Service Connectivity Grid */}
        <View style={styles.statusCard}>
          <View style={styles.statusHeaderRow}>
            <Text style={styles.statusTitle}>Hardware & Service Connectivity</Text>
            <Pressable
              style={styles.refreshButton}
              onPress={checkAllConnections}
              disabled={isCheckingStatus}
            >
              <Text style={styles.refreshButtonText}>
                {isCheckingStatus ? 'Checking...' : 'Check All'}
              </Text>
            </Pressable>
          </View>

          <View style={styles.gridContainer}>
            <View style={styles.gridItem}>
              <Text style={styles.statusLabel}>📷 Pi Camera:</Text>
              <Text style={hardware.camera ? styles.statusSuccess : styles.statusError}>
                {hardware.camera ? 'Connected' : 'Offline'}
              </Text>
            </View>

            <View style={styles.gridItem}>
              <Text style={styles.statusLabel}>📡 HC-SR04 Sensor:</Text>
              <Text style={hardware.distance_sensor ? styles.statusSuccess : styles.statusError}>
                {hardware.distance_sensor ? 'Connected' : 'Offline'}
              </Text>
            </View>

            <View style={styles.gridItem}>
              <Text style={styles.statusLabel}>🔘 Push Button (GPIO 17):</Text>
              <Text style={hardware.button ? styles.statusSuccess : styles.statusError}>
                {hardware.button ? 'Connected' : 'Offline'}
              </Text>
            </View>

            <View style={styles.gridItem}>
              <Text style={styles.statusLabel}>🤖 AI Backend:</Text>
              <Text style={hardware.ai_backend ? styles.statusSuccess : styles.statusError}>
                {hardware.ai_backend ? 'Connected' : 'Offline'}
              </Text>
            </View>
          </View>
        </View>

        {/* System Error Alert */}
        {errorMessage && (
          <View style={styles.errorBox}>
            <Text style={styles.errorTitle}>⚠️ System / Network Error</Text>
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        )}

        {/* Primary Action Button */}
        <View style={styles.actionContainer}>
          <Pressable
            style={({ pressed }) => [
              styles.captureButton,
              (isLoading || isCheckingStatus) && styles.disabledButton,
              pressed && styles.pressedButton,
            ]}
            onPress={handleRaspiCapture}
            disabled={isLoading || isCheckingStatus}
          >
            {isLoading ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color="#FFFFFF" />
                <Text style={styles.captureButtonText}>
                  {statusMessage || 'Processing...'}
                </Text>
              </View>
            ) : (
              <Text style={styles.captureButtonText}>📷 CAPTURE IMAGE</Text>
            )}
          </Pressable>
        </View>

        {/* Captured Image Preview */}
        {raspiImageUri && (
          <View style={styles.previewContainer}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>
              Raspberry Pi Captured Image
            </Text>
            <Image
              source={{ uri: raspiImageUri }}
              style={styles.previewImage}
              resizeMode="cover"
              onLoad={() => console.log('[IMAGE] LOAD SUCCESS:', raspiImageUri)}
              onError={(e) =>
                console.log('[IMAGE] LOAD ERROR:', e.nativeEvent, 'URI:', raspiImageUri)
              }
            />
          </View>
        )}

        {/* Loading Spinner */}
        {isLoading && (
          <View style={styles.analysisLoadingBox}>
            <ActivityIndicator size="large" color="#6366F1" />
            <Text style={styles.analysisLoadingText}>
              {statusMessage || 'Analyzing with VisionAI AI Backend...'}
            </Text>
          </View>
        )}

        {/* Analysis Results Display */}
        {analysisResult && !isLoading && (
          <View style={styles.resultContainer}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>
              Analysis Results
            </Text>

            {/* 1. Distance */}
            <View style={styles.resultCard}>
              <Text style={[styles.cardHeader, { color: theme.text }]}>📏 Distance</Text>
              <Text style={styles.cardMainText}>
                {analysisResult.distance?.distance_cm !== undefined && analysisResult.distance.distance_cm !== null
                  ? `${Math.round(analysisResult.distance.distance_cm)} cm`
                  : distanceVal !== null ? `${Math.round(distanceVal)} cm` : '---'}
              </Text>
              <Text style={styles.cardSubText}>
                {analysisResult.distance?.status || distanceStatus}
              </Text>
            </View>

            {/* 2. Scene Description */}
            {analysisResult.scene?.description && (
              <View style={styles.resultCardHighlight}>
                <Text style={styles.cardHeaderHighlight}>👁️ Scene Description</Text>
                <Text style={styles.sceneText}>{analysisResult.scene.description}</Text>
                {analysisResult.scene.background_color && analysisResult.scene.background_color !== 'unknown' && (
                  <Text style={styles.tagBadge}>
                    Dominant Background: {analysisResult.scene.background_color}
                  </Text>
                )}
              </View>
            )}

            {/* 3. People */}
            <View style={styles.resultCard}>
              <Text style={[styles.cardHeader, { color: theme.text }]}>👥 People</Text>
              <Text style={styles.cardMainText}>
                {peopleCount === 0
                  ? 'No people detected'
                  : peopleCount === 1
                    ? '1 person detected'
                    : `${peopleCount} people detected`}
              </Text>
            </View>

            {/* 4. Objects Detected */}
            {analysisResult.objects && analysisResult.objects.length > 0 && (
              <View style={styles.resultCard}>
                <Text style={[styles.cardHeader, { color: theme.text }]}>🔍 Objects Detected</Text>
                {analysisResult.objects.map((obj, idx) => (
                  <View key={idx} style={styles.resultRow}>
                    <Text style={[styles.itemText, { color: theme.text }]}>
                      • {obj.name} ({obj.position || 'center'})
                    </Text>
                    <Text style={styles.confidenceBadge}>
                      {Math.round(obj.confidence * 100)}%
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {/* 5. Currency Detected */}
            {analysisResult.final_currency && (
              <View style={styles.resultCardCurrency}>
                <Text style={styles.cardHeaderCurrency}>💵 Currency Detected</Text>
                <Text style={styles.currencyValue}>₹{analysisResult.final_currency.name}</Text>
                <Text style={styles.currencyDetails}>
                  Confidence: {Math.round(analysisResult.final_currency.confidence * 100)}% ({analysisResult.final_currency.source})
                </Text>
              </View>
            )}

            {/* 6. OCR Text */}
            <View style={styles.resultCard}>
              <Text style={[styles.cardHeader, { color: theme.text }]}>📝 OCR Text</Text>
              {ocrText ? (
                <View style={styles.ocrBox}>
                  <Text style={styles.ocrTextItem}>"{ocrText}"</Text>
                </View>
              ) : (
                <Text style={styles.cardSubText}>No text detected</Text>
              )}
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 60,
  },
  header: {
    alignItems: 'center',
    marginBottom: 16,
    marginTop: 10,
  },
  title: {
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 13,
    marginTop: 4,
    fontWeight: '500',
    textAlign: 'center',
  },
  distanceBanner: {
    padding: 16,
    borderRadius: 14,
    marginBottom: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  bannerClear: {
    backgroundColor: '#065F46',
  },
  bannerObjectAhead: {
    backgroundColor: '#D97706',
  },
  bannerCaution: {
    backgroundColor: '#C2410C',
  },
  bannerVeryClose: {
    backgroundColor: '#991B1B',
  },
  bannerUnavailable: {
    backgroundColor: '#475569',
  },
  distanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  distanceStatusText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  distanceValueText: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
  },
  statusCard: {
    backgroundColor: '#1E293B',
    padding: 16,
    borderRadius: 14,
    marginBottom: 20,
    gap: 12,
  },
  statusHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusTitle: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
  },
  refreshButton: {
    backgroundColor: '#334155',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  refreshButtonText: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '600',
  },
  gridContainer: {
    gap: 8,
  },
  gridItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  statusLabel: {
    color: '#CBD5E1',
    fontSize: 13,
    fontWeight: '500',
  },
  statusSuccess: {
    color: '#4ADE80',
    fontSize: 13,
    fontWeight: '700',
  },
  statusError: {
    color: '#F87171',
    fontSize: 13,
    fontWeight: '700',
  },
  errorBox: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FCA5A5',
    borderWidth: 1,
    padding: 14,
    borderRadius: 12,
    marginBottom: 20,
  },
  errorTitle: {
    color: '#991B1B',
    fontWeight: '700',
    fontSize: 14,
    marginBottom: 4,
  },
  errorText: {
    color: '#B91C1C',
    fontSize: 13,
    lineHeight: 18,
  },
  actionContainer: {
    marginBottom: 24,
  },
  captureButton: {
    backgroundColor: '#4F46E5',
    paddingVertical: 18,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#4F46E5',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  captureButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  disabledButton: {
    opacity: 0.6,
  },
  pressedButton: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  previewContainer: {
    marginBottom: 24,
  },
  previewImage: {
    width: '100%',
    height: 220,
    borderRadius: 14,
    marginTop: 10,
    backgroundColor: '#E2E8F0',
  },
  analysisLoadingBox: {
    alignItems: 'center',
    paddingVertical: 30,
    gap: 12,
  },
  analysisLoadingText: {
    color: '#6366F1',
    fontSize: 15,
    fontWeight: '600',
  },
  resultContainer: {
    gap: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 4,
  },
  resultCard: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    padding: 16,
    borderRadius: 14,
  },
  resultCardHighlight: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
    borderWidth: 1,
    padding: 16,
    borderRadius: 14,
  },
  cardHeader: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 6,
  },
  cardHeaderHighlight: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1E40AF',
    marginBottom: 6,
  },
  cardMainText: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
  },
  cardSubText: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 2,
    fontWeight: '500',
  },
  sceneText: {
    fontSize: 15,
    color: '#1E293B',
    lineHeight: 22,
    fontWeight: '500',
  },
  tagBadge: {
    marginTop: 8,
    alignSelf: 'flex-start',
    backgroundColor: '#DBEAFE',
    color: '#1E40AF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    fontSize: 12,
    fontWeight: '600',
  },
  resultCardCurrency: {
    backgroundColor: '#065F46',
    padding: 18,
    borderRadius: 14,
    alignItems: 'center',
  },
  cardHeaderCurrency: {
    color: '#A7F3D0',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  currencyValue: {
    color: '#FFFFFF',
    fontSize: 36,
    fontWeight: '800',
    marginVertical: 4,
  },
  currencyDetails: {
    color: '#D1FAE5',
    fontSize: 13,
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  itemText: {
    fontSize: 15,
    fontWeight: '600',
  },
  confidenceBadge: {
    backgroundColor: '#EEF2FF',
    color: '#4F46E5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    fontSize: 13,
    fontWeight: '700',
  },
  ocrBox: {
    backgroundColor: '#FFFFFF',
    borderColor: '#CBD5E1',
    borderWidth: 1,
    padding: 12,
    borderRadius: 10,
    marginTop: 4,
  },
  ocrTextItem: {
    color: '#334155',
    fontSize: 14,
    fontFamily: 'monospace',
  },
});