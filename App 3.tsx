import React from 'react';
import { LogBox } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppNavigator } from './src/navigation/AppNavigator';
import { useNetworkStatus, useOrderNotifications, useHeartbeat } from './src/hooks';
import { ThemeProvider, useTheme } from './src/theme';

// Hide warning messages for demo/production
LogBox.ignoreAllLogs(true);

// App wrapper component to use hooks
const AppContent: React.FC = () => {
  const { themeMode } = useTheme();
  
  // Initialize network monitoring
  useNetworkStatus();

  // Initialize order notifications (sound, vibration, auto-print)
  useOrderNotifications();

  // Initialize heartbeat for device health reporting
  useHeartbeat();

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
        <AppContent />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
