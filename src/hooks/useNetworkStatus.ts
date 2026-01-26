import { useEffect, useCallback } from 'react';
import { Platform } from 'react-native';
import { useStore } from '../store/useStore';

// Only import expo-network on native platforms
let Network: any = null;
if (Platform.OS !== 'web') {
  Network = require('expo-network');
}

/**
 * Hook to monitor network connectivity status
 * Updates the store's online/offline state and processes queued actions when back online
 */
export const useNetworkStatus = () => {
  const { setOnlineStatus, processQueue, offline } = useStore();

  const checkNetworkStatus = useCallback(async () => {
    // On web, use navigator.onLine
    if (Platform.OS === 'web') {
      setOnlineStatus(typeof navigator !== 'undefined' ? navigator.onLine : true);
      return;
    }

    try {
      const networkState = await Network.getNetworkStateAsync();
      const isConnected = networkState.isConnected && networkState.isInternetReachable;
      setOnlineStatus(!!isConnected);
    } catch (error) {
      console.error('Failed to check network status:', error);
      // Assume online if we can't check
      setOnlineStatus(true);
    }
  }, [setOnlineStatus]);

  useEffect(() => {
    // Check initial status
    checkNetworkStatus();

    // Set up polling for network status (every 10 seconds)
    const interval = setInterval(checkNetworkStatus, 10000);

    return () => clearInterval(interval);
  }, [checkNetworkStatus]);

  // Process queue when we come back online
  useEffect(() => {
    if (offline.isOnline && offline.queuedActions.length > 0) {
      processQueue();
    }
  }, [offline.isOnline, offline.queuedActions.length, processQueue]);

  return {
    isOnline: offline.isOnline,
    queuedActionsCount: offline.queuedActions.length,
    checkNetworkStatus,
  };
};
