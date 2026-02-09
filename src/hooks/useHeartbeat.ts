import { useEffect, useRef, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useStore } from '../store/useStore';
import { apiClient } from '../api/client';
import { detectStuckOrders } from '../utils/stuckOrderDetection';

const APP_VERSION = '1.4.0';
const HEARTBEAT_INTERVAL = 60000; // 1 minute

/**
 * Hook to send periodic heartbeat to the server
 * Reports device health, stuck orders, and receives config updates
 */
export const useHeartbeat = () => {
  const { auth, offline, updateSettings, settings, orders } = useStore();
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastHeartbeatRef = useRef<string | null>(null);

  const sendHeartbeat = useCallback(async () => {
    if (!auth.isAuthenticated || !offline.isOnline) {
      console.log('[Heartbeat] Skipping - not authenticated or offline');
      return;
    }

    // Detect stuck orders from current order list
    const stuckOrders = detectStuckOrders(orders.orders);
    
    if (stuckOrders.length > 0) {
      console.log('[Heartbeat] Detected stuck orders:', stuckOrders.length);
    }

    console.log('[Heartbeat] Sending heartbeat...');
    try {
      const response = await apiClient.sendHeartbeat({
        app_version: APP_VERSION,
        battery_level: 100, // TODO: Get actual battery level
        printer_status: settings.printerConnected ? 'online' : 'offline',
        // NOTE: stuck_orders detection is ready but not sent until backend supports it
        // stuck_orders: stuckOrders.length > 0 ? stuckOrders : undefined,
      });

      console.log('[Heartbeat] Response:', response.success);

      if (response.success && response.data) {
        // Apply any config updates from server
        if (response.data.config_updates) {
          const updates = response.data.config_updates;
          updateSettings({
            autoPrint: updates.auto_print ?? settings.autoPrint,
            soundEnabled: updates.sound_enabled ?? settings.soundEnabled,
            pollIntervalMs: updates.poll_interval_ms ?? settings.pollIntervalMs,
          });
        }
      }
    } catch (error) {
      console.error('[Heartbeat] Failed:', error);
    }
  }, [auth.isAuthenticated, offline.isOnline, settings, updateSettings, orders.orders]);

  // Start/stop heartbeat based on auth and app state
  useEffect(() => {
    if (!auth.isAuthenticated) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Send initial heartbeat
    sendHeartbeat();

    // Set up interval
    intervalRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);

    // Handle app state changes
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        sendHeartbeat();
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      subscription.remove();
    };
  }, [auth.isAuthenticated, sendHeartbeat]);

  return {
    sendHeartbeat,
  };
};
