import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

interface ShareIntentModuleType {
  getSharedUrl: () => Promise<string | null>;
}

const ShareIntentModule =
  NativeModules.ShareIntentModule as ShareIntentModuleType | undefined;

const shareIntentEmitter =
  Platform.OS === 'android' && ShareIntentModule
    ? new NativeEventEmitter(NativeModules.ShareIntentModule)
    : null;

export async function getAndroidSharedUrl(): Promise<string | null> {
  if (Platform.OS !== 'android' || !ShareIntentModule) {
    return null;
  }

  return ShareIntentModule.getSharedUrl();
}

export function subscribeToAndroidSharedUrl(
  handler: (url: string) => void,
): () => void {
  if (!shareIntentEmitter) {
    return () => {};
  }

  const subscription = shareIntentEmitter.addListener(
    'ShareIntentReceived',
    (event: { url?: string }) => {
      if (event?.url) {
        handler(event.url);
      }
    },
  );

  return () => subscription.remove();
}
