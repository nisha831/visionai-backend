import { Platform } from 'react-native';
import * as Device from 'expo-device';
import { AI_BACKEND_URL } from '@/config';

export const MAC_LAN_IP = '10.65.74.68';

export const getBaseUrl = (): string => {
  // 1. Environment Variable Override (highest priority)
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL.trim().replace(/\/+$/, '');
  }

  // 2. Android Emulator Check: ONLY use 10.0.2.2 if running inside an Android Emulator
  if (Platform.OS === 'android' && !Device.isDevice) {
    return 'http://10.0.2.2:8000';
  }

  // 3. iOS Simulator Check: use localhost:8000
  if (Platform.OS === 'ios' && !Device.isDevice) {
    return 'http://localhost:8000';
  }

  // 4. Physical Android Phone, Physical iPhone, or macOS Browser: Use Mac LAN IP
  if (AI_BACKEND_URL && !AI_BACKEND_URL.includes('127.0.0.1') && !AI_BACKEND_URL.includes('localhost')) {
    return AI_BACKEND_URL.trim().replace(/\/+$/, '');
  }

  return `http://${MAC_LAN_IP}:8000`;
};

// Central API configuration for VisionAI backend
export const API_BASE_URL = getBaseUrl();
