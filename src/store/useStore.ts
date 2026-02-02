import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Order, DeviceConfig, QueuedAction, OrderStatus } from '../types';
import { apiClient } from '../api/client';
import { tabletUpdateOrderStatus } from '../api/supabaseRpc';

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  restaurantId: string | null;
  restaurantName: string | null;
  deviceName: string | null;
}

interface OrdersState {
  orders: Order[];
  selectedOrder: Order | null;
  isLoading: boolean;
  lastFetchTime: string | null;
  error: string | null;
}

interface SettingsState {
  autoPrint: boolean;
  soundEnabled: boolean;
  notificationTone: 'default' | 'chime' | 'bell' | 'alert';
  pollIntervalMs: number;
  printerConnected: boolean;
  printerName: string | null;
  printerMacAddress: string | null;
  defaultPrintType: 'kitchen' | 'receipt' | 'both';
  printerAlertsEnabled: boolean; // Sound + vibration alerts for unprinted orders
  orderAgingEnabled: boolean; // Color-coded order aging (green → yellow → red)
  simplifiedView: boolean; // 2-column view: "New Orders" + "Ready" instead of 4 columns
}

interface OfflineState {
  isOnline: boolean;
  queuedActions: QueuedAction[];
}

interface AppStore {
  // Auth
  auth: AuthState;
  setAuth: (auth: Partial<AuthState>) => void;
  login: (deviceUuid: string, deviceKey: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;

  // Orders
  orders: OrdersState;
  setOrders: (orders: Partial<OrdersState>) => void;
  fetchOrders: () => Promise<void>;
  fetchOrder: (orderId: string) => Promise<Order | null>;
  acknowledgeOrder: (orderId: string) => Promise<boolean>;
  updateOrderStatus: (orderId: string, status: OrderStatus) => Promise<boolean>;
  selectOrder: (order: Order | null) => void;

  // Settings
  settings: SettingsState;
  updateSettings: (settings: Partial<SettingsState>) => void;

  // Offline
  offline: OfflineState;
  setOnlineStatus: (isOnline: boolean) => void;
  addToQueue: (action: Omit<QueuedAction, 'id' | 'created_at' | 'retry_count'>) => void;
  processQueue: () => Promise<void>;
  removeFromQueue: (actionId: string) => void;
}

export const useStore = create<AppStore>()(
  persist(
    (set, get) => ({
      // ==================== Auth State ====================
      auth: {
        isAuthenticated: false,
        isLoading: true,
        restaurantId: null,
        restaurantName: null,
        deviceName: null,
      },

      setAuth: (auth) =>
        set((state) => ({ auth: { ...state.auth, ...auth } })),

      login: async (deviceUuid, deviceKey) => {
        set((state) => ({ auth: { ...state.auth, isLoading: true } }));

        const result = await apiClient.login({
          device_uuid: deviceUuid,
          device_key: deviceKey,
        });

        if (result.success && result.data) {
          set({
            auth: {
              isAuthenticated: true,
              isLoading: false,
              restaurantId: result.data.restaurant_id,
              restaurantName: result.data.restaurant_name,
              deviceName: result.data.device_name,
            },
          });
          return { success: true };
        } else {
          set((state) => ({ auth: { ...state.auth, isLoading: false } }));
          return { success: false, error: result.error };
        }
      },

      logout: async () => {
        await apiClient.logout();
        set({
          auth: {
            isAuthenticated: false,
            isLoading: false,
            restaurantId: null,
            restaurantName: null,
            deviceName: null,
          },
          orders: {
            orders: [],
            selectedOrder: null,
            isLoading: false,
            lastFetchTime: null,
            error: null,
          },
        });
      },

      checkAuth: async () => {
        const isAuthenticated = await apiClient.isAuthenticated();
        const restaurantInfo = await apiClient.getRestaurantInfo();

        set({
          auth: {
            isAuthenticated,
            isLoading: false,
            restaurantId: restaurantInfo?.restaurant_id || null,
            restaurantName: restaurantInfo?.restaurant_name || null,
            deviceName: restaurantInfo?.device_name || null,
          },
        });
      },

      // ==================== Orders State ====================
      orders: {
        orders: [],
        selectedOrder: null,
        isLoading: false,
        lastFetchTime: null,
        error: null,
      },

      setOrders: (orders) =>
        set((state) => ({ orders: { ...state.orders, ...orders } })),

      fetchOrders: async () => {
        const { orders: currentState, offline } = get();
        console.log('[Store] fetchOrders called, isOnline:', offline.isOnline);

        // Don't fetch if offline
        if (!offline.isOnline) {
          console.log('[Store] Skipping fetch - offline');
          return;
        }

        set((state) => ({
          orders: { ...state.orders, isLoading: true, error: null },
        }));

        console.log('[Store] Fetching orders from API...');
        const result = await apiClient.getOrders({});
        console.log('[Store] API result:', result.success, 'orders:', result.data?.orders?.length || 0);

        if (result.success && result.data) {
          const existingOrders = currentState.orders;
          const newOrders = result.data.orders;

          // Merge orders, updating existing ones and adding new ones
          const orderMap = new Map(existingOrders.map((o) => [o.id, o]));
          newOrders.forEach((order) => orderMap.set(order.id, order));

          // Sort by created_at descending (newest first)
          const mergedOrders = Array.from(orderMap.values()).sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          );

          set({
            orders: {
              orders: mergedOrders,
              selectedOrder: currentState.selectedOrder,
              isLoading: false,
              lastFetchTime: new Date().toISOString(),
              error: null,
            },
          });
        } else {
          // Check if this is an auth error - if so, re-check auth state
          if (result.error?.includes('401') || result.error?.includes('session') || result.error?.includes('expired')) {
            console.log('[Store] Auth error detected, re-checking authentication');
            const isAuthenticated = await apiClient.isAuthenticated();
            if (!isAuthenticated) {
              set({
                auth: {
                  isAuthenticated: false,
                  isLoading: false,
                  restaurantId: null,
                  restaurantName: null,
                  deviceName: null,
                },
              });
            }
          }
          set((state) => ({
            orders: {
              ...state.orders,
              isLoading: false,
              error: result.error || 'Failed to fetch orders',
            },
          }));
        }
      },

      fetchOrder: async (orderId) => {
        const result = await apiClient.getOrder(orderId);
        if (result.success && result.data) {
          // Update the order in the list
          set((state) => {
            const updatedOrders = state.orders.orders.map((o) =>
              o.id === orderId ? result.data! : o
            );
            return {
              orders: {
                ...state.orders,
                orders: updatedOrders,
                selectedOrder:
                  state.orders.selectedOrder?.id === orderId
                    ? result.data!
                    : state.orders.selectedOrder,
              },
            };
          });
          return result.data;
        }
        return null;
      },

      acknowledgeOrder: async (orderId) => {
        const { offline } = get();

        if (!offline.isOnline) {
          get().addToQueue({
            type: 'acknowledge',
            order_id: orderId,
            payload: {},
          });
          return true;
        }

        const result = await apiClient.acknowledgeOrder(orderId);
        if (result.success && result.data) {
          set((state) => ({
            orders: {
              ...state.orders,
              orders: state.orders.orders.map((o) =>
                o.id === orderId ? result.data! : o
              ),
              selectedOrder:
                state.orders.selectedOrder?.id === orderId
                  ? result.data!
                  : state.orders.selectedOrder,
            },
          }));
          return true;
        }
        return false;
      },

      updateOrderStatus: async (orderId, status) => {
        console.log(`[Store] Updating order ${orderId} to ${status}`);
        const { offline, orders: currentOrdersState } = get();
        const previousOrders = currentOrdersState.orders;
        const previousSelected = currentOrdersState.selectedOrder;

        // ALWAYS update local state immediately (optimistic update)
        set((state) => ({
          orders: {
            ...state.orders,
            orders: state.orders.orders.map((o) =>
              o.id === orderId ? { ...o, status } : o
            ),
            selectedOrder:
              state.orders.selectedOrder?.id === orderId
                ? { ...state.orders.selectedOrder, status }
                : state.orders.selectedOrder,
          },
        }));
        console.log(`[Store] ✓ Local state updated to ${status}`);

        if (!offline.isOnline) {
          console.log(`[Store] Offline - queuing status update`);
          get().addToQueue({
            type: 'status_update',
            order_id: orderId,
            payload: { status },
          });
          return true;
        }

        // Try to update on backend via Supabase RPC (bypasses PHP restrictions)
        const result = await tabletUpdateOrderStatus(orderId, status);
        console.log(`[Store] Supabase RPC result:`, result.success, result.error || 'OK');
        
        if (result.success) {
          console.log(`[Store] ✓ Backend updated to ${status}`);
          return true;
        } else {
          // Revert optimistic update on failure
          set((state) => ({
            orders: {
              ...state.orders,
              orders: previousOrders,
              selectedOrder: previousSelected,
            },
          }));
          // SHOW ERROR ON SCREEN so user can see what's wrong
          const { Alert } = require('react-native');
          Alert.alert(
            'Status Update Failed',
            `Could not update order to ${status}.\n\nError: ${result.error}\n\nOrder ID: ${orderId}`,
            [{ text: 'OK' }]
          );
          console.error(`[Store] ✗ Backend update failed: ${result.error}`);
          return false;
        }
      },

      selectOrder: (order) =>
        set((state) => ({
          orders: { ...state.orders, selectedOrder: order },
        })),

      // ==================== Settings State ====================
      settings: {
        autoPrint: true,
        soundEnabled: true,
        notificationTone: 'default',
        pollIntervalMs: 5000,
        printerConnected: false,
        printerName: null,
        printerMacAddress: null,
        defaultPrintType: 'kitchen', // Default to kitchen tickets
        printerAlertsEnabled: true, // Alert when orders can't print
        orderAgingEnabled: false, // Color-coded aging OFF by default
        simplifiedView: true, // Simplified 2-column Kanban view by default
      },

      updateSettings: (settings) =>
        set((state) => ({ settings: { ...state.settings, ...settings } })),

      // ==================== Offline State ====================
      offline: {
        isOnline: true,
        queuedActions: [],
      },

      setOnlineStatus: (isOnline) => {
        set((state) => ({
          offline: { ...state.offline, isOnline },
        }));

        // Process queue when coming back online
        if (isOnline) {
          get().processQueue();
        }
      },

      addToQueue: (action) => {
        const queuedAction: QueuedAction = {
          ...action,
          id: Math.random().toString(36).substring(7),
          created_at: new Date().toISOString(),
          retry_count: 0,
        };
        set((state) => ({
          offline: {
            ...state.offline,
            queuedActions: [...state.offline.queuedActions, queuedAction],
          },
        }));
      },

      processQueue: async () => {
        const { offline } = get();

        if (!offline.isOnline || offline.queuedActions.length === 0) {
          return;
        }

        for (const action of offline.queuedActions) {
          let success = false;

          try {
            if (action.type === 'acknowledge') {
              const result = await apiClient.acknowledgeOrder(action.order_id);
              success = result.success;
            } else if (action.type === 'status_update') {
              const result = await tabletUpdateOrderStatus(
                action.order_id,
                action.payload.status
              );
              success = result.success;
            }
          } catch (error) {
            console.error('Failed to process queued action:', error);
          }

          if (success) {
            get().removeFromQueue(action.id);
          } else {
            // Increment retry count
            set((state) => ({
              offline: {
                ...state.offline,
                queuedActions: state.offline.queuedActions.map((a) =>
                  a.id === action.id ? { ...a, retry_count: a.retry_count + 1 } : a
                ),
              },
            }));
          }
        }
      },

      removeFromQueue: (actionId) =>
        set((state) => ({
          offline: {
            ...state.offline,
            queuedActions: state.offline.queuedActions.filter(
              (a) => a.id !== actionId
            ),
          },
        })),
    }),
    {
      name: 'tablet-order-app-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        settings: state.settings,
        offline: { queuedActions: state.offline.queuedActions, isOnline: true },
      }),
    }
  )
);
