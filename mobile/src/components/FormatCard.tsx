import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { MediaFormat } from '../types';

interface FormatCardProps {
  format: MediaFormat;
  onDownload: (format: MediaFormat) => void;
}

function formatFileSize(bytes?: number): string {
  if (!bytes) {
    return 'Unknown size';
  }
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}

export function FormatCard({ format, onDownload }: FormatCardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.meta}>
        <Text style={styles.quality}>{format.quality}</Text>
        <Text style={styles.badge}>{format.type.toUpperCase()}</Text>
        {format.needsMerge ? (
          <Text style={styles.mergeBadge}>MERGED</Text>
        ) : null}
      </View>
      <Text style={styles.details}>
        {format.ext.toUpperCase()} · {formatFileSize(format.filesize)}
        {format.needsMerge ? ' · server merges video + audio' : ''}
      </Text>
      <Pressable
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        onPress={() => onDownload(format)}>
        <Text style={styles.buttonText}>Download</Text>
      </Pressable>
    </View>
  );
}

interface ResultHeaderProps {
  title: string;
  uploader?: string;
  thumbnail?: string;
}

export function ResultHeader({ title, uploader, thumbnail }: ResultHeaderProps) {
  return (
    <View style={styles.header}>
      {thumbnail ? (
        <Image source={{ uri: thumbnail }} style={styles.thumbnail} />
      ) : null}
      <View style={styles.headerText}>
        <Text style={styles.title} numberOfLines={3}>
          {title}
        </Text>
        {uploader ? <Text style={styles.uploader}>by {uploader}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#1a1f2e',
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#2a3348',
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  quality: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
  },
  badge: {
    color: '#7dd3fc',
    fontSize: 11,
    fontWeight: '600',
    backgroundColor: '#0c4a6e',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
  mergeBadge: {
    color: '#fde68a',
    fontSize: 11,
    fontWeight: '600',
    backgroundColor: '#78350f',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
  details: {
    color: '#94a3b8',
    fontSize: 13,
    marginBottom: 12,
  },
  button: {
    backgroundColor: '#2563eb',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 15,
  },
  header: {
    flexDirection: 'row',
    gap: 14,
    marginBottom: 20,
  },
  thumbnail: {
    width: 120,
    height: 68,
    borderRadius: 8,
    backgroundColor: '#1e293b',
  },
  headerText: {
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 22,
  },
  uploader: {
    color: '#94a3b8',
    fontSize: 13,
    marginTop: 4,
  },
});
