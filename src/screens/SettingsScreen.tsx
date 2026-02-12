import React, { useState, useCallback } from 'react';
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
} from 'react-native';
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
import { useTheme } from '../theme';
import { tabletGetDeliveryConfig, tabletUpdateDeliveryEnabled } from '../api/supabaseRpc';

// Request Bluetooth permissions for Android 12+
const requestBluetoothPermissions = async (): Promise<boolean> => {
  console.log('[Permissions] Starting permission request, Platform:', Platform.OS, 'Version:', Platform.Version);
  
  if (Platform.OS !== 'android') {
    console.log('[Permissions] Not Android, returning true');
    return true;
  }

  try {
    // For Android 12+ (API 31+)
    if (Platform.Version >= 31) {
      console.log('[Permissions] Android 12+, requesting BLUETOOTH_SCAN and BLUETOOTH_CONNECT');
      
      // Check if already granted first
      const scanStatus = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN);
      const connectStatus = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT);
      
      console.log('[Permissions] Current status - SCAN:', scanStatus, 'CONNECT:', connectStatus);
      
      if (scanStatus && connectStatus) {
        console.log('[Permissions] Already granted!');
        return true;
      }

      const permissions = [
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      ];

      console.log('[Permissions] Calling requestMultiple...');
      
      // Add timeout to prevent hanging if Expo Go doesn't support these permissions
      const timeoutPromise = new Promise<any>((_, reject) => 
        setTimeout(() => reject(new Error('Permission request timed out')), 5000)
      );
      
      let results: any;
      try {
        results = await Promise.race([
          PermissionsAndroid.requestMultiple(permissions),
          timeoutPromise,
        ]);
      } catch (e: any) {
        console.log('[Permissions] Request timed out or failed:', e.message);
        Alert.alert(
          'Bluetooth Permissions',
          'Could not request permissions automatically.\n\nPlease go to:\nSettings → Apps → Expo Go → Permissions\n\nThen enable "Nearby devices" and "Location"',
          [{ text: 'OK' }]
        );
        return false;
      }
      console.log('[Permissions] Results:', JSON.stringify(results));
      
      const allGranted = Object.values(results).every(
        result => result === PermissionsAndroid.RESULTS.GRANTED
      );

      if (!allGranted) {
        console.log('[Permissions] Not all granted');
        Alert.alert(
          'Bluetooth Permission Required',
          'Please grant Bluetooth permissions to scan for printers. Go to Settings → Apps → Kitchen Printer → Permissions → Nearby Devices → Allow',
          [{ text: 'OK' }]
        );
        return false;
      }
      console.log('[Permissions] All granted!');
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
      return result;
    }
  } catch (err) {
    console.error('[Permissions] Error:', err);
    // If permission check fails, try to proceed anyway
    Alert.alert('Permission Error', 'Could not check permissions. Trying to scan anyway...');
    return true; // Try anyway
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

export const SettingsScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const { settings, updateSettings, logout, auth, offline } = useStore();
  const { themeMode, toggleTheme } = useTheme();
  const [showIntervalSelector, setShowIntervalSelector] = useState(false);
  const [showPrintTypeSelector, setShowPrintTypeSelector] = useState(false);
  const [showViewModeSelector, setShowViewModeSelector] = useState(false);

  const yellowMin = Math.max(1, settings.orderAgingYellowMin ?? 5);
  const redMin = Math.max(yellowMin + 1, settings.orderAgingRedMin ?? 10);
  const completedArchiveLimit = Math.max(1, settings.completedArchiveLimit ?? 50);
  const agingControlsDisabled = !settings.orderAgingEnabled;

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
  
  // Printer state
  const [isScanning, setIsScanning] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [discoveredPrinters, setDiscoveredPrinters] = useState<PrinterDevice[]>([]);
  const [showPrinterList, setShowPrinterList] = useState(false);
  
  // Restaurant service config state
  const [deliveryEnabled, setDeliveryEnabled] = useState<boolean | null>(null);
  const [isLoadingDeliveryConfig, setIsLoadingDeliveryConfig] = useState(false);
  const [isUpdatingDelivery, setIsUpdatingDelivery] = useState(false);

  // Fetch delivery config on mount
  React.useEffect(() => {
    const fetchDeliveryConfig = async () => {
      if (!auth.restaurantId) return;
      
      setIsLoadingDeliveryConfig(true);
      try {
        const result = await tabletGetDeliveryConfig(auth.restaurantId);
        if (result.success && result.data) {
          setDeliveryEnabled(result.data.has_delivery_enabled);
        }
      } catch (error) {
        console.error('[Settings] Failed to fetch delivery config:', error);
      } finally {
        setIsLoadingDeliveryConfig(false);
      }
    };
    
    fetchDeliveryConfig();
  }, [auth.restaurantId]);

  const handleToggleDelivery = useCallback(async (newValue: boolean) => {
    if (!auth.restaurantId || isUpdatingDelivery) return;
    
    const previousValue = deliveryEnabled;
    setDeliveryEnabled(newValue); // Optimistic update
    setIsUpdatingDelivery(true);
    
    try {
      const result = await tabletUpdateDeliveryEnabled(auth.restaurantId, newValue);
      if (result.success) {
        Alert.alert(
          newValue ? '✓ Delivery Enabled' : '✓ Delivery Disabled',
          newValue 
            ? 'Customers can now order for delivery.' 
            : 'Delivery orders are now disabled. Customers will only see pickup.',
          [{ text: 'OK' }]
        );
      } else {
        // Revert on failure
        setDeliveryEnabled(previousValue);
        Alert.alert('Update Failed', result.error || 'Could not update delivery setting');
      }
    } catch (error) {
      setDeliveryEnabled(previousValue);
      Alert.alert('Error', 'Failed to update delivery setting');
    } finally {
      setIsUpdatingDelivery(false);
    }
  }, [auth.restaurantId, deliveryEnabled, isUpdatingDelivery]);

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
                trackColor={{ false: '#0f3460', true: '#FF8A65' }}
                thumbColor={themeMode === 'light' ? '#FF5722' : '#e94560'}
              />
            </View>

            {/* Workflow View Selector */}
            <TouchableOpacity
              style={[styles.settingRowTouchable, { borderTopWidth: 1, borderTopColor: '#334155' }]}
              onPress={() => setShowViewModeSelector(!showViewModeSelector)}
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
            <View style={[styles.settingRow, { borderTopWidth: 1, borderTopColor: '#334155' }]}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>✅ Completed Archive Limit</Text>
                <Text style={styles.settingDescription}>
                  Show last {completedArchiveLimit} completed orders (older go to Recall)
                </Text>
              </View>
              <View style={styles.stepper}>
                <TouchableOpacity
                  style={styles.stepperButton}
                  onPress={() => adjustArchiveLimit(-10)}
                  onLongPress={() => adjustArchiveLimit(-50)}
                  delayLongPress={250}
                >
                  <Text style={styles.stepperButtonText}>-</Text>
                </TouchableOpacity>
                <Text style={styles.stepperValue}>{completedArchiveLimit}</Text>
                <TouchableOpacity
                  style={styles.stepperButton}
                  onPress={() => adjustArchiveLimit(10)}
                  onLongPress={() => adjustArchiveLimit(50)}
                  delayLongPress={250}
                >
                  <Text style={styles.stepperButtonText}>+</Text>
                </TouchableOpacity>
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
                trackColor={{ false: '#374151', true: '#22c55e' }}
                thumbColor={settings.autoPrint ? '#fff' : '#9ca3af'}
              />
            </View>

            {/* Ring Until Accepted Toggle */}
            <View style={[styles.settingRow, { borderTopWidth: 1, borderTopColor: '#334155' }]}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>🔔 Ring Until Accepted</Text>
                <Text style={styles.settingDescription}>
                  Repeat alerts every 15s until order is accepted
                </Text>
              </View>
              <Switch
                value={settings.ringUntilAccepted ?? false}
                onValueChange={(value) => updateSettings({ ringUntilAccepted: value })}
                trackColor={{ false: '#374151', true: '#10b981' }}
                thumbColor={settings.ringUntilAccepted ? '#fff' : '#9ca3af'}
              />
            </View>

            {/* Printer Alerts Toggle */}
            <View style={[styles.settingRow, { borderTopWidth: 1, borderTopColor: '#334155' }]}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>🔔 Printer Alerts</Text>
                <Text style={styles.settingDescription}>
                  Sound + vibration when orders can't print
                </Text>
              </View>
              <Switch
                value={settings.printerAlertsEnabled ?? true}
                onValueChange={(value) => updateSettings({ printerAlertsEnabled: value })}
                trackColor={{ false: '#374151', true: '#f59e0b' }}
                thumbColor={settings.printerAlertsEnabled ?? true ? '#fff' : '#9ca3af'}
              />
            </View>

            {/* Order Aging Colors Toggle */}
            <View style={[styles.settingRow, { borderTopWidth: 1, borderTopColor: '#334155' }]}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>🎨 Order Aging Colors</Text>
                <Text style={styles.settingDescription}>
                  Orders turn yellow ({yellowMin}m) → red ({redMin}m)
                </Text>
              </View>
              <Switch
                value={settings.orderAgingEnabled ?? false}
                onValueChange={(value) => updateSettings({ orderAgingEnabled: value })}
                trackColor={{ false: '#374151', true: '#10b981' }}
                thumbColor={settings.orderAgingEnabled ? '#fff' : '#9ca3af'}
              />
            </View>

            {/* Aging Thresholds */}
            <View
              style={[
                styles.settingRow,
                { borderTopWidth: 1, borderTopColor: '#334155' },
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
                { borderTopWidth: 1, borderTopColor: '#334155' },
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
              style={[styles.settingRowTouchable, { borderTopWidth: 1, borderTopColor: '#334155' }]}
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
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>🚗 Delivery Service</Text>
                <Text style={styles.settingDescription}>
                  Allow customers to order for delivery
                </Text>
              </View>
              {isLoadingDeliveryConfig ? (
                <ActivityIndicator size="small" color="#3b82f6" />
              ) : deliveryEnabled === null ? (
                <Text style={{ color: '#64748b', fontSize: 12 }}>N/A</Text>
              ) : (
                <Switch
                  value={deliveryEnabled}
                  onValueChange={handleToggleDelivery}
                  disabled={isUpdatingDelivery}
                  trackColor={{ false: '#374151', true: '#3b82f6' }}
                  thumbColor={deliveryEnabled ? '#fff' : '#9ca3af'}
                />
              )}
            </View>
            {deliveryEnabled !== null && (
              <View style={styles.serviceStatusRow}>
                <View style={[
                  styles.serviceStatusBadge,
                  { backgroundColor: deliveryEnabled ? '#22c55e20' : '#ef444420' }
                ]}>
                  <View style={[
                    styles.serviceStatusDot,
                    { backgroundColor: deliveryEnabled ? '#22c55e' : '#ef4444' }
                  ]} />
                  <Text style={[
                    styles.serviceStatusText,
                    { color: deliveryEnabled ? '#22c55e' : '#ef4444' }
                  ]}>
                    {deliveryEnabled ? 'Delivery is ACTIVE' : 'Delivery is OFF'}
                  </Text>
                </View>
              </View>
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
          <Text style={styles.versionText}>Kitchen Printer App v1.0.3</Text>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#16213e',
    padding: 16,
    borderBottomWidth: 2,
    borderBottomColor: '#0f3460',
  },
  backButton: {
    padding: 8,
    minWidth: 80,
  },
  backText: {
    fontSize: 16,
    color: '#22c55e',
    fontWeight: '600',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
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
    color: '#94a3b8',
    textTransform: 'uppercase',
    marginBottom: 10,
    marginLeft: 4,
    letterSpacing: 0.5,
  },
  card: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#334155',
  },
  // Printer Status
  printerStatusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  printerStatusInfo: {
    flex: 1,
  },
  printerStatusLabel: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 4,
  },
  printerStatusSubtext: {
    fontSize: 14,
    color: '#94a3b8',
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
  // Scan Button
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
  // Printer List
  printerList: {
    padding: 16,
    paddingTop: 0,
  },
  printerListTitle: {
    fontSize: 14,
    color: '#94a3b8',
    marginBottom: 12,
  },
  printerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1e293b',
    padding: 16,
    borderRadius: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  printerItemInfo: {
    flex: 1,
  },
  printerItemName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 4,
  },
  printerItemMac: {
    fontSize: 12,
    color: '#64748b',
    fontFamily: 'monospace',
  },
  connectText: {
    color: '#22c55e',
    fontWeight: '600',
    fontSize: 14,
  },
  noPrintersText: {
    color: '#64748b',
    textAlign: 'center',
    padding: 20,
    fontSize: 14,
  },
  // Printer Actions
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
    backgroundColor: '#374151',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  disconnectText: {
    color: '#94a3b8',
    fontWeight: '600',
    fontSize: 15,
  },
  // Settings Rows
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
    color: '#fff',
    marginBottom: 4,
  },
  settingDescription: {
    fontSize: 14,
    color: '#94a3b8',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepperButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#1f2937',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  stepperValue: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    marginHorizontal: 10,
    minWidth: 40,
    textAlign: 'center',
  },
  chevron: {
    fontSize: 24,
    color: '#64748b',
  },
  // Info Rows
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  infoLabel: {
    fontSize: 15,
    color: '#94a3b8',
  },
  infoValue: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
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
    color: '#fff',
  },
  // Selector
  selectorContainer: {
    backgroundColor: '#1e293b',
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  selectorOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  selectorOptionSelected: {
    backgroundColor: '#0f3460',
  },
  selectorOptionLabel: {
    fontSize: 15,
    color: '#fff',
    flex: 1,
  },
  checkmark: {
    fontSize: 18,
    color: '#22c55e',
    fontWeight: 'bold',
  },
  // Service Status
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
  // Logout
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
    color: '#64748b',
    fontSize: 13,
    marginTop: 16,
  },
});
