import { useEffect, useRef } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import {
  getAndroidSharedUrl,
  subscribeToAndroidSharedUrl,
} from '../native/shareIntent';
import { extractUrlFromText } from '../utils/url';

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function normalizeIncomingUrl(raw: string): string | null {
  return extractUrlFromText(raw.trim());
}

export function useSharedUrl(onUrl: (url: string) => void) {
  const handledRef = useRef<string | null>(null);

  useEffect(() => {
    const handleUrl = (raw: string) => {
      const normalized = normalizeIncomingUrl(raw);
      if (!normalized || !isHttpUrl(normalized) || handledRef.current === normalized) {
        return;
      }
      handledRef.current = normalized;
      onUrl(normalized);
    };

    const readAndroidShare = async () => {
      const sharedUrl = await getAndroidSharedUrl();
      if (sharedUrl) {
        handleUrl(sharedUrl);
      }
    };

    if (Platform.OS === 'android') {
      readAndroidShare();
      const unsubscribe = subscribeToAndroidSharedUrl(handleUrl);
      const appStateSub = AppState.addEventListener('change', (status) => {
        if (status === 'active') {
          readAndroidShare();
        }
      });

      return () => {
        unsubscribe();
        appStateSub.remove();
      };
    }

    Linking.getInitialURL().then((initialUrl) => {
      if (initialUrl) {
        handleUrl(initialUrl);
      }
    });

    const subscription = Linking.addEventListener('url', ({ url }) => {
      handleUrl(url);
    });

    return () => {
      subscription.remove();
    };
  }, [onUrl]);
}

export const SHARE_INTENT_HINT =
  Platform.OS === 'android'
    ? 'Share a link from YouTube, TikTok, Instagram, or paste a URL below.'
    : 'Paste a YouTube or social link below. iOS share-from-app requires the Share Extension (see README).';
