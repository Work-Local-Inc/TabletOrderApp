import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppNavigator } from './src/navigation/AppNavigator';
import { useNetworkStatus, useOrderNotifications, useHeartbeat } from './src/hooks';

// App wrapper component to use hooks
const AppContent: React.FC = () => {
  // Initialize network monitoring
  useNetworkStatus();

  // Initialize order notifications (sound, vibration, auto-print)
  useOrderNotifications();

  // Initialize heartbeat for device health reporting
  useHeartbeat();

  return (
    <>
      <StatusBar style="dark" />
      <AppNavigator />
    </>
  );
};

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}
