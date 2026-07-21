import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FormatCard, ResultHeader } from '../components/FormatCard';
import { API_BASE_URL } from '../config';
import { SHARE_INTENT_HINT, useSharedUrl } from '../hooks/useSharedUrl';
import { checkBackendHealth, extractMedia, resolveDownloadUrl, wakeBackend } from '../services/api';
import type { ExtractResult, MediaFormat } from '../types';
import { getPlatformLabel } from '../utils/url';

export function HomeScreen() {
  const insets = useSafeAreaInsets();
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingHint, setLoadingHint] = useState<string | null>(null);
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);
  const [result, setResult] = useState<ExtractResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sharedFrom, setSharedFrom] = useState<string | null>(null);

  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    checkBackendHealth().then(setBackendOnline);
  }, []);

  const runExtract = useCallback(async (inputUrl?: string) => {
    const trimmed = (inputUrl ?? url).trim();
    if (!trimmed) {
      setError('Paste a video or audio link to get started.');
      return;
    }

    setLoading(true);
    setLoadingHint('Connecting to server…');
    setError(null);
    setResult(null);
    setSharedFrom(getPlatformLabel(trimmed));

    try {
      await wakeBackend();
      setLoadingHint('Extracting video info…');
      const data = await extractMedia(trimmed);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setLoading(false);
      setLoadingHint(null);
    }
  }, [url]);

  const handleSharedUrl = useCallback(
    (sharedUrl: string) => {
      setUrl(sharedUrl);
      setSharedFrom(getPlatformLabel(sharedUrl));
      runExtract(sharedUrl);
    },
    [runExtract],
  );

  useSharedUrl(handleSharedUrl);

  const handleDownload = useCallback(
    (format: MediaFormat) => {
      if (!result?.webpageUrl) {
        return;
      }

      const isTikTokOrInstagram = /tiktok\.com|instagram\.com/i.test(result.webpageUrl);
      const isServerDownload = isTikTokOrInstagram || format.url.includes('/api/download');
      const mergeNote = isTikTokOrInstagram
        ? '\n\nThe file will download through the ZeroAds server (required for TikTok/Instagram).'
        : isServerDownload
          ? '\n\nResolving direct download link…'
          : '';

      Alert.alert(
        'Start download',
        `Open ${format.quality} ${format.type} (${format.ext})?${mergeNote}`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Open link',
            onPress: async () => {
              setDownloading(true);
              try {
                let openUrl = format.url;
                try {
                  openUrl = await resolveDownloadUrl(result.webpageUrl, format);
                } catch {
                  // Resolve slow/failed — fall back to server stream URL.
                }
                await Linking.openURL(openUrl);
              } catch (err) {
                Alert.alert(
                  'Error',
                  err instanceof Error ? err.message : 'Could not open the download URL.',
                );
              } finally {
                setDownloading(false);
              }
            },
          },
        ],
      );
    },
    [result],
  );

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { paddingTop: insets.top + 12 }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 24 },
        ]}
        keyboardShouldPersistTaps="handled">
        <Text style={styles.brand}>ZeroAds</Text>
        <Text style={styles.tagline}>YouTube & social media downloader</Text>
        <Text style={styles.hint}>{SHARE_INTENT_HINT}</Text>

        <View style={styles.statusRow}>
          <View
            style={[
              styles.statusDot,
              backendOnline === null
                ? styles.statusUnknown
                : backendOnline
                  ? styles.statusOnline
                  : styles.statusOffline,
            ]}
          />
          <Text style={styles.statusText}>
            Backend:{' '}
            {backendOnline === null
              ? 'checking…'
              : backendOnline
                ? `connected (${API_BASE_URL})`
                : `offline — start server at ${API_BASE_URL}`}
          </Text>
        </View>

        {sharedFrom ? (
          <View style={styles.sharedBadge}>
            <Text style={styles.sharedBadgeText}>Opened from {sharedFrom}</Text>
          </View>
        ) : null}

        <TextInput
          style={styles.input}
          placeholder="YouTube, TikTok, Instagram, Facebook link…"
          placeholderTextColor="#64748b"
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          onSubmitEditing={() => runExtract()}
        />

        <Pressable
          style={({ pressed }) => [
            styles.extractButton,
            (loading || pressed) && styles.extractButtonDisabled,
          ]}
          onPress={() => runExtract()}
          disabled={loading}>
          {loading ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.extractButtonText}>Extract media</Text>
          )}
        </Pressable>

        {loading && loadingHint ? (
          <Text style={styles.loadingHint}>{loadingHint}</Text>
        ) : null}

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {result ? (
          <View style={styles.results}>
            <ResultHeader
              title={result.title}
              uploader={result.uploader}
              thumbnail={result.thumbnail}
            />
            <Text style={styles.sectionTitle}>Available formats</Text>
            {result.formats.map((format) => (
              <FormatCard
                key={`${format.formatId}-${format.quality}`}
                format={format}
                onDownload={handleDownload}
              />
            ))}
          </View>
        ) : null}
      </ScrollView>
      {downloading ? (
        <View style={styles.downloadOverlay}>
          <ActivityIndicator color="#ffffff" size="large" />
          <Text style={styles.downloadOverlayText}>Getting download link… (up to 2 min on free server)</Text>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0f1219',
  },
  content: {
    paddingHorizontal: 20,
  },
  brand: {
    color: '#f8fafc',
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  tagline: {
    color: '#64748b',
    fontSize: 15,
    marginTop: 4,
    marginBottom: 8,
  },
  hint: {
    color: '#475569',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16,
  },
  sharedBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#172554',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#1d4ed8',
  },
  sharedBadgeText: {
    color: '#93c5fd',
    fontSize: 12,
    fontWeight: '600',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusOnline: {
    backgroundColor: '#22c55e',
  },
  statusOffline: {
    backgroundColor: '#ef4444',
  },
  statusUnknown: {
    backgroundColor: '#eab308',
  },
  statusText: {
    color: '#64748b',
    fontSize: 12,
    flex: 1,
  },
  input: {
    backgroundColor: '#1a1f2e',
    borderWidth: 1,
    borderColor: '#2a3348',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#f8fafc',
    fontSize: 15,
    marginBottom: 12,
  },
  extractButton: {
    backgroundColor: '#2563eb',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 16,
  },
  extractButtonDisabled: {
    opacity: 0.7,
  },
  extractButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  loadingHint: {
    color: '#94a3b8',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 12,
  },
  errorBox: {
    backgroundColor: '#450a0a',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#7f1d1d',
  },
  errorText: {
    color: '#fecaca',
    fontSize: 14,
    lineHeight: 20,
  },
  results: {
    marginTop: 8,
  },
  sectionTitle: {
    color: '#cbd5e1',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  downloadOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 18, 25, 0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  downloadOverlayText: {
    color: '#e2e8f0',
    fontSize: 16,
  },
});
