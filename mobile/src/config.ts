import { Platform } from 'react-native';

/**
 * Android emulator maps host localhost to 10.0.2.2.
 * Physical devices need your Mac/PC LAN IP on the same Wi‑Fi.
 * iOS simulator can use localhost directly.
 *
 * Set DEV_API_HOST_OVERRIDE to your machine IP when testing on a real phone.
 */
const DEV_API_HOST_OVERRIDE = '192.168.21.142'; // e.g. '192.168.1.5' when testing on a physical phone

const DEV_API_HOST = DEV_API_HOST_OVERRIDE
  ? DEV_API_HOST_OVERRIDE
  : Platform.OS === 'android'
    ? '10.0.2.2'
    : 'localhost';

/** Render production API — update after deploy if your service name differs */
const PRODUCTION_API_URL = 'https://zeroads-api.onrender.com';

export const API_BASE_URL = __DEV__
  ? `http://${DEV_API_HOST}:3000`
  : PRODUCTION_API_URL;
