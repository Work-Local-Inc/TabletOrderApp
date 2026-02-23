import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Switch,
  Alert,
  ActivityIndicator,
  Platform,
  PermissionsAndroid,
  Linking,
  useWindowDimensions,
} from 'react-native';
import * as Application from 'expo-application';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useStore } from '../store/useStore';
import { 
  discoverPrinters, 
  connectPrinter, 
  disconnectPrinter, 
  isPrinterConnected,
  printTestReceipt,
  ensureConnected,
} from '../services/printService';
import { useTheme, type Theme } from '../theme';
import { apiClient } from '../api/client';
import { NotificationTone, TabletServiceConfig } from '../types';
import { initSound, playAlert } from '../services/soundService';

const APP_VERSION = Application.nativeApplicationVersion || 'unknown';
const APP_PACKAGE = Application.applicationId || 'unknown.package';
const APP_NAME = Application.applicationName || 'Menu.ca Orders NEON';

// Request Bluetooth permissions for Android 12+
const requestBluetoothPermissions = async (): Promise<boolean> => {
  console.log('[Permissions] Starting permission request, Platform:', Platform.OS, 'Version:', Platform.Version);
  
  if (Platform.OS !== 'android') {
    console.log('[Permissions] Not Android, returning true');
    return true;
  }

  try {
    const openAppSettings = () => {
      Linking.openSettings().catch((err) => {
        console.warn('[Permissions] Failed to open app settings:', err);
      });
    };

    // For Android 12+ (API 31+)
    if (Platform.Version >= 31) {
      console.log('[Permissions] Android 12+, requesting BLUETOOTH_SCAN and BLUETOOTH_CONNECT (+location fallback)');
      
      // Check if already granted first
      const scanStatus = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN);
      const connectStatus = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT);
      const fineLocationStatus = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
      
      console.log('[Permissions] Current status - SCAN:', scanStatus, 'CONNECT:', connectStatus, 'FINE_LOCATION:', fineLocationStatus);
      
      if (scanStatus && connectStatus) {
        console.log('[Permissions] Already granted!');
        return true;
      }

      const permissions: string[] = [
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      ];
      // Some Bluetooth libraries still rely on location at runtime for discovery.
      if (!fineLocationStatus) {
        permissions.push(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
      }

      console.log('[Permissions] Calling requestMultiple...');
      const results = await PermissionsAndroid.requestMultiple(permissions);
      console.log('[Permissions] Results:', JSON.stringify(results));

      const scanGranted =
        scanStatus || results[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] === PermissionsAndroid.RESULTS.GRANTED;
      const connectGranted =
        connectStatus || results[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] === PermissionsAndroid.RESULTS.GRANTED;

      if (!scanGranted || !connectGranted) {
        console.log('[Permissions] Required permissions missing');
        Alert.alert(
          'Bluetooth Permission Required',
          `Please allow Nearby devices for this app.\n\nPath:\nSettings → Apps → ${APP_NAME} → Permissions → Nearby devices`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: openAppSettings },
          ]
        );
        return false;
      }
      console.log('[Permissions] Required Bluetooth permissions granted');
      return true;
    } else {
      // For Android 11 and below
      console.log('[Permissions] Android 11 or below, requesting FINE_LOCATION');
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        {
          title: 'Location Permission',
          message: 'Bluetooth scanning requires location permission on older Android versions.',
          buttonNeutral: 'Ask Me Later',
          buttonNegative: 'Cancel',
          buttonPositive: 'OK',
        }
      );
      const result = granted === PermissionsAndroid.RESULTS.GRANTED;
      console.log('[Permissions] Location permission result:', result);
      if (!result) {
        Alert.alert(
          'Location Permission Required',
          `Bluetooth scanning on Android ${Platform.Version} requires Location permission.\n\nPath:\nSettings → Apps → ${APP_NAME} → Permissions → Location`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: openAppSettings },
          ]
        );
      }
      return result;
    }
  } catch (err) {
    console.error('[Permissions] Error:', err);
    Alert.alert(
      'Permission Error',
      `Could not complete Bluetooth permission check.\n\nPath:\nSettings → Apps → ${APP_NAME} → Permissions`,
      [{ text: 'OK' }]
    );
    return false;
  }
};

type RootStackParamList = {
  Orders: undefined;
  OrderDetail: { orderId: string };
  Settings: undefined;
};

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Settings'>;

interface PrinterDevice {
  device_name: string;
  inner_mac_address: string;
}

const POLL_INTERVALS = [
  { value: 3000, label: '3 seconds (fast)' },
  { value: 5000, label: '5 seconds (normal)' },
  { value: 10000, label: '10 seconds (slow)' },
  { value: 30000, label: '30 seconds (battery saver)' },
];

const PRINT_TYPES = [
  { value: 'kitchen', label: '🍳 Kitchen Ticket Only', description: 'Large text for cooks - no prices' },
  { value: 'receipt', label: '🧾 Customer Receipt Only', description: 'Full receipt with prices' },
  { value: 'both', label: '🖨️ Both Tickets', description: 'Print kitchen ticket + customer receipt' },
] as const;

const VIEW_MODES = [
  { value: 'two', label: '2 Columns', description: 'New / Completed' },
  { value: 'three', label: '3 Columns', description: 'New / Active / Completed' },
  { value: 'four', label: '4 Columns', description: 'New / Active / Ready / Completed' },
] as const;

const NOTIFICATION_TONES: Array<{
  value: NotificationTone;
  label: string;
  description: string;
}> = [
  {
    value: 'default',
    label: 'Default Alert',
    description: 'Current standard tablet alert',
  },
  {
    value: 'submarine_sonar',
    label: 'Submarine Sonar',
    description: 'Deep repeating sonar ping',
  },
  {
    value: 'rotary_phone',
    label: 'Rotary Phone Ring',
    description: 'Old-school analog phone ring',
  },
  {
    value: 'clown_horn',
    label: 'Clown Horn',
    description: 'New horn alert from Downloads',
  },
];

