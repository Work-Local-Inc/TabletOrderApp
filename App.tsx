import React, { useEffect } from 'react';
import { LogBox } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useKeepAwake } from 'expo-keep-awake';
import { AppNavigator } from './src/navigation/AppNavigator';
import { useNetworkStatus, useOrderNotifications, useHeartbeat, useAppUpdates } from './src/hooks';
import { ThemeProvider, useTheme } from './src/theme';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { initSentry, setSentryContext, addBreadcrumb } from './src/config/sentry';
import { useStore } from './src/store/useStore';

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

  // Initialize network monitoring
  useNetworkStatus();

  // Initialize order notifications (sound, vibration, auto-print)
  useOrderNotifications();

  // Initialize heartbeat for device health reporting
  useHeartbeat();

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

  return (
    <>
      <StatusBar style={themeMode === 'dark' ? 'light' : 'dark'} />
      <AppNavigator />
    </>
  );
};

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ErrorBoundary>
          <AppContent />
        </ErrorBoundary>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
