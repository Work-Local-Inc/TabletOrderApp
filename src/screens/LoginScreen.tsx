import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Image,
  Modal,
} from 'react-native';
import * as Linking from 'expo-linking';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useStore } from '../store/useStore';
// Use the secure REST API client (NOT direct Supabase!)
import { apiClient } from '../api/client';

// TEST BUILD - Hardcoded credentials for testing
// TODO: Remove these for production builds
const TEST_UUID = __DEV__ ? '006fe8aa-eec7-465c-bb8d-9180d3a2c910' : '';
const TEST_KEY = __DEV__ ? 'aU2065zyc6zJrOwhQajVXToYLs4TNsOPlCgzKPVbyDE' : '';

export const LoginScreen: React.FC = () => {
  const [deviceUuid, setDeviceUuid] = useState(TEST_UUID);
  const [deviceKey, setDeviceKey] = useState(TEST_KEY);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  const login = useStore((state) => state.login);

  // Handle deep links (menuca://device/setup?uuid=...&key=...)
  const handleDeepLink = (url: string) => {
    try {
      const parsed = Linking.parse(url);
      if (parsed.path === 'device/setup' && parsed.queryParams) {
        const uuid = parsed.queryParams.uuid as string;
        const key = parsed.queryParams.key as string;
        if (uuid) setDeviceUuid(uuid);
        if (key) setDeviceKey(key);
        Alert.alert('Credentials Loaded!', 'Tap "Connect Device" to login.');
      }
    } catch (e) {
      console.log('Failed to parse deep link:', e);
    }
  };

  // Handle QR code scan
  const handleBarCodeScanned = ({ data }: { data: string }) => {
    if (scanned) return;
    setScanned(true);
    
    console.log('[QR] Scanned:', data);
    
    try {
      // Parse the QR code URL: menuca://device/setup?uuid=xxx&key=yyy
      const parsed = Linking.parse(data);
      console.log('[QR] Parsed:', parsed);
      
      if (parsed.queryParams) {
        const uuid = parsed.queryParams.uuid as string;
        const key = parsed.queryParams.key as string;
        
        if (uuid && key) {
          setDeviceUuid(uuid);
          setDeviceKey(key);
          setShowScanner(false);
          setScanned(false);
          Alert.alert('✓ Credentials Loaded!', 'Tap "Connect Device" to login.');
        } else {
          Alert.alert('Invalid QR Code', 'QR code does not contain valid credentials.');
          setScanned(false);
        }
      } else {
        Alert.alert('Invalid QR Code', 'Could not parse QR code data.');
        setScanned(false);
      }
    } catch (e) {
      console.error('[QR] Parse error:', e);
      Alert.alert('Scan Error', 'Could not read QR code. Please try again.');
      setScanned(false);
    }
  };

  // Open QR scanner
  const openScanner = async () => {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert('Camera Permission Required', 'Please allow camera access to scan QR codes.');
        return;
      }
    }
    setScanned(false);
    setShowScanner(true);
  };

  // Try to load stored credentials and handle deep links on mount
  useEffect(() => {
    const loadCredentials = async () => {
      const stored = await apiClient.getStoredCredentials();
      if (stored) {
        setDeviceUuid(stored.device_uuid);
        setDeviceKey(stored.device_key);
      }
    };
    loadCredentials();

    // Check if app was opened via deep link
    Linking.getInitialURL().then((url) => {
      if (url) handleDeepLink(url);
    });

    // Listen for deep links while app is open
    const subscription = Linking.addEventListener('url', (event) => {
      handleDeepLink(event.url);
    });

    return () => subscription.remove();
  }, []);

  const handleLogin = async () => {
    if (!deviceUuid.trim() || !deviceKey.trim()) {
      setError('Please enter both Device UUID and Device Key');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      console.log('Attempting login with UUID:', deviceUuid.trim());
      const result = await login(deviceUuid.trim(), deviceKey.trim());
      console.log('Login result:', JSON.stringify(result));

      setIsLoading(false);

      if (!result.success) {
        setError(result.error || 'Login failed');
        Alert.alert('Login Failed', result.error || 'Unknown error');
      } else {
        Alert.alert('Login Success!', 'Connected to restaurant. Loading orders...');
      }
    } catch (err: any) {
      setIsLoading(false);
      const errorMsg = err?.message || 'Unexpected error';
      setError(errorMsg);
      Alert.alert('Login Error', errorMsg);
      console.error('Login exception:', err);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.content}>
        {/* Logo/Header */}
        <View style={styles.header}>
          <Image 
            source={require('../../assets/logo.png')} 
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.title}>Kitchen Order Display</Text>
          <Text style={styles.subtitle}>
            Enter your device credentials to connect
          </Text>
        </View>

        {/* Error Message */}
        {error && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* Login Form */}
        <View style={styles.form}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Device UUID</Text>
            <TextInput
              style={styles.input}
              value={deviceUuid}
              onChangeText={setDeviceUuid}
              placeholder="Enter your device UUID"
              placeholderTextColor="#999"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!isLoading}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Device Key</Text>
            <TextInput
              style={styles.input}
              value={deviceKey}
              onChangeText={setDeviceKey}
              placeholder="Enter your device key"
              placeholderTextColor="#999"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              editable={!isLoading}
            />
          </View>

          <TouchableOpacity
            style={[styles.loginButton, isLoading && styles.loginButtonDisabled]}
            onPress={handleLogin}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.loginButtonText}>Connect Device</Text>
            )}
          </TouchableOpacity>

          {/* QR Code Scanner Button */}
          <TouchableOpacity
            style={styles.scanButton}
            onPress={openScanner}
            disabled={isLoading}
          >
            <Text style={styles.scanButtonText}>📷 Scan QR Code</Text>
          </TouchableOpacity>

        </View>

        {/* QR Scanner Modal */}
        <Modal
          visible={showScanner}
          animationType="slide"
          onRequestClose={() => setShowScanner(false)}
        >
          <View style={styles.scannerContainer}>
            <View style={styles.scannerHeader}>
              <Text style={styles.scannerTitle}>Scan Device QR Code</Text>
              <TouchableOpacity
                style={styles.closeButton}
                onPress={() => setShowScanner(false)}
              >
                <Text style={styles.closeButtonText}>✕ Close</Text>
              </TouchableOpacity>
            </View>
            
            <CameraView
              style={styles.camera}
              facing="back"
              barcodeScannerSettings={{
                barcodeTypes: ['qr'],
              }}
              onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
            />
            
            <View style={styles.scannerOverlay}>
              <View style={styles.scannerFrame} />
              <Text style={styles.scannerHint}>
                Point camera at the QR code from your dashboard
              </Text>
            </View>
          </View>
        </Modal>

        {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Don't have credentials? Contact your restaurant administrator.
        </Text>
          <Text style={styles.versionText}>v1.0.3</Text>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  content: {
    flex: 1,
    padding: 40,
    justifyContent: 'center',
    alignItems: 'center',
    maxWidth: 500,
    alignSelf: 'center',
    width: '100%',
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logo: {
    width: 200,
    height: 60,
    marginBottom: 20,
  },
  logoContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#4CAF50',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  logoIcon: {
    fontSize: 50,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  },
  errorContainer: {
    backgroundColor: '#ffebee',
    borderColor: '#f44336',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 20,
    width: '100%',
  },
  errorText: {
    color: '#c62828',
    textAlign: 'center',
    fontSize: 14,
  },
  form: {
    width: '100%',
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#333',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  loginButton: {
    backgroundColor: '#4CAF50',
    borderRadius: 12,
    padding: 18,
    alignItems: 'center',
    marginTop: 10,
    shadowColor: '#4CAF50',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  loginButtonDisabled: {
    opacity: 0.7,
  },
  loginButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  scanButton: {
    backgroundColor: '#2196F3',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 16,
    shadowColor: '#2196F3',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  scanButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  scannerContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  scannerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingTop: 50,
    backgroundColor: 'rgba(0,0,0,0.8)',
  },
  scannerTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  closeButton: {
    padding: 10,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 8,
  },
  closeButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  camera: {
    flex: 1,
  },
  scannerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scannerFrame: {
    width: 280,
    height: 280,
    borderWidth: 3,
    borderColor: '#4CAF50',
    borderRadius: 20,
    backgroundColor: 'transparent',
  },
  scannerHint: {
    color: '#fff',
    fontSize: 16,
    marginTop: 30,
    textAlign: 'center',
    paddingHorizontal: 40,
    textShadowColor: '#000',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  footer: {
    marginTop: 40,
    padding: 20,
  },
  footerText: {
    color: '#999',
    fontSize: 14,
    textAlign: 'center',
  },
  versionText: {
    color: '#ccc',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
  },
});
