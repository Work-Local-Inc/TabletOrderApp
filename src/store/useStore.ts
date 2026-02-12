import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Order, DeviceConfig, QueuedAction, OrderStatus } from '../types';
import { apiClient } from '../api/client';
import { tabletUpdateOrderStatus } from '../api/supabaseRpc';
import { addBreadcrumb, captureException } from '../config/sentry';

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
  ringUntilAccepted: boolean; // Repeat new order alerts until accepted
  orderAgingEnabled: boolean; // Color-coded order aging (green → yellow → red)
  orderAgingYellowMin: number; // Minutes before yellow warning
  orderAgingRedMin: number; // Minutes before red critical
  completedArchiveLimit: number; // Max completed orders shown before archiving
  viewMode: 'two' | 'three' | 'four'; // Kanban view mode
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
  hasHydrated: boolean;
  setHasHydrated: (value: boolean) => void;

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

  // Local Accept state (client-side only)
  acceptedOrderMap: Record<string, string>;

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
      hasHydrated: false,
      setHasHydrated: (value) => set({ hasHydrated: value }),

      setAuth: (auth) =>
        set((state) => ({ auth: { ...state.auth, ...auth } })),

      login: async (deviceUuid, deviceKey) => {
        addBreadcrumb('Login attempt', 'auth');
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
          acceptedOrderMap: {},
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
        const hydrated = get().hasHydrated;
        if (!hydrated) {
          console.log('[Store] fetchOrders called before hydration - continuing');
        }
        console.log('[Store] fetchOrders called, isOnline:', offline.isOnline);

        // Don't fetch if offline
        if (!offline.isOnline) {
          console.log('[Store] Skipping fetch - offline');
          return;
        }

        addBreadcrumb('Fetching orders', 'store');

        set((state) => ({
          orders: { ...state.orders, isLoading: true, error: null },
        }));

        console.log('[Store] Fetching orders from API...');
        const result = await apiClient.getOrders({});
        console.log('[Store] API result:', result.success, 'orders:', result.data?.orders?.length || 0);

        if (result.success && result.data) {
          const { acceptedOrderMap } = get();
          const newOrders = result.data.orders;

          const isNewishStatus = (status: string) =>
            status === 'pending' || status === 'confirmed' || status === 'preparing';

          // Keep local accept state only for orders still in "new-ish" statuses
          const newishIds = new Set(
            newOrders.filter(o => isNewishStatus(o.status)).map(o => o.id)
          );
          const cleanedAcceptedMap = hydrated
            ? Object.fromEntries(
                Object.entries(acceptedOrderMap).filter(([id]) => newishIds.has(id))
              )
            : {};

          // Override acknowledged_at locally for new-ish orders based on local accept state
          // NOTE: We intentionally ignore server acknowledged_at because backend auto-acks on fetch.
          const normalizedOrders = hydrated
            ? newOrders.map((order) => {
                if (isNewishStatus(order.status)) {
                  const acceptedAt = cleanedAcceptedMap[order.id] || null;
                  return { ...order, acknowledged_at: acceptedAt };
                }
                return order;
              })
            : newOrders;

          // Use server response as source of truth - removes deleted orders
          // Sort by created_at descending (newest first)
          const mergedOrders = normalizedOrders.sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          );

          // Clear selectedOrder if it no longer exists in the fetched data
          const selectedStillExists = currentState.selectedOrder
            ? mergedOrders.some(o => o.id === currentState.selectedOrder?.id)
            : false;

          set({
            acceptedOrderMap: hydrated ? cleanedAcceptedMap : acceptedOrderMap,
            orders: {
              orders: mergedOrders,
              selectedOrder: selectedStillExists ? currentState.selectedOrder : null,
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
        const { offline, acceptedOrderMap, orders: currentOrdersState } = get();
        const targetOrder = currentOrdersState.orders.find(o => o.id === orderId);
        const numericId = targetOrder?.numeric_id;

        const acknowledgedAt = new Date().toISOString();
        // Optimistically mark as acknowledged so alerts stop immediately
        set((state) => ({
          acceptedOrderMap: { ...acceptedOrderMap, [orderId]: acknowledgedAt },
          orders: {
            ...state.orders,
            orders: state.orders.orders.map((o) =>
              o.id === orderId
                ? { ...o, acknowledged_at: o.acknowledged_at || acknowledgedAt }
                : o
            ),
            selectedOrder:
              state.orders.selectedOrder?.id === orderId
                ? {
                    ...state.orders.selectedOrder,
                    acknowledged_at:
                      state.orders.selectedOrder.acknowledged_at || acknowledgedAt,
                  }
                : state.orders.selectedOrder,
          },
        }));

        if (!offline.isOnline) {
          get().addToQueue({
            type: 'acknowledge',
            order_id: orderId,
            payload: { numeric_id: numericId },
          });
          return true;
        }

        const ackId = numericId ? String(numericId) : orderId;
        const result = await apiClient.acknowledgeOrder(ackId, acknowledgedAt);
        if (result.success && result.data) {
          set((state) => ({
            orders: {
              ...state.orders,
              orders: state.orders.orders.map((o) =>
                o.id === orderId
                  ? {
                      ...o,
                      ...result.data!,
                      numeric_id: o.numeric_id ?? (result.data as any).numeric_id,
                    }
                  : o
              ),
              selectedOrder:
                state.orders.selectedOrder?.id === orderId
                  ? {
                      ...state.orders.selectedOrder,
                      ...result.data!,
                      numeric_id:
                        state.orders.selectedOrder.numeric_id ??
                        (result.data as any).numeric_id,
                    }
                  : state.orders.selectedOrder,
            },
          }));
          return true;
        }
        return false;
      },

      updateOrderStatus: async (orderId, status) => {
        console.log(`[Store] Updating order ${orderId} to ${status}`);
        addBreadcrumb('Updating order status', 'store', { orderId, newStatus: status });
        const { offline, orders: currentOrdersState } = get();
        
        // Look up the order — bail early if it doesn't exist in state
        const targetOrder = currentOrdersState.orders.find(o => o.id === orderId);
        if (!targetOrder) {
          console.error(`[Store] Order ${orderId} not found in local state — skipping update`);
          return false;
        }
        const numericId = targetOrder.numeric_id;
        const previousStatus = targetOrder.status;

        // Optimistic update
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
            payload: { status, numeric_id: numericId },
          });
          return true;
        }

        if (!numericId) {
          console.error(`[Store] No numeric_id found for order ${orderId} — reverting optimistic update`);
          // Revert only this order, not the entire array
          set((state) => ({
            orders: {
              ...state.orders,
              orders: state.orders.orders.map((o) =>
                o.id === orderId ? { ...o, status: previousStatus } : o
              ),
              selectedOrder:
                state.orders.selectedOrder?.id === orderId
                  ? { ...state.orders.selectedOrder, status: previousStatus }
                  : state.orders.selectedOrder,
            },
          }));
          return false;
        }

        // Try to update on backend via Supabase RPC (bypasses PHP restrictions)
        const result = await tabletUpdateOrderStatus(numericId, status);
        console.log(`[Store] Supabase RPC result:`, result.success, result.error || 'OK');
        
        if (result.success) {
          console.log(`[Store] ✓ Backend updated to ${status}`);
          return true;
        } else {
          // Revert only this order — preserves concurrent updates to other orders
          set((state) => ({
            orders: {
              ...state.orders,
              orders: state.orders.orders.map((o) =>
                o.id === orderId ? { ...o, status: previousStatus } : o
              ),
              selectedOrder:
                state.orders.selectedOrder?.id === orderId
                  ? { ...state.orders.selectedOrder, status: previousStatus }
                  : state.orders.selectedOrder,
            },
          }));
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
        ringUntilAccepted: false, // Repeat alert until accepted (off by default)
        orderAgingEnabled: false, // Color-coded aging OFF by default
        orderAgingYellowMin: 5, // Yellow after 5 minutes
        orderAgingRedMin: 10, // Red after 10 minutes
        completedArchiveLimit: 50, // Show last 50 completed orders before archive
        viewMode: 'three', // Default to 3-column view (New / Active / Completed)
      },

      updateSettings: (settings) =>
        set((state) => ({ settings: { ...state.settings, ...settings } })),

      // Local Accept state
      acceptedOrderMap: {},

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
              const ackId = action.payload?.numeric_id
                ? String(action.payload.numeric_id)
                : action.order_id;
              const result = await apiClient.acknowledgeOrder(ackId);
              success = result.success;
            } else if (action.type === 'status_update') {
              // Use stored numeric_id, or look it up from current orders
              const numericId = action.payload.numeric_id 
                || get().orders.orders.find(o => o.id === action.order_id)?.numeric_id;
              if (numericId) {
                const result = await tabletUpdateOrderStatus(
                  numericId,
                  action.payload.status
                );
                success = result.success;
              } else {
                console.error(`[Store] processQueue: No numeric_id for order ${action.order_id}`);
              }
            }
          } catch (error) {
            console.error('Failed to process queued action:', error);
          }

          if (success) {
            get().removeFromQueue(action.id);
          } else if (action.retry_count >= 5) {
            // Max retries reached - drop the action to prevent infinite loops
            console.error(`[Store] processQueue: Dropping action ${action.id} after ${action.retry_count} retries (order ${action.order_id})`);
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
      onRehydrateStorage: () => (_state, error) => {
        if (error) {
          console.warn('[Store] Rehydrate error:', error);
        }
        _state?.setHasHydrated(true);
        // Re-fetch after hydration so accept state can be re-applied
        setTimeout(() => {
          try {
            _state?.fetchOrders?.();
          } catch (err) {
            console.warn('[Store] fetchOrders after hydration failed:', err);
          }
        }, 0);
      },
      partialize: (state) => ({
        settings: state.settings,
        acceptedOrderMap: state.acceptedOrderMap,
        offline: { queuedActions: state.offline.queuedActions, isOnline: true },
      }),
    }
  )
);
