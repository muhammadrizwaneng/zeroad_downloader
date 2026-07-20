import { Platform } from 'react-native';

/** Deployed backend (Render). Used by release APK and dev builds by default. */
export const PRODUCTION_API_URL = 'https://zeroads-api.onrender.com';

/**
 * Optional: test against a backend running on your machine (`cd backend && npm run dev`).
 * Leave false to always use PRODUCTION_API_URL (recommended for real-device testing).
 */
const USE_LOCAL_BACKEND = false;

/** Your Mac/PC LAN IP when USE_LOCAL_BACKEND + testing on a physical phone on same Wi‑Fi. */
const DEV_API_HOST_OVERRIDE = '';

const DEV_API_HOST = DEV_API_HOST_OVERRIDE
  ? DEV_API_HOST_OVERRIDE
  : Platform.OS === 'android'
    ? '10.0.2.2' // Android emulator → host machine
    : 'localhost';

const LOCAL_API_URL = `http://${DEV_API_HOST}:3000`;

export const API_BASE_URL =
  __DEV__ && USE_LOCAL_BACKEND ? LOCAL_API_URL : PRODUCTION_API_URL;
