import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Linking } from 'react-native';

interface ForceUpdateScreenProps {
  message: string;
  updateUrl: string;
  currentVersion: string;
  minVersion: string;
  onRetry?: () => void;
}

export const ForceUpdateScreen: React.FC<ForceUpdateScreenProps> = ({
  message,
  updateUrl,
  currentVersion,
  minVersion,
  onRetry,
}) => {
  const handleUpdate = async () => {
    const opened = await Linking.openURL(updateUrl);
    if (!opened && updateUrl.startsWith('market://')) {
      const fallback = updateUrl.replace('market://details?id=', 'https://play.google.com/store/apps/details?id=');
      await Linking.openURL(fallback);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Update Required</Text>
      <Text style={styles.message}>{message}</Text>
      <View style={styles.versionRow}>
        <Text style={styles.versionLabel}>Current:</Text>
        <Text style={styles.versionValue}>{currentVersion || 'Unknown'}</Text>
      </View>
      <View style={styles.versionRow}>
        <Text style={styles.versionLabel}>Required:</Text>
        <Text style={styles.versionValue}>{minVersion || 'Unknown'}</Text>
      </View>
      <TouchableOpacity style={styles.updateButton} onPress={handleUpdate}>
        <Text style={styles.updateButtonText}>Update Now</Text>
      </TouchableOpacity>
      {onRetry && (
        <TouchableOpacity style={styles.retryButton} onPress={onRetry}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 12,
  },
  message: {
    fontSize: 16,
    color: '#e2e8f0',
    textAlign: 'center',
    marginBottom: 20,
  },
  versionRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 6,
  },
  versionLabel: {
    color: '#94a3b8',
    fontSize: 14,
  },
  versionValue: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  updateButton: {
    marginTop: 18,
    backgroundColor: '#22c55e',
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 8,
  },
  updateButtonText: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '700',
  },
  retryButton: {
    marginTop: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#64748b',
  },
  retryButtonText: {
    color: '#e2e8f0',
    fontSize: 14,
    fontWeight: '600',
  },
});

export default ForceUpdateScreen;
