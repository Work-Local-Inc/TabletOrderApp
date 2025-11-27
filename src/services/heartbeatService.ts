import { apiClient } from '../api/client';
import { useStore } from '../store/useStore';
import { HeartbeatPayload } from '../types';
import * as Application from 'expo-application';

const APP_VERSION = '1.0.0';
let heartbeatInterval: NodeJS.Timeout | null = null;

/**
 * Get device battery level (Android only)
 * Returns null on iOS/web
 */
const getBatteryLevel = async (): Promise<number | undefined> => {
  try {
    // expo-battery can be used here if needed
    return undefined;
  } catch {
    return undefined;
  }
};

/**
 * Get WiFi signal strength
 * Returns null if not available
 */
const getWifiStrength = async (): Promise<number | undefined> => {
  try {
    // Would require native module for actual signal strength
    return undefined;
  } catch {
    return undefined;
  }
};

/**
 * Send heartbeat to server
 */
export const sendHeartbeat = async (): Promise<void> => {
  const store = useStore.getState();

  if (!store.auth.isAuthenticated || !store.offline.isOnline) {
    return;
  }

  const payload: HeartbeatPayload = {
    app_version: APP_VERSION,
    battery_level: await getBatteryLevel(),
    wifi_strength: await getWifiStrength(),
    printer_status: store.settings.printerConnected ? 'connected' : 'disconnected',
  };

  // Add last order received time if we have orders
  if (store.orders.orders.length > 0) {
    const latestOrder = store.orders.orders[0];
    payload.last_order_received = latestOrder.created_at;
  }

  try {
    const response = await apiClient.sendHeartbeat(payload);

    if (response.success && response.data?.config_updates) {
      // Apply any config updates from server
      const updates = response.data.config_updates;

      if (updates.poll_interval_ms !== undefined) {
        store.updateSettings({ pollIntervalMs: updates.poll_interval_ms });
      }
      if (updates.auto_print !== undefined) {
        store.updateSettings({ autoPrint: updates.auto_print });
      }
      if (updates.sound_enabled !== undefined) {
        store.updateSettings({ soundEnabled: updates.sound_enabled });
      }
    }
  } catch (error) {
    console.error('Heartbeat failed:', error);
  }
};

/**
 * Start periodic heartbeat
 * Sends heartbeat every 60 seconds
 */
export const startHeartbeat = (intervalMs = 60000): void => {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
  }

  // Send initial heartbeat
  sendHeartbeat();

  // Set up periodic heartbeat
  heartbeatInterval = setInterval(sendHeartbeat, intervalMs);
};

/**
 * Stop periodic heartbeat
 */
export const stopHeartbeat = (): void => {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
};

export default {
  sendHeartbeat,
  startHeartbeat,
  stopHeartbeat,
};
