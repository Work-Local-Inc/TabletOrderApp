import React, { useEffect } from 'react';
import { LogBox, Platform, StatusBar as RNStatusBar } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useKeepAwake } from 'expo-keep-awake';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AppNavigator } from './src/navigation/AppNavigator';
import { useNetworkStatus, useOrderNotifications, useHeartbeat, useAppUpdates, useVersionGate } from './src/hooks';
import { ThemeProvider, useTheme } from './src/theme';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { initSentry, setSentryContext, addBreadcrumb } from './src/config/sentry';
import { useStore } from './src/store/useStore';
import { ForceUpdateScreen } from './src/components/ForceUpdateScreen';

// Initialize Sentry early, before any React code
initSentry();

// Hide warning messages for demo/production
LogBox.ignoreAllLogs(true);

// App wrapper component to use hooks
const AppContent: React.FC = () => {
  const { themeMode } = useTheme();
  const { auth } = useStore();

  // Check for OTA updates on app start and when coming to foreground
  useAppUpdates();

  // Keep screen on at all times - prevents tablet from sleeping
  useKeepAwake();

  // KDS kiosk mode: hide Android status bar for fullscreen display
  useEffect(() => {
    if (Platform.OS === 'android') {
      RNStatusBar.setHidden(true);
      RNStatusBar.setTranslucent(true);
    }
  }, []);

  // Initialize network monitoring
  useNetworkStatus();

  // Initialize order notifications (sound, vibration, auto-print)
  useOrderNotifications();

  // Initialize heartbeat for device health reporting
  useHeartbeat();

  // Version gate (force update if below minimum)
  const versionGate = useVersionGate();

  // Set Sentry context when authenticated
  useEffect(() => {
    if (auth.isAuthenticated && auth.restaurantId) {
      setSentryContext(
        auth.restaurantId,
        auth.restaurantName || 'Unknown',
        auth.deviceName || 'Unknown'
      );
      addBreadcrumb('User authenticated', 'auth', { restaurantId: auth.restaurantId });
    }
  }, [auth.isAuthenticated, auth.restaurantId, auth.restaurantName, auth.deviceName]);

  if (versionGate.forceUpdate) {
    return (
      <>
        <StatusBar hidden={true} translucent={true} style="light" />
        <ForceUpdateScreen
          message={versionGate.message}
          updateUrl={versionGate.updateUrl}
          currentVersion={versionGate.currentVersion}
          minVersion={versionGate.minVersion}
          onRetry={versionGate.checkNow}
        />
      </>
    );
  }

  return (
    <>
      <StatusBar hidden={true} translucent={true} style={themeMode === 'dark' ? 'light' : 'dark'} />
      <AppNavigator />
    </>
  );
};

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <ErrorBoundary>
            <AppContent />
          </ErrorBoundary>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
