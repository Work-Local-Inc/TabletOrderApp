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
} from 'react-native';
import * as Linking from 'expo-linking';
import { useStore } from '../store/useStore';
import { supabaseApiClient as apiClient } from '../api/supabaseClient';

// TEST BUILD - Hardcoded credentials for testing
const TEST_UUID = '006fe8aa-eec7-465c-bb8d-9180d3a2c910';
const TEST_KEY = 'aU2065zyc6zJrOwhQajVXToYLs4TNsOPlCgzKPVbyDE';

export const LoginScreen: React.FC = () => {
  const [deviceUuid, setDeviceUuid] = useState(TEST_UUID);
  const [deviceKey, setDeviceKey] = useState(TEST_KEY);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const handleScanQR = () => {
    // TODO: Implement QR code scanning
    Alert.alert(
      'QR Scanner',
      'QR code scanning will be implemented with react-native-camera',
      [{ text: 'OK' }]
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.content}>
        {/* Logo/Header */}
        <View style={styles.header}>
          <View style={styles.logoContainer}>
            <Text style={styles.logoIcon}>🍽️</Text>
          </View>
          <Text style={styles.title}>Restaurant Order Tablet</Text>
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

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          <TouchableOpacity
            style={styles.qrButton}
            onPress={handleScanQR}
            disabled={isLoading}
          >
            <Text style={styles.qrButtonIcon}>📷</Text>
            <Text style={styles.qrButtonText}>Scan QR Code</Text>
          </TouchableOpacity>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Don't have credentials? Contact your restaurant administrator.
          </Text>
          <Text style={styles.versionText}>v1.0.2</Text>
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
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 24,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#ddd',
  },
  dividerText: {
    marginHorizontal: 16,
    color: '#999',
    fontSize: 14,
  },
  qrButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#4CAF50',
    borderRadius: 12,
    padding: 16,
  },
  qrButtonIcon: {
    fontSize: 24,
    marginRight: 10,
  },
  qrButtonText: {
    color: '#4CAF50',
    fontSize: 16,
    fontWeight: '600',
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
