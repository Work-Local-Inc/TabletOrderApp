import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Switch,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useStore } from '../store/useStore';

type RootStackParamList = {
  Orders: undefined;
  OrderDetail: { orderId: string };
  Settings: undefined;
};

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Settings'>;

const NOTIFICATION_TONES = [
  { id: 'default', label: 'Default', icon: '🔔' },
  { id: 'chime', label: 'Chime', icon: '🎵' },
  { id: 'bell', label: 'Bell', icon: '🔔' },
  { id: 'alert', label: 'Alert', icon: '⚠️' },
] as const;

const POLL_INTERVALS = [
  { value: 3000, label: '3 seconds (fast)' },
  { value: 5000, label: '5 seconds (normal)' },
  { value: 10000, label: '10 seconds (slow)' },
  { value: 30000, label: '30 seconds (battery saver)' },
];

export const SettingsScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const { settings, updateSettings, logout, auth, offline } = useStore();
  const [showToneSelector, setShowToneSelector] = useState(false);
  const [showIntervalSelector, setShowIntervalSelector] = useState(false);

  const handleLogout = useCallback(() => {
    Alert.alert(
      'Logout',
      'Are you sure you want to disconnect this device?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            await logout();
          },
        },
      ]
    );
  }, [logout]);

  const handleTestPrinter = useCallback(() => {
    // TODO: Implement printer test
    Alert.alert(
      'Test Print',
      'This will print a test page on the connected printer.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Print Test',
          onPress: () => {
            // printTestPage();
            Alert.alert('Info', 'Printer testing will be implemented with the printing service');
          },
        },
      ]
    );
  }, []);

  const selectedTone = NOTIFICATION_TONES.find((t) => t.id === settings.notificationTone);
  const selectedInterval = POLL_INTERVALS.find((i) => i.value === settings.pollIntervalMs);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        {/* Device Info Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Device Information</Text>
          <View style={styles.card}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Restaurant</Text>
              <Text style={styles.infoValue}>{auth.restaurantName || 'N/A'}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Device Name</Text>
              <Text style={styles.infoValue}>{auth.deviceName || 'N/A'}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Connection Status</Text>
              <View style={styles.statusIndicator}>
                <View
                  style={[
                    styles.statusDot,
                    { backgroundColor: offline.isOnline ? '#4CAF50' : '#F44336' },
                  ]}
                />
                <Text style={styles.statusText}>
                  {offline.isOnline ? 'Connected' : 'Offline'}
                </Text>
              </View>
            </View>
            {offline.queuedActions.length > 0 && (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Queued Actions</Text>
                <Text style={styles.infoValueWarning}>
                  {offline.queuedActions.length} pending
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Printing Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Printing</Text>
          <View style={styles.card}>
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Auto-Print New Orders</Text>
                <Text style={styles.settingDescription}>
                  Automatically print orders when received
                </Text>
              </View>
              <Switch
                value={settings.autoPrint}
                onValueChange={(value) => updateSettings({ autoPrint: value })}
                trackColor={{ false: '#ddd', true: '#81C784' }}
                thumbColor={settings.autoPrint ? '#4CAF50' : '#f5f5f5'}
              />
            </View>
            <View style={styles.divider} />
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Printer Status</Text>
                <Text style={styles.settingDescription}>
                  {settings.printerConnected
                    ? settings.printerName || 'Connected'
                    : 'No printer connected'}
                </Text>
              </View>
              <View
                style={[
                  styles.printerStatus,
                  {
                    backgroundColor: settings.printerConnected
                      ? '#E8F5E9'
                      : '#FFEBEE',
                  },
                ]}
              >
                <Text
                  style={[
                    styles.printerStatusText,
                    {
                      color: settings.printerConnected ? '#4CAF50' : '#F44336',
                    },
                  ]}
                >
                  {settings.printerConnected ? '✓ Ready' : '✗ Not Found'}
                </Text>
              </View>
            </View>
            <TouchableOpacity style={styles.actionButton} onPress={handleTestPrinter}>
              <Text style={styles.actionButtonIcon}>🖨️</Text>
              <Text style={styles.actionButtonText}>Test Printer</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Notifications Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Notifications</Text>
          <View style={styles.card}>
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Sound Notifications</Text>
                <Text style={styles.settingDescription}>
                  Play a sound when new orders arrive
                </Text>
              </View>
              <Switch
                value={settings.soundEnabled}
                onValueChange={(value) => updateSettings({ soundEnabled: value })}
                trackColor={{ false: '#ddd', true: '#81C784' }}
                thumbColor={settings.soundEnabled ? '#4CAF50' : '#f5f5f5'}
              />
            </View>
            <View style={styles.divider} />
            <TouchableOpacity
              style={styles.settingRowTouchable}
              onPress={() => setShowToneSelector(!showToneSelector)}
            >
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Notification Tone</Text>
                <Text style={styles.settingDescription}>
                  {selectedTone?.icon} {selectedTone?.label}
                </Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
            {showToneSelector && (
              <View style={styles.selectorContainer}>
                {NOTIFICATION_TONES.map((tone) => (
                  <TouchableOpacity
                    key={tone.id}
                    style={[
                      styles.selectorOption,
                      settings.notificationTone === tone.id &&
                        styles.selectorOptionSelected,
                    ]}
                    onPress={() => {
                      updateSettings({ notificationTone: tone.id });
                      setShowToneSelector(false);
                    }}
                  >
                    <Text style={styles.selectorOptionIcon}>{tone.icon}</Text>
                    <Text style={styles.selectorOptionLabel}>{tone.label}</Text>
                    {settings.notificationTone === tone.id && (
                      <Text style={styles.checkmark}>✓</Text>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        </View>

        {/* Polling Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Sync Settings</Text>
          <View style={styles.card}>
            <TouchableOpacity
              style={styles.settingRowTouchable}
              onPress={() => setShowIntervalSelector(!showIntervalSelector)}
            >
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Polling Interval</Text>
                <Text style={styles.settingDescription}>
                  Check for new orders every {selectedInterval?.label || '5 seconds'}
                </Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
            {showIntervalSelector && (
              <View style={styles.selectorContainer}>
                {POLL_INTERVALS.map((interval) => (
                  <TouchableOpacity
                    key={interval.value}
                    style={[
                      styles.selectorOption,
                      settings.pollIntervalMs === interval.value &&
                        styles.selectorOptionSelected,
                    ]}
                    onPress={() => {
                      updateSettings({ pollIntervalMs: interval.value });
                      setShowIntervalSelector(false);
                    }}
                  >
                    <Text style={styles.selectorOptionLabel}>{interval.label}</Text>
                    {settings.pollIntervalMs === interval.value && (
                      <Text style={styles.checkmark}>✓</Text>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        </View>

        {/* Logout Section */}
        <View style={styles.section}>
          <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
            <Text style={styles.logoutButtonText}>Disconnect Device</Text>
          </TouchableOpacity>
          <Text style={styles.versionText}>Tablet Order App v1.0.0</Text>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f0f0',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backButton: {
    padding: 8,
    minWidth: 80,
  },
  backText: {
    fontSize: 16,
    color: '#4CAF50',
    fontWeight: '600',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  placeholder: {
    minWidth: 80,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 20,
    maxWidth: 600,
    alignSelf: 'center',
    width: '100%',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#666',
    textTransform: 'uppercase',
    marginBottom: 10,
    marginLeft: 4,
    letterSpacing: 0.5,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  infoLabel: {
    fontSize: 15,
    color: '#666',
  },
  infoValue: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
  },
  infoValueWarning: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FF9800',
  },
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  statusText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  settingRowTouchable: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  settingInfo: {
    flex: 1,
    marginRight: 16,
  },
  settingLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  settingDescription: {
    fontSize: 14,
    color: '#666',
  },
  divider: {
    height: 1,
    backgroundColor: '#f0f0f0',
    marginHorizontal: 16,
  },
  chevron: {
    fontSize: 24,
    color: '#999',
  },
  selectorContainer: {
    backgroundColor: '#f9f9f9',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  selectorOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  selectorOptionSelected: {
    backgroundColor: '#E8F5E9',
  },
  selectorOptionIcon: {
    fontSize: 18,
    marginRight: 12,
  },
  selectorOptionLabel: {
    fontSize: 15,
    color: '#333',
    flex: 1,
  },
  checkmark: {
    fontSize: 18,
    color: '#4CAF50',
    fontWeight: 'bold',
  },
  printerStatus: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  printerStatusText: {
    fontSize: 13,
    fontWeight: '600',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    backgroundColor: '#f9f9f9',
  },
  actionButtonIcon: {
    fontSize: 18,
    marginRight: 8,
  },
  actionButtonText: {
    fontSize: 15,
    color: '#4CAF50',
    fontWeight: '600',
  },
  logoutButton: {
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#F44336',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  logoutButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F44336',
  },
  versionText: {
    textAlign: 'center',
    color: '#999',
    fontSize: 13,
    marginTop: 16,
  },
});