export const SettingsScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const { width, height } = useWindowDimensions();
  const {
    settings,
    updateSettings,
    logout,
    auth,
    offline,
    orders,
    clearCompletedColumnNow,
    resetCompletedColumnClear,
  } = useStore();
  const { theme, themeMode, toggleTheme } = useTheme();
  const isDarkMode = themeMode === 'dark';
  const styles = useMemo(() => createStyles(theme, isDarkMode), [theme, isDarkMode]);
  const dividerStyle = useMemo(
    () => ({ borderTopWidth: 1, borderTopColor: theme.cardBorder as string }),
    [theme.cardBorder]
  );
  const appearanceTrackColor = useMemo(
    () => ({ false: isDarkMode ? '#0f3460' : '#d1d5db', true: '#FF8A65' }),
    [isDarkMode]
  );
  const defaultTrackColor = useMemo(
    () => ({ false: isDarkMode ? '#374151' : '#d1d5db', true: '#10b981' }),
    [isDarkMode]
  );
  const serviceTrackColor = useMemo(
    () => ({ false: isDarkMode ? '#374151' : '#d1d5db', true: '#3b82f6' }),
    [isDarkMode]
  );
  const switchThumbOff = isDarkMode ? '#9ca3af' : '#f8fafc';
  const [showIntervalSelector, setShowIntervalSelector] = useState(false);
  const [showPrintTypeSelector, setShowPrintTypeSelector] = useState(false);
  const [showViewModeSelector, setShowViewModeSelector] = useState(false);
  const [showToneSelector, setShowToneSelector] = useState(false);
  const [showPrinterToneSelector, setShowPrinterToneSelector] = useState(false);

  const yellowMin = Math.max(1, settings.orderAgingYellowMin ?? 5);
  const redMin = Math.max(yellowMin + 1, settings.orderAgingRedMin ?? 10);
  const completedArchiveLimit = Math.max(1, settings.completedArchiveLimit ?? 50);
  const agingControlsDisabled = !settings.orderAgingEnabled;
  const ordersList = orders?.orders ?? [];
  const completedColumnStatusSet =
    settings.viewMode === 'four'
      ? new Set(['completed', 'cancelled'])
      : new Set(['ready', 'completed', 'cancelled']);
  const completedColumnOrderIds = ordersList
    .filter((order) => completedColumnStatusSet.has(order.status))
    .map((order) => order.id);
  const isLandscape = width > height;
  const contentMaxWidth = isLandscape
    ? Math.min(Math.max(width - 48, 780), 1200)
    : Math.min(Math.max(width - 24, 320), 720);

  const adjustYellow = (delta: number) => {
    const next = Math.max(1, Math.min(yellowMin + delta, redMin - 1));
    updateSettings({ orderAgingYellowMin: next });
  };

  const adjustRed = (delta: number) => {
    const next = Math.max(yellowMin + 1, redMin + delta);
    updateSettings({ orderAgingRedMin: next });
  };

  const adjustArchiveLimit = (delta: number) => {
    const next = Math.max(1, Math.min(completedArchiveLimit + delta, 200));
    updateSettings({ completedArchiveLimit: next });
  };
  const completedColumnClearedAt = settings.completedColumnClearedAt;
  const completedColumnClearedAtLabel = completedColumnClearedAt
    ? new Date(completedColumnClearedAt).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;

  const handleClearCompletedColumn = useCallback(() => {
    Alert.alert(
      'Clear Completed Column',
      `Hide ${completedColumnOrderIds.length} currently visible completed-column order(s) on this tablet?\n\nThis is local-only and does not change backend order data.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => clearCompletedColumnNow(completedColumnOrderIds),
        },
      ]
    );
  }, [clearCompletedColumnNow, completedColumnOrderIds]);

  const handleRestoreCompletedColumn = useCallback(() => {
    resetCompletedColumnClear();
  }, [resetCompletedColumnClear]);
  
  // Printer state
  const [isScanning, setIsScanning] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [discoveredPrinters, setDiscoveredPrinters] = useState<PrinterDevice[]>([]);
  const [showPrinterList, setShowPrinterList] = useState(false);
  
  // Restaurant service config state
  const [serviceConfig, setServiceConfig] = useState<TabletServiceConfig | null>(null);
  const [isLoadingServiceConfig, setIsLoadingServiceConfig] = useState(false);
  const [isUpdatingServiceConfig, setIsUpdatingServiceConfig] = useState(false);

  // Fetch service config on mount
  React.useEffect(() => {
    const fetchServiceConfig = async () => {
      if (!auth.isAuthenticated) return;

      setIsLoadingServiceConfig(true);
      try {
        const result = await apiClient.getTabletServiceConfig();
        if (result.success && result.data) {
          setServiceConfig(result.data);
        } else {
          console.warn('[Settings] Failed to fetch service config:', result.error);
        }
      } catch (error) {
        console.error('[Settings] Failed to fetch service config:', error);
      } finally {
        setIsLoadingServiceConfig(false);
      }
    };

    fetchServiceConfig();
  }, [auth.isAuthenticated]);

  const applyServiceConfigUpdate = useCallback(
    async (
      updates: Partial<
        Pick<
          TabletServiceConfig,
          | 'online_ordering_enabled'
          | 'has_delivery_enabled'
          | 'pickup_enabled'
          | 'takeout_time_minutes'
          | 'busy_mode_enabled'
          | 'busy_takeout_time_minutes'
          | 'twilio_call'
        >
      >
    ): Promise<boolean> => {
      if (!auth.isAuthenticated || isUpdatingServiceConfig || !serviceConfig) return false;

      const previousConfig = serviceConfig;
      setServiceConfig({ ...serviceConfig, ...updates });
      setIsUpdatingServiceConfig(true);

      try {
        const result = await apiClient.updateTabletServiceConfig(updates);
        if (result.success && result.data) {
          setServiceConfig(result.data);
          return true;
        }

        console.warn('[Settings] Service config update failed:', {
          updates,
          error: result.error,
        });
        setServiceConfig(previousConfig);
        Alert.alert('Update Failed', result.error || 'Could not update restaurant setting');
        return false;
      } catch (error) {
        console.error('[Settings] Service config update exception:', error);
        setServiceConfig(previousConfig);
        Alert.alert('Error', 'Failed to update restaurant setting');
        return false;
      } finally {
        setIsUpdatingServiceConfig(false);
      }
    },
    [auth.isAuthenticated, isUpdatingServiceConfig, serviceConfig]
  );

  const handleToggleDelivery = useCallback(
    async (newValue: boolean) => {
      await applyServiceConfigUpdate({ has_delivery_enabled: newValue });
    },
    [applyServiceConfigUpdate]
  );

  const handleToggleOnlineOrdering = useCallback(
    (newValue: boolean) => {
      if (newValue) {
        applyServiceConfigUpdate({ online_ordering_enabled: true });
        return;
      }

      Alert.alert(
        'Pause Online Ordering?',
        'Customers will not be able to place new online orders until you turn it back on.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Pause Ordering',
            style: 'destructive',
            onPress: () => {
              applyServiceConfigUpdate({ online_ordering_enabled: false });
            },
          },
        ]
      );
    },
    [applyServiceConfigUpdate]
  );

  const handleTogglePickup = useCallback(
    async (newValue: boolean) => {
      await applyServiceConfigUpdate({ pickup_enabled: newValue });
    },
    [applyServiceConfigUpdate]
  );

  const handleToggleBusyMode = useCallback(
    async (newValue: boolean) => {
      await applyServiceConfigUpdate({ busy_mode_enabled: newValue });
    },
    [applyServiceConfigUpdate]
  );

  const handleToggleTwilioFallback = useCallback(
    async (newValue: boolean) => {
      await applyServiceConfigUpdate({ twilio_call: newValue });
    },
    [applyServiceConfigUpdate]
  );

  const adjustTakeoutPrep = useCallback(
    async (delta: number) => {
      if (!serviceConfig) return;
      const current = serviceConfig.takeout_time_minutes ?? 15;
      const next = Math.max(0, Math.min(240, current + delta));
      if (next === current) return;
      await applyServiceConfigUpdate({ takeout_time_minutes: next });
    },
    [applyServiceConfigUpdate, serviceConfig]
  );

  const adjustBusyPrep = useCallback(
    async (delta: number) => {
      if (!serviceConfig) return;
      const fallbackBusyPrep = Math.max((serviceConfig.takeout_time_minutes ?? 15) + 10, 30);
      const current = serviceConfig.busy_takeout_time_minutes ?? fallbackBusyPrep;
      const next = Math.max(0, Math.min(240, current + delta));
      if (next === current) return;
      await applyServiceConfigUpdate({ busy_takeout_time_minutes: next });
    },
    [applyServiceConfigUpdate, serviceConfig]
  );

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

  const handleScanPrinters = useCallback(async () => {
    console.log('[Settings] 🔵 SCAN BUTTON PRESSED');
    
    // Request Bluetooth permissions first
    const hasPermission = await requestBluetoothPermissions();
    if (!hasPermission) {
      console.log('[Settings] Bluetooth permission denied');
      return;
    }
    
    setIsScanning(true);
    setShowPrinterList(true);
    setDiscoveredPrinters([]);
    
    try {
      console.log('[Settings] Scanning for Bluetooth printers...');
      const printers = await discoverPrinters();
      console.log('[Settings] Found printers:', printers);
      setDiscoveredPrinters(printers);
      
      if (printers.length === 0) {
        Alert.alert(
          'No Printers Found',
          'Make sure your Bluetooth printer is:\n\n• Powered on\n• In pairing mode\n• Paired with this tablet in Bluetooth settings',
          [{ text: 'OK' }]
        );
      }
    } catch (error: any) {
      console.error('[Settings] Scan error:', error);
      Alert.alert('Scan Error', error.message || 'Failed to scan for printers');
    } finally {
      setIsScanning(false);
    }
  }, []);

  const handleConnectPrinter = useCallback(async (printer: PrinterDevice) => {
    setIsConnecting(true);
    
    try {
      console.log(`[Settings] Connecting to ${printer.device_name}...`);
      const success = await connectPrinter(printer.inner_mac_address);
      
      if (success) {
        updateSettings({ 
          printerConnected: true, 
          printerName: printer.device_name,
          printerMacAddress: printer.inner_mac_address, // Save for auto-reconnect
        });
        Alert.alert('✓ Connected!', `Successfully connected to ${printer.device_name}\n\nThis printer will auto-reconnect on app restart.`);
        setShowPrinterList(false);
      } else {
        Alert.alert('Connection Failed', 'Could not connect to printer. Please try again.');
      }
    } catch (error: any) {
      console.error('[Settings] Connect error:', error);
      Alert.alert('Connection Error', error.message || 'Failed to connect to printer');
    } finally {
      setIsConnecting(false);
    }
  }, [updateSettings]);

  const handleDisconnectPrinter = useCallback(async () => {
    try {
      await disconnectPrinter();
      updateSettings({ 
        printerConnected: false, 
        printerName: null 
      });
      Alert.alert('Disconnected', 'Printer has been disconnected');
    } catch (error: any) {
      console.error('[Settings] Disconnect error:', error);
    }
  }, [updateSettings]);

  const handleTestPrint = useCallback(async () => {
    console.log('[Settings] 🧪 Test print button pressed');
    console.log('[Settings] Current state - printerConnected:', settings.printerConnected, 'MAC:', settings.printerMacAddress);
    
    if (!settings.printerMacAddress) {
      Alert.alert('No Printer', 'Please scan and connect a printer first');
      return;
    }

    Alert.alert(
      'Test Print',
      `This will print a test receipt.\n\nPrinter: ${settings.printerName || 'Unknown'}\nMAC: ${settings.printerMacAddress}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Print Test',
          onPress: async () => {
            try {
              // First verify the connection is actually active
              console.log('[Settings] 🔗 Step 1: Ensuring connection to', settings.printerMacAddress);
              const isConnected = await ensureConnected(settings.printerMacAddress!);
              console.log('[Settings] Connection result:', isConnected);
              
              if (!isConnected) {
                console.log('[Settings] ❌ Connection verification failed');
                updateSettings({ printerConnected: false });
                Alert.alert(
                  'Connection Failed', 
                  `Could not connect to printer.\n\nMAC: ${settings.printerMacAddress}\n\nMake sure the printer is:\n• Powered on\n• Paired in Bluetooth settings\n• Within range`,
                  [{ text: 'OK' }]
                );
                return;
              }
              
              // Update UI to show connected
              updateSettings({ printerConnected: true });
              
              console.log('[Settings] ✓ Step 2: Sending test print...');
              const success = await printTestReceipt();
              console.log('[Settings] Test print result:', success);
              
              if (success) {
                Alert.alert('✓ Success', 'Test receipt sent to printer!\n\nIf nothing printed, check the printer has paper and is ready.');
              } else {
                updateSettings({ printerConnected: false });
                Alert.alert('Print Failed', 'Print command failed. The printer may have disconnected.\n\nTry disconnecting and reconnecting the printer.');
              }
            } catch (error: any) {
              console.error('[Settings] Test print error:', error);
              updateSettings({ printerConnected: false });
              Alert.alert('Print Error', `${error.message || 'Unknown error'}\n\nTry reconnecting the printer.`);
            }
          },
        },
      ]
    );
  }, [settings.printerConnected, settings.printerMacAddress, settings.printerName, updateSettings]);

  const playTonePreview = useCallback(async (tone: NotificationTone) => {
    try {
      await initSound();
      await playAlert(tone, { interruptExisting: true, maxDurationMs: 3200 });
    } catch (error: any) {
      Alert.alert('Sound Test Failed', error?.message || 'Could not play alert tone');
    }
  }, []);

  const handleTestNotificationTone = useCallback(async () => {
    await playTonePreview(settings.notificationTone ?? 'default');
  }, [playTonePreview, settings.notificationTone]);

  const handleTestPrinterAlertTone = useCallback(async () => {
    await playTonePreview(settings.printerAlertTone ?? settings.notificationTone ?? 'default');
  }, [playTonePreview, settings.notificationTone, settings.printerAlertTone]);

  const selectedInterval = POLL_INTERVALS.find((i) => i.value === settings.pollIntervalMs);
  const selectedNotificationTone =
    NOTIFICATION_TONES.find((tone) => tone.value === settings.notificationTone) ??
    NOTIFICATION_TONES[0];
  const selectedPrinterAlertTone =
    NOTIFICATION_TONES.find((tone) => tone.value === settings.printerAlertTone) ??
    selectedNotificationTone;

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

      <ScrollView
        style={styles.content}
        contentContainerStyle={[styles.contentContainer, { maxWidth: contentMaxWidth }]}
      >
        {/* Printer Section - MOST IMPORTANT */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🖨️ Printer Connection</Text>
          <View style={styles.card}>
            {/* Current Printer Status */}
            <View style={styles.printerStatusRow}>
              <View style={styles.printerStatusInfo}>
                <Text style={styles.printerStatusLabel}>
                  {settings.printerConnected ? settings.printerName : 'No Printer Connected'}
                </Text>
                <Text style={styles.printerStatusSubtext}>
                  {settings.printerConnected 
                    ? '✓ Ready to print' 
                    : 'Tap "Scan for Printers" to connect'}
                </Text>
              </View>
              <View style={[
                styles.statusBadge,
                { backgroundColor: settings.printerConnected ? '#22c55e' : '#ef4444' }
              ]}>
                <Text style={styles.statusBadgeText}>
                  {settings.printerConnected ? 'CONNECTED' : 'OFFLINE'}
                </Text>
              </View>
            </View>

            {/* Scan Button */}
            <TouchableOpacity 
              style={styles.scanButton}
              onPress={handleScanPrinters}
              disabled={isScanning}
            >
              {isScanning ? (
                <>
                  <ActivityIndicator color="#fff" size="small" />
                  <Text style={styles.scanButtonText}>Scanning...</Text>
                </>
              ) : (
                <>
                  <Text style={styles.scanButtonIcon}>📡</Text>
                  <Text style={styles.scanButtonText}>Scan for Printers</Text>
                </>
              )}
            </TouchableOpacity>

            {/* Discovered Printers List */}
            {showPrinterList && (
              <View style={styles.printerList}>
                <Text style={styles.printerListTitle}>
                  {discoveredPrinters.length > 0 
                    ? `Found ${discoveredPrinters.length} Printer(s):` 
                    : 'Scanning...'}
                </Text>
                
                {discoveredPrinters.map((printer, index) => (
                  <TouchableOpacity
                    key={printer.inner_mac_address || index}
                    style={styles.printerItem}
                    onPress={() => handleConnectPrinter(printer)}
                    disabled={isConnecting}
                  >
                    <View style={styles.printerItemInfo}>
                      <Text style={styles.printerItemName}>
                        {printer.device_name || 'Unknown Printer'}
                      </Text>
                      <Text style={styles.printerItemMac}>
                        {printer.inner_mac_address}
                      </Text>
                    </View>
                    {isConnecting ? (
                      <ActivityIndicator size="small" color="#4CAF50" />
                    ) : (
                      <Text style={styles.connectText}>Connect →</Text>
                    )}
                  </TouchableOpacity>
                ))}

                {!isScanning && discoveredPrinters.length === 0 && (
                  <Text style={styles.noPrintersText}>
                    No printers found. Make sure your printer is powered on and paired.
                  </Text>
                )}
              </View>
            )}

            {/* Action Buttons */}
            {settings.printerConnected && (
              <View style={styles.printerActions}>
                <TouchableOpacity 
                  style={styles.testPrintButton}
                  onPress={handleTestPrint}
                >
                  <Text style={styles.testPrintText}>🖨️ Test Print</Text>
                </TouchableOpacity>
                
                <TouchableOpacity 
                  style={styles.disconnectButton}
                  onPress={handleDisconnectPrinter}
                >
                  <Text style={styles.disconnectText}>Disconnect</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>

        {/* Theme Setting */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Appearance</Text>
          <View style={styles.card}>
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>
                  {themeMode === 'dark' ? '🌙 Dark Mode' : '☀️ Light Mode'}
                </Text>
                <Text style={styles.settingDescription}>
                  Switch between dark and light themes
                </Text>
              </View>
              <Switch
                value={themeMode === 'light'}
                onValueChange={toggleTheme}
                trackColor={appearanceTrackColor}
                thumbColor={themeMode === 'light' ? '#FF5722' : '#e94560'}
              />
            </View>

            {/* Workflow View Selector */}
            <TouchableOpacity
              style={[styles.settingRowTouchable, dividerStyle]}
              onPress={() => setShowViewModeSelector(!showViewModeSelector)}
              testID="settings-view-mode"
              nativeID="settings-view-mode"
            >
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>📋 Workflow View</Text>
                <Text style={styles.settingDescription}>
                  {VIEW_MODES.find(mode => mode.value === (settings.viewMode ?? 'three'))?.label || '3 Columns'}
                </Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>

            {showViewModeSelector && (
              <View style={styles.selectorContainer}>
                {VIEW_MODES.map((mode) => (
                  <TouchableOpacity
                    key={mode.value}
                    style={[
                      styles.selectorOption,
                      (settings.viewMode ?? 'three') === mode.value && styles.selectorOptionSelected,
                    ]}
                    onPress={() => {
                      updateSettings({ viewMode: mode.value });
                      setShowViewModeSelector(false);
                    }}
                    testID={`settings-view-mode-${mode.value}`}
                    nativeID={`settings-view-mode-${mode.value}`}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.selectorOptionLabel}>{mode.label}</Text>
                      <Text style={[styles.settingDescription, { marginTop: 2 }]}>{mode.description}</Text>
                    </View>
                    {(settings.viewMode ?? 'three') === mode.value && (
                      <Text style={styles.checkmark}>✓</Text>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Completed Archive Limit */}
            <View style={[styles.settingRow, dividerStyle]}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>✅ Completed Archive Limit</Text>
                <Text style={styles.settingDescription}>
                  Show last {completedArchiveLimit} completed orders (older go to Recall)
                </Text>
              </View>
              <View style={styles.stepper}>
                <TouchableOpacity
                  style={styles.stepperButton}
                  onPress={() => adjustArchiveLimit(-1)}
                  onLongPress={() => adjustArchiveLimit(-10)}
                  delayLongPress={250}
                  testID="settings-archive-limit-decrease"
                  nativeID="settings-archive-limit-decrease"
                >
                  <Text style={styles.stepperButtonText}>-</Text>
                </TouchableOpacity>
                <Text style={styles.stepperValue} testID="settings-archive-limit-value" nativeID="settings-archive-limit-value">
                  {completedArchiveLimit}
                </Text>
                <TouchableOpacity
                  style={styles.stepperButton}
                  onPress={() => adjustArchiveLimit(1)}
                  onLongPress={() => adjustArchiveLimit(10)}
                  delayLongPress={250}
                  testID="settings-archive-limit-increase"
                  nativeID="settings-archive-limit-increase"
                >
                  <Text style={styles.stepperButtonText}>+</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={[styles.completedFlushSection, dividerStyle]}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>🧹 Completed Column Flush</Text>
                <Text style={styles.settingDescription}>
                  Hide completed-column orders locally on this tablet only.
                </Text>
                <Text style={styles.settingDescription}>
                  Backend order data is not changed.
                </Text>
                {completedColumnClearedAtLabel && (
                  <Text style={styles.completedFlushMeta}>
                    Last cleared: {completedColumnClearedAtLabel}
                  </Text>
                )}
              </View>
              <View style={styles.completedFlushActions}>
                <TouchableOpacity
                  style={styles.clearCompletedButton}
                  onPress={handleClearCompletedColumn}
                >
                  <Text style={styles.clearCompletedButtonText}>🧹 Clear Completed Column</Text>
                </TouchableOpacity>
                {completedColumnClearedAt && (
                  <TouchableOpacity
                    style={styles.restoreCompletedButton}
                    onPress={handleRestoreCompletedColumn}
                  >
                    <Text style={styles.restoreCompletedButtonText}>↩ Show Cleared Orders Again</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>
        </View>

        {/* Auto-Print Setting */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Printing Options</Text>
          <View style={styles.card}>
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Auto-Print New Orders</Text>
                <Text style={styles.settingDescription}>
                  Automatically print orders when they arrive
                </Text>
              </View>
              <Switch
                value={settings.autoPrint}
                onValueChange={(value) => updateSettings({ autoPrint: value })}
                trackColor={defaultTrackColor}
                thumbColor={settings.autoPrint ? '#fff' : switchThumbOff}
              />
            </View>

            {/* Ring Until Accepted Toggle */}
            <View style={[styles.settingRow, dividerStyle]}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>🔔 Ring Until Accepted</Text>
                <Text style={styles.settingDescription}>
                  Repeat alerts every 15s until order is accepted
                </Text>
              </View>
              <Switch
                value={settings.ringUntilAccepted ?? false}
                onValueChange={(value) => updateSettings({ ringUntilAccepted: value })}
                trackColor={defaultTrackColor}
                thumbColor={settings.ringUntilAccepted ? '#fff' : switchThumbOff}
              />
            </View>

            <View style={[styles.settingRow, dividerStyle]}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>⏩ Auto-Move Accepted to Active</Text>
                <Text style={styles.settingDescription}>
                  When ON, tapping Accept also moves the order to Active
                </Text>
              </View>
              <Switch
                value={settings.autoProgressAcceptedOrders ?? false}
                onValueChange={(value) =>
                  updateSettings({ autoProgressAcceptedOrders: value })
                }
                trackColor={defaultTrackColor}
                thumbColor={settings.autoProgressAcceptedOrders ? '#fff' : switchThumbOff}
              />
            </View>

            <TouchableOpacity
              style={[styles.settingRowTouchable, dividerStyle]}
              onPress={() => setShowToneSelector(!showToneSelector)}
              testID="settings-notification-tone"
              nativeID="settings-notification-tone"
            >
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>🎵 New Order Ringtone</Text>
                <Text style={styles.settingDescription}>
                  {selectedNotificationTone.label}
                </Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>

            {showToneSelector && (
              <View style={styles.selectorContainer}>
                {NOTIFICATION_TONES.map((tone) => (
                  <TouchableOpacity
                    key={tone.value}
                    style={[
                      styles.selectorOption,
                      (settings.notificationTone ?? 'default') === tone.value &&
                        styles.selectorOptionSelected,
                    ]}
                    onPress={() => {
                      updateSettings({ notificationTone: tone.value });
                      void playTonePreview(tone.value);
                    }}
                    testID={`settings-tone-${tone.value}`}
                    nativeID={`settings-tone-${tone.value}`}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.selectorOptionLabel}>{tone.label}</Text>
                      <Text style={[styles.settingDescription, { marginTop: 2 }]}>
                        {tone.description}
                      </Text>
                    </View>
                    {(settings.notificationTone ?? 'default') === tone.value && (
                      <Text style={styles.checkmark}>✓</Text>
                    )}
                  </TouchableOpacity>
                ))}
                <View style={styles.tonePreviewRow}>
                  <TouchableOpacity
                    style={styles.tonePreviewButton}
                    onPress={handleTestNotificationTone}
                  >
                    <Text style={styles.tonePreviewButtonText}>▶ Test Ringtone</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.toneCloseButton}
                    onPress={() => setShowToneSelector(false)}
                  >
                    <Text style={styles.toneCloseButtonText}>Done</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <TouchableOpacity
              style={[styles.settingRowTouchable, dividerStyle]}
              onPress={() => setShowPrinterToneSelector(!showPrinterToneSelector)}
              testID="settings-printer-alert-tone"
              nativeID="settings-printer-alert-tone"
            >
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>🖨️ Printer Alert Sound</Text>
                <Text style={styles.settingDescription}>
                  {selectedPrinterAlertTone.label}
                </Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>

            {showPrinterToneSelector && (
              <View style={styles.selectorContainer}>
                {NOTIFICATION_TONES.map((tone) => (
                  <TouchableOpacity
                    key={`printer-${tone.value}`}
                    style={[
                      styles.selectorOption,
                      (settings.printerAlertTone ?? settings.notificationTone ?? 'default') === tone.value &&
                        styles.selectorOptionSelected,
                    ]}
                    onPress={() => {
                      updateSettings({ printerAlertTone: tone.value });
                      void playTonePreview(tone.value);
                    }}
                    testID={`settings-printer-tone-${tone.value}`}
                    nativeID={`settings-printer-tone-${tone.value}`}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.selectorOptionLabel}>{tone.label}</Text>
                      <Text style={[styles.settingDescription, { marginTop: 2 }]}>
                        {tone.description}
                      </Text>
                    </View>
                    {(settings.printerAlertTone ?? settings.notificationTone ?? 'default') === tone.value && (
                      <Text style={styles.checkmark}>✓</Text>
                    )}
                  </TouchableOpacity>
                ))}
                <View style={styles.tonePreviewRow}>
                  <TouchableOpacity
                    style={styles.tonePreviewButton}
                    onPress={handleTestPrinterAlertTone}
                  >
                    <Text style={styles.tonePreviewButtonText}>▶ Test Printer Alert</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.toneCloseButton}
                    onPress={() => setShowPrinterToneSelector(false)}
                  >
                    <Text style={styles.toneCloseButtonText}>Done</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Printer Alerts Toggle */}
            <View style={[styles.settingRow, dividerStyle]}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>🔔 Printer Alerts</Text>
                <Text style={styles.settingDescription}>
                  Sound + vibration when orders can't print
                </Text>
              </View>
              <Switch
                value={settings.printerAlertsEnabled ?? true}
                onValueChange={(value) => updateSettings({ printerAlertsEnabled: value })}
                trackColor={{ false: isDarkMode ? '#374151' : '#d1d5db', true: '#f59e0b' }}
                thumbColor={settings.printerAlertsEnabled ?? true ? '#fff' : switchThumbOff}
              />
            </View>

            {/* Expanded View Prices Toggle */}
            <View style={[styles.settingRow, dividerStyle]}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>💲 Show Prices In Expanded View</Text>
                <Text style={styles.settingDescription}>
                  Include item + modifier prices when an order is expanded
                </Text>
              </View>
              <Switch
                value={settings.showPricesInExpanded ?? false}
                onValueChange={(value) => updateSettings({ showPricesInExpanded: value })}
                trackColor={defaultTrackColor}
                thumbColor={settings.showPricesInExpanded ? '#fff' : switchThumbOff}
              />
            </View>

            {/* Auto-show prices when no printer */}
            <View style={[styles.settingRow, dividerStyle]}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Auto-Show Prices (No Printer)</Text>
                <Text style={styles.settingDescription}>
                  If no printer is connected, show prices automatically
                </Text>
              </View>
              <Switch
                value={settings.autoShowPricesWhenNoPrinter ?? true}
                onValueChange={(value) => updateSettings({ autoShowPricesWhenNoPrinter: value })}
                trackColor={defaultTrackColor}
                thumbColor={(settings.autoShowPricesWhenNoPrinter ?? true) ? '#fff' : switchThumbOff}
              />
            </View>

            {/* Order Aging Colors Toggle */}
            <View style={[styles.settingRow, dividerStyle]}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>🎨 Order Aging Colors</Text>
                <Text style={styles.settingDescription}>
                  Orders turn yellow ({yellowMin}m) → red ({redMin}m)
                </Text>
              </View>
              <Switch
                value={settings.orderAgingEnabled ?? false}
                onValueChange={(value) => updateSettings({ orderAgingEnabled: value })}
                trackColor={defaultTrackColor}
                thumbColor={settings.orderAgingEnabled ? '#fff' : switchThumbOff}
              />
            </View>

            {/* Aging Thresholds */}
            <View
              style={[
                styles.settingRow,
                dividerStyle,
                agingControlsDisabled && { opacity: 0.5 },
              ]}
              pointerEvents={agingControlsDisabled ? 'none' : 'auto'}
            >
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Yellow After</Text>
                <Text style={styles.settingDescription}>Minutes before warning</Text>
              </View>
              <View style={styles.stepper}>
                <TouchableOpacity
                  style={styles.stepperButton}
                  onPress={() => adjustYellow(-1)}
                  onLongPress={() => adjustYellow(-5)}
                  delayLongPress={250}
                >
                  <Text style={styles.stepperButtonText}>-</Text>
                </TouchableOpacity>
                <Text style={styles.stepperValue}>{yellowMin}m</Text>
                <TouchableOpacity
                  style={styles.stepperButton}
                  onPress={() => adjustYellow(1)}
                  onLongPress={() => adjustYellow(5)}
                  delayLongPress={250}
                >
                  <Text style={styles.stepperButtonText}>+</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View
              style={[
                styles.settingRow,
                dividerStyle,
                agingControlsDisabled && { opacity: 0.5 },
              ]}
              pointerEvents={agingControlsDisabled ? 'none' : 'auto'}
            >
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Red After</Text>
                <Text style={styles.settingDescription}>Minutes before critical</Text>
              </View>
              <View style={styles.stepper}>
                <TouchableOpacity
                  style={styles.stepperButton}
                  onPress={() => adjustRed(-1)}
                  onLongPress={() => adjustRed(-5)}
                  delayLongPress={250}
                >
                  <Text style={styles.stepperButtonText}>-</Text>
                </TouchableOpacity>
                <Text style={styles.stepperValue}>{redMin}m</Text>
                <TouchableOpacity
                  style={styles.stepperButton}
                  onPress={() => adjustRed(1)}
                  onLongPress={() => adjustRed(5)}
                  delayLongPress={250}
                >
                  <Text style={styles.stepperButtonText}>+</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Default Print Type Selector */}
            <TouchableOpacity
              style={[styles.settingRowTouchable, dividerStyle]}
              onPress={() => setShowPrintTypeSelector(!showPrintTypeSelector)}
            >
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Default Print Type</Text>
                <Text style={styles.settingDescription}>
                  {PRINT_TYPES.find(t => t.value === settings.defaultPrintType)?.label || '🍳 Kitchen Ticket Only'}
                </Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
            
            {showPrintTypeSelector && (
              <View style={styles.selectorContainer}>
                {PRINT_TYPES.map((type) => (
                  <TouchableOpacity
                    key={type.value}
                    style={[
                      styles.selectorOption,
                      settings.defaultPrintType === type.value && styles.selectorOptionSelected,
                    ]}
                    onPress={() => {
                      updateSettings({ defaultPrintType: type.value });
                      setShowPrintTypeSelector(false);
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.selectorOptionLabel}>{type.label}</Text>
                      <Text style={[styles.settingDescription, { marginTop: 2 }]}>{type.description}</Text>
                    </View>
                    {settings.defaultPrintType === type.value && (
                      <Text style={styles.checkmark}>✓</Text>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        </View>

        {/* Restaurant Settings Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🏪 Restaurant Settings</Text>
          <View style={styles.card}>
            {isLoadingServiceConfig ? (
              <View style={styles.settingRow}>
                <ActivityIndicator size="small" color={theme.primary} />
              </View>
            ) : !serviceConfig ? (
              <View style={styles.settingRow}>
                <Text style={styles.serviceUnavailableText}>Service settings unavailable</Text>
              </View>
            ) : (
              <>
                <View style={styles.settingRow}>
                  <View style={styles.settingInfo}>
                    <Text style={styles.settingLabel}>🟢 Online Ordering</Text>
                    <Text style={styles.settingDescription}>
                      Master switch for accepting new online orders
                    </Text>
                  </View>
                  <Switch
                    value={serviceConfig.online_ordering_enabled}
                    onValueChange={handleToggleOnlineOrdering}
                    disabled={isUpdatingServiceConfig}
                    trackColor={serviceTrackColor}
                    thumbColor={serviceConfig.online_ordering_enabled ? '#fff' : switchThumbOff}
                    testID="settings-online-ordering-switch"
                    nativeID="settings-online-ordering-switch"
                  />
                </View>

                <View style={[styles.settingRow, dividerStyle]}>
                  <View style={styles.settingInfo}>
                    <Text style={styles.settingLabel}>🚗 Delivery Service</Text>
                    <Text style={styles.settingDescription}>
                      Allow customers to order for delivery
                    </Text>
                  </View>
                  <Switch
                    value={serviceConfig.has_delivery_enabled}
                    onValueChange={handleToggleDelivery}
                    disabled={isUpdatingServiceConfig}
                    trackColor={serviceTrackColor}
                    thumbColor={serviceConfig.has_delivery_enabled ? '#fff' : switchThumbOff}
                    testID="settings-delivery-switch"
                    nativeID="settings-delivery-switch"
                  />
                </View>

                <View style={[styles.settingRow, dividerStyle]}>
                  <View style={styles.settingInfo}>
                    <Text style={styles.settingLabel}>🛍️ Pickup Service</Text>
                    <Text style={styles.settingDescription}>
                      Allow customers to order for pickup
                    </Text>
                  </View>
                  <Switch
                    value={serviceConfig.pickup_enabled}
                    onValueChange={handleTogglePickup}
                    disabled={isUpdatingServiceConfig}
                    trackColor={serviceTrackColor}
                    thumbColor={serviceConfig.pickup_enabled ? '#fff' : switchThumbOff}
                    testID="settings-pickup-switch"
                    nativeID="settings-pickup-switch"
                  />
                </View>

                {serviceConfig.pickup_enabled && (
                  <View style={[styles.settingRow, dividerStyle]}>
                    <View style={styles.settingInfo}>
                      <Text style={styles.settingLabel}>⏱️ Pickup Prep Time</Text>
                      <Text style={styles.settingDescription}>
                        Minutes shown to customers for pickup
                      </Text>
                    </View>
                    <View style={styles.stepper}>
                      <TouchableOpacity
                        style={[styles.stepperButton, isUpdatingServiceConfig && { opacity: 0.4 }]}
                        onPress={() => adjustTakeoutPrep(-1)}
                        disabled={isUpdatingServiceConfig}
                      >
                        <Text style={styles.stepperButtonText}>-</Text>
                      </TouchableOpacity>
                      <Text style={styles.stepperValue}>{serviceConfig.takeout_time_minutes ?? 15}m</Text>
                      <TouchableOpacity
                        style={[styles.stepperButton, isUpdatingServiceConfig && { opacity: 0.4 }]}
                        onPress={() => adjustTakeoutPrep(1)}
                        disabled={isUpdatingServiceConfig}
                      >
                        <Text style={styles.stepperButtonText}>+</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

                <View style={[styles.settingRow, dividerStyle]}>
                  <View style={styles.settingInfo}>
                    <Text style={styles.settingLabel}>⚡ Smart Busy Mode</Text>
                    <Text style={styles.settingDescription}>
                      Use a longer prep time during busy periods
                    </Text>
                  </View>
                  <Switch
                    value={serviceConfig.busy_mode_enabled}
                    onValueChange={handleToggleBusyMode}
                    disabled={isUpdatingServiceConfig}
                    trackColor={serviceTrackColor}
                    thumbColor={serviceConfig.busy_mode_enabled ? '#fff' : switchThumbOff}
                    testID="settings-busy-mode-switch"
                    nativeID="settings-busy-mode-switch"
                  />
                </View>

                {serviceConfig.busy_mode_enabled && (
                  <View style={[styles.settingRow, dividerStyle]}>
                    <View style={styles.settingInfo}>
                      <Text style={styles.settingLabel}>⏱️ Busy Prep Time</Text>
                      <Text style={styles.settingDescription}>
                        Minutes shown during busy mode
                      </Text>
                    </View>
                    <View style={styles.stepper}>
                      <TouchableOpacity
                        style={[styles.stepperButton, isUpdatingServiceConfig && { opacity: 0.4 }]}
                        onPress={() => adjustBusyPrep(-1)}
                        disabled={isUpdatingServiceConfig}
                      >
                        <Text style={styles.stepperButtonText}>-</Text>
                      </TouchableOpacity>
                      <Text style={styles.stepperValue}>
                        {serviceConfig.busy_takeout_time_minutes ??
                          Math.max((serviceConfig.takeout_time_minutes ?? 15) + 10, 30)}
                        m
                      </Text>
                      <TouchableOpacity
                        style={[styles.stepperButton, isUpdatingServiceConfig && { opacity: 0.4 }]}
                        onPress={() => adjustBusyPrep(1)}
                        disabled={isUpdatingServiceConfig}
                      >
                        <Text style={styles.stepperButtonText}>+</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

                <View style={[styles.settingRow, dividerStyle]}>
                  <View style={styles.settingInfo}>
                    <Text style={styles.settingLabel}>📞 Twilio Fallback Calls</Text>
                    <Text style={styles.settingDescription}>
                      Auto-call when orders are not acknowledged
                    </Text>
                  </View>
                  <Switch
                    value={serviceConfig.twilio_call}
                    onValueChange={handleToggleTwilioFallback}
                    disabled={isUpdatingServiceConfig}
                    trackColor={serviceTrackColor}
                    thumbColor={serviceConfig.twilio_call ? '#fff' : switchThumbOff}
                    testID="settings-twilio-fallback-switch"
                    nativeID="settings-twilio-fallback-switch"
                  />
                </View>

                <View style={styles.serviceStatusRow}>
                  <View
                    style={[
                      styles.serviceStatusBadge,
                      {
                        backgroundColor: serviceConfig.online_ordering_enabled
                          ? '#22c55e20'
                          : '#ef444420',
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.serviceStatusDot,
                        {
                          backgroundColor: serviceConfig.online_ordering_enabled
                            ? '#22c55e'
                            : '#ef4444',
                        },
                      ]}
                    />
                    <Text
                      style={[
                        styles.serviceStatusText,
                        {
                          color: serviceConfig.online_ordering_enabled
                            ? '#22c55e'
                            : '#ef4444',
                        },
                      ]}
                    >
                      {serviceConfig.online_ordering_enabled
                        ? 'Online Ordering is ACTIVE'
                        : 'Online Ordering is PAUSED'}
                    </Text>
                  </View>
                </View>
              </>
            )}
          </View>
        </View>

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
                    { backgroundColor: offline.isOnline ? '#22c55e' : '#ef4444' },
                  ]}
                />
                <Text style={styles.statusText}>
                  {offline.isOnline ? 'Online' : 'Offline'}
                </Text>
              </View>
            </View>
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
                  {selectedInterval?.label || '5 seconds'}
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
          <Text style={styles.versionText}>{`NEON v${APP_VERSION} (${APP_PACKAGE})`}</Text>
        </View>
      </ScrollView>
    </View>
  );
};

const createStyles = (theme: Theme, isDarkMode: boolean) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: theme.headerBg,
      padding: 16,
      borderBottomWidth: 2,
      borderBottomColor: theme.headerBorder,
    },
    backButton: {
      padding: 8,
      minWidth: 80,
    },
    backText: {
      fontSize: 16,
      color: isDarkMode ? '#22c55e' : '#15803d',
      fontWeight: '600',
    },
    headerTitle: {
      fontSize: 20,
      fontWeight: 'bold',
      color: theme.text,
    },
    placeholder: {
      minWidth: 80,
    },
    content: {
      flex: 1,
    },
    contentContainer: {
      padding: 20,
      alignSelf: 'center',
      width: '100%',
    },
    section: {
      marginBottom: 24,
    },
    sectionTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: theme.textSecondary,
      textTransform: 'uppercase',
      marginBottom: 10,
      marginLeft: 4,
      letterSpacing: 0.5,
    },
    card: {
      backgroundColor: theme.surface,
      borderRadius: 12,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: theme.cardBorder,
    },
    printerStatusRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: 16,
      borderBottomWidth: 1,
      borderBottomColor: theme.cardBorder,
    },
    printerStatusInfo: {
      flex: 1,
    },
    printerStatusLabel: {
      fontSize: 18,
      fontWeight: '600',
      color: theme.text,
      marginBottom: 4,
    },
    printerStatusSubtext: {
      fontSize: 14,
      color: theme.textSecondary,
    },
    statusBadge: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 16,
    },
    statusBadgeText: {
      color: '#fff',
      fontSize: 12,
      fontWeight: 'bold',
    },
    scanButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#3b82f6',
      padding: 16,
      margin: 16,
      borderRadius: 12,
    },
    scanButtonIcon: {
      fontSize: 20,
      marginRight: 10,
    },
    scanButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '600',
    },
    printerList: {
      padding: 16,
      paddingTop: 0,
    },
    printerListTitle: {
      fontSize: 14,
      color: theme.textSecondary,
      marginBottom: 12,
    },
    printerItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: isDarkMode ? '#1e293b' : '#f8fafc',
      padding: 16,
      borderRadius: 10,
      marginBottom: 8,
      borderWidth: 1,
      borderColor: theme.cardBorder,
    },
    printerItemInfo: {
      flex: 1,
    },
    printerItemName: {
      fontSize: 16,
      fontWeight: '600',
      color: theme.text,
      marginBottom: 4,
    },
    printerItemMac: {
      fontSize: 12,
      color: theme.textMuted,
      fontFamily: 'monospace',
    },
    connectText: {
      color: '#22c55e',
      fontWeight: '600',
      fontSize: 14,
    },
    noPrintersText: {
      color: theme.textMuted,
      textAlign: 'center',
      padding: 20,
      fontSize: 14,
    },
    printerActions: {
      flexDirection: 'row',
      padding: 16,
      paddingTop: 0,
      gap: 12,
    },
    testPrintButton: {
      flex: 1,
      backgroundColor: '#22c55e',
      padding: 14,
      borderRadius: 10,
      alignItems: 'center',
    },
    testPrintText: {
      color: '#fff',
      fontWeight: '600',
      fontSize: 15,
    },
    disconnectButton: {
      flex: 1,
      backgroundColor: isDarkMode ? '#374151' : '#e2e8f0',
      padding: 14,
      borderRadius: 10,
      alignItems: 'center',
    },
    disconnectText: {
      color: isDarkMode ? '#94a3b8' : '#334155',
      fontWeight: '600',
      fontSize: 15,
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
      color: theme.text,
      marginBottom: 4,
    },
    settingDescription: {
      fontSize: 14,
      color: theme.textSecondary,
    },
    serviceUnavailableText: {
      color: theme.textMuted,
      fontSize: 12,
    },
    stepper: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    stepperButton: {
      width: 32,
      height: 32,
      borderRadius: 8,
      backgroundColor: isDarkMode ? '#1f2937' : '#e2e8f0',
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepperButtonText: {
      color: theme.text,
      fontSize: 18,
      fontWeight: '700',
    },
    stepperValue: {
      color: theme.text,
      fontSize: 15,
      fontWeight: '600',
      marginHorizontal: 10,
      minWidth: 40,
      textAlign: 'center',
    },
    completedFlushSection: {
      padding: 16,
    },
    completedFlushMeta: {
      marginTop: 8,
      fontSize: 13,
      color: theme.textSecondary,
    },
    completedFlushActions: {
      marginTop: 12,
      gap: 10,
    },
    clearCompletedButton: {
      backgroundColor: '#b91c1c',
      borderRadius: 10,
      paddingVertical: 12,
      paddingHorizontal: 14,
      alignItems: 'center',
    },
    clearCompletedButtonText: {
      color: '#fff',
      fontSize: 14,
      fontWeight: '700',
    },
    restoreCompletedButton: {
      backgroundColor: isDarkMode ? '#1f2937' : '#f3f4f6',
      borderWidth: 1,
      borderColor: theme.cardBorder,
      borderRadius: 10,
      paddingVertical: 12,
      paddingHorizontal: 14,
      alignItems: 'center',
    },
    restoreCompletedButtonText: {
      color: theme.text,
      fontSize: 14,
      fontWeight: '600',
    },
    chevron: {
      fontSize: 24,
      color: theme.textMuted,
    },
    infoRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: 16,
      borderBottomWidth: 1,
      borderBottomColor: theme.cardBorder,
    },
    infoLabel: {
      fontSize: 15,
      color: theme.textSecondary,
    },
    infoValue: {
      fontSize: 15,
      fontWeight: '600',
      color: theme.text,
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
      color: theme.text,
    },
    selectorContainer: {
      backgroundColor: isDarkMode ? '#1e293b' : '#f8fafc',
      borderTopWidth: 1,
      borderTopColor: theme.cardBorder,
    },
    selectorOption: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 14,
      paddingHorizontal: 20,
      borderBottomWidth: 1,
      borderBottomColor: theme.cardBorder,
    },
    selectorOptionSelected: {
      backgroundColor: isDarkMode ? '#0f3460' : '#dbeafe',
    },
    selectorOptionLabel: {
      fontSize: 15,
      color: theme.text,
      flex: 1,
    },
    tonePreviewRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      padding: 12,
      paddingHorizontal: 16,
    },
    tonePreviewButton: {
      flex: 1,
      backgroundColor: isDarkMode ? '#0f766e' : '#0ea5e9',
      borderRadius: 10,
      paddingVertical: 10,
      alignItems: 'center',
    },
    tonePreviewButtonText: {
      color: '#fff',
      fontSize: 14,
      fontWeight: '700',
    },
    toneCloseButton: {
      minWidth: 88,
      backgroundColor: isDarkMode ? '#334155' : '#e2e8f0',
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    toneCloseButtonText: {
      color: theme.text,
      fontSize: 14,
      fontWeight: '700',
    },
    checkmark: {
      fontSize: 18,
      color: '#22c55e',
      fontWeight: 'bold',
    },
    serviceStatusRow: {
      paddingHorizontal: 16,
      paddingBottom: 16,
    },
    serviceStatusBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 8,
      alignSelf: 'flex-start',
    },
    serviceStatusDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      marginRight: 8,
    },
    serviceStatusText: {
      fontSize: 13,
      fontWeight: '600',
    },
    logoutButton: {
      backgroundColor: 'transparent',
      borderWidth: 2,
      borderColor: '#ef4444',
      borderRadius: 12,
      padding: 16,
      alignItems: 'center',
    },
    logoutButtonText: {
      fontSize: 16,
      fontWeight: '600',
      color: '#ef4444',
    },
    versionText: {
      textAlign: 'center',
      color: theme.textMuted,
      fontSize: 13,
      marginTop: 16,
    },
  });
