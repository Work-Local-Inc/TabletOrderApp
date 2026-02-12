import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import {
  ApiResponse,
  AuthResponse,
  DeviceCredentials,
  Order,
  OrdersListResponse,
  OrderStatus,
  HeartbeatPayload,
  HeartbeatResponse,
  DispatchAvailabilityResponse,
  DispatchDriverResponse,
  DispatchDriverRequest,
} from '../types';
import { addBreadcrumb, captureException } from '../config/sentry';

const BASE_URL = 'https://orders.menu.ca';

// SECURITY: Sensitive keys stored in SecureStore (OS keychain/keystore)
// Non-sensitive keys remain in AsyncStorage for performance
const SECURE_KEYS = {
  SESSION_TOKEN: 'tablet_session_token',      // SecureStore (sensitive)
  TOKEN_EXPIRY: 'tablet_token_expiry',        // SecureStore (sensitive)
  DEVICE_CREDENTIALS: 'tablet_device_creds',  // SecureStore (sensitive)
};

const STORAGE_KEYS = {
  RESTAURANT_INFO: '@tablet_restaurant_info', // AsyncStorage (non-sensitive, display only)
};

// Helper functions for SecureStore with error handling
async function secureGet(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch (error) {
    console.error(`[SecureStore] Failed to get ${key}:`, error);
    return null;
  }
}

async function secureSet(key: string, value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, value);
  } catch (error) {
    console.error(`[SecureStore] Failed to set ${key}:`, error);
  }
}

async function secureDelete(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch (error) {
    console.error(`[SecureStore] Failed to delete ${key}:`, error);
  }
}

class ApiClient {
  private client: AxiosInstance;
  private sessionToken: string | null = null;
  private tokenExpiry: Date | null = null;
  private refreshPromise: Promise<boolean> | null = null;
  private deviceCredentials: DeviceCredentials | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: BASE_URL,
      timeout: 15000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Request interceptor to add auth header
    this.client.interceptors.request.use(
      async (config: InternalAxiosRequestConfig) => {
        // Add breadcrumb for API request tracking
        addBreadcrumb(
          `API ${config.method?.toUpperCase()} ${config.url}`,
          'http',
          { method: config.method, url: config.url }
        );

        // Skip auth for login endpoint
        if (config.url?.includes('/auth/login')) {
          return config;
        }

        // Check if token needs refresh
        if (this.shouldRefreshToken()) {
          await this.refreshToken();
        }

        if (this.sessionToken) {
          config.headers.Authorization = `Bearer ${this.sessionToken}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        // Capture API errors to Sentry (excluding expected errors like 401)
        if (error.response?.status !== 401) {
          captureException(error, {
            endpoint: error.config?.url,
            method: error.config?.method,
            status: error.response?.status,
            statusText: error.response?.statusText,
          });
        }

        if (error.response?.status === 401) {
          // Token expired, try to refresh
          const refreshed = await this.refreshToken();
          if (refreshed && error.config) {
            // Retry the original request
            error.config.headers.Authorization = `Bearer ${this.sessionToken}`;
            return this.client.request(error.config);
          } else {
            // Refresh failed - clear all stored data to force re-login
            console.log('[API] Token refresh failed, clearing stored credentials');
            await this.clearAllStoredData();
          }
        }
        return Promise.reject(error);
      }
    );

    // Load stored token on initialization
    this.loadStoredToken();
  }

  private async loadStoredToken(): Promise<void> {
    try {
      const [token, expiry, creds] = await Promise.all([
        secureGet(SECURE_KEYS.SESSION_TOKEN),
        secureGet(SECURE_KEYS.TOKEN_EXPIRY),
        secureGet(SECURE_KEYS.DEVICE_CREDENTIALS),
      ]);

      if (token && expiry) {
        this.sessionToken = token;
        this.tokenExpiry = new Date(expiry);
      }
      
      if (creds) {
        this.deviceCredentials = JSON.parse(creds);
      }
    } catch (error) {
      console.error('Failed to load stored token:', error);
    }
  }

  private shouldRefreshToken(): boolean {
    if (!this.tokenExpiry) return false;
    // Refresh if less than 1 hour until expiry
    const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
    return this.tokenExpiry < oneHourFromNow;
  }

  private async refreshToken(): Promise<boolean> {
    // Prevent multiple simultaneous refresh attempts
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      try {
        const response = await this.client.post<ApiResponse<AuthResponse>>(
          '/api/tablet/auth/refresh',
          {},
          {
            headers: {
              Authorization: `Bearer ${this.sessionToken}`,
            },
          }
        );

        if (response.data.success && response.data.data) {
          await this.storeAuthData(response.data.data);
          return true;
        }
        return false;
      } catch (error) {
        console.error('Token refresh failed:', error);
        return false;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  private async storeAuthData(auth: AuthResponse): Promise<void> {
    this.sessionToken = auth.session_token;
    this.tokenExpiry = new Date(auth.expires_at);

    await Promise.all([
      // Sensitive data -> SecureStore
      secureSet(SECURE_KEYS.SESSION_TOKEN, auth.session_token),
      secureSet(SECURE_KEYS.TOKEN_EXPIRY, auth.expires_at),
      // Non-sensitive display data -> AsyncStorage
      AsyncStorage.setItem(
        STORAGE_KEYS.RESTAURANT_INFO,
        JSON.stringify({
          restaurant_id: auth.restaurant_id,
          restaurant_name: auth.restaurant_name,
          device_name: auth.device_name,
        })
      ),
    ]);
  }

  // ==================== Auth Methods ====================

  async login(credentials: DeviceCredentials): Promise<ApiResponse<AuthResponse>> {
    try {
      const response = await this.client.post<any>(
        '/api/tablet/auth/login',
        credentials
      );

      // API returns data directly, not wrapped in { success, data }
      const rawData = response.data;

      // Transform API response to our expected format
      if (rawData.session_token && rawData.device) {
        const authData: AuthResponse = {
          session_token: rawData.session_token,
          expires_at: rawData.expires_at,
          restaurant_id: rawData.device.restaurant_id.toString(),
          restaurant_name: rawData.device.restaurant_name,
          device_name: rawData.device.name,
        };

        await this.storeAuthData(authData);
        // Store device credentials securely
        await secureSet(SECURE_KEYS.DEVICE_CREDENTIALS, JSON.stringify(credentials));

        return { success: true, data: authData };
      }

      return { success: false, error: 'Invalid response from server' };
    } catch (error) {
      const axiosError = error as AxiosError<any>;
      return {
        success: false,
        error: axiosError.response?.data?.error || axiosError.response?.data?.message || 'Login failed. Please check your credentials.',
      };
    }
  }

  async logout(): Promise<void> {
    await this.clearAllStoredData();
  }

  private async clearAllStoredData(): Promise<void> {
    console.log('[API] Clearing all stored credentials and data');
    this.sessionToken = null;
    this.tokenExpiry = null;
    this.deviceCredentials = null;
    await Promise.all([
      // Clear sensitive data from SecureStore
      secureDelete(SECURE_KEYS.SESSION_TOKEN),
      secureDelete(SECURE_KEYS.TOKEN_EXPIRY),
      secureDelete(SECURE_KEYS.DEVICE_CREDENTIALS),
      // Clear non-sensitive data from AsyncStorage
      AsyncStorage.removeItem(STORAGE_KEYS.RESTAURANT_INFO),
    ]);
  }

  async isAuthenticated(): Promise<boolean> {
    await this.loadStoredToken();
    return this.sessionToken !== null && this.tokenExpiry !== null && this.tokenExpiry > new Date();
  }

  async getStoredCredentials(): Promise<DeviceCredentials | null> {
    try {
      const stored = await secureGet(SECURE_KEYS.DEVICE_CREDENTIALS);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  }

  async getRestaurantInfo(): Promise<{ restaurant_id: string; restaurant_name: string; device_name: string } | null> {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEYS.RESTAURANT_INFO);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  }

  // ==================== Order Methods ====================

  async getOrders(params?: {
    status?: OrderStatus;
    since?: string;
    limit?: number;
  }): Promise<ApiResponse<OrdersListResponse>> {
    try {
      const response = await this.client.get<any>(
        '/api/tablet/orders',
        { params }
      );
      
      console.log('[API] Raw orders response (first 500 chars):', JSON.stringify(response.data).substring(0, 500));
      
      // Debug: log raw order IDs from API
      if (response.data?.orders?.length > 0) {
        const firstOrder = response.data.orders[0];
        console.log(`[API] First order raw fields - id: "${firstOrder.id}", uuid: "${firstOrder.uuid}", order_number: "${firstOrder.order_number}"`);
      }
      
      // Backend returns { orders: [], total_count, ... } directly, not wrapped in { success, data }
      const rawData = response.data;
      
      if (rawData && Array.isArray(rawData.orders)) {
        // Transform orders to match our internal format
        const transformedOrders = rawData.orders.map((order: any) => ({
          id: order.id?.toString() || '',
          numeric_id: typeof order.numeric_id === 'number'
            ? order.numeric_id
            : typeof order.numeric_id === 'string'
              ? parseInt(order.numeric_id, 10) || 0
              : typeof order.id === 'number'
                ? order.id
                : parseInt(order.id, 10) || 0,
          order_number: order.order_number || '',
          status: order.order_status || order.status || 'pending',
          order_type: order.order_type || 'pickup',
          created_at: order.created_at || new Date().toISOString(),
          acknowledged_at:
            order.acknowledged_at || order.acknowledgedAt || null,
          customer: order.customer || {},
          items: (order.items || []).map((item: any) => ({
            name: item.name || '',
            quantity: item.quantity || 1,
            price: item.unit_price || item.price || 0,
            notes: item.special_instructions || item.notes || '',
            modifiers: item.modifiers || [],
          })),
          subtotal: order.subtotal || 0,
          tax: order.tax_amount || order.tax || 0,
          delivery_fee: order.delivery_fee || 0,
          tip: order.tip_amount || order.tip || 0,
          total: order.total_amount || order.total || 0,
          notes: order.notes || '',
          delivery_address: order.delivery_address,
          estimated_ready_time: order.estimated_ready_time,
        }));
        
        console.log('[API] Transformed', transformedOrders.length, 'orders');
        if (transformedOrders.length > 0) {
          console.log(`[API] First transformed order ID: "${transformedOrders[0].id}"`);
        }
        
        return {
          success: true,
          data: {
            orders: transformedOrders,
            total: rawData.total_count || transformedOrders.length,
          },
        };
      }
      
      return {
        success: true,
        data: { orders: [], total: 0 },
      };
    } catch (error) {
      const axiosError = error as AxiosError<any>;
      console.error('[API] getOrders error:', axiosError.message, axiosError.response?.data);
      return {
        success: false,
        error: axiosError.response?.data?.error || 'Failed to fetch orders',
      };
    }
  }

  async getOrder(orderId: string): Promise<ApiResponse<Order>> {
    try {
      const response = await this.client.get<ApiResponse<Order>>(
        `/api/tablet/orders/${orderId}`
      );
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError<ApiResponse<never>>;
      return {
        success: false,
        error: axiosError.response?.data?.error || 'Failed to fetch order',
      };
    }
  }

  async acknowledgeOrder(orderId: string): Promise<ApiResponse<Order>> {
    try {
      const response = await this.client.post<ApiResponse<Order>>(
        `/api/tablet/orders/${orderId}`
      );
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError<ApiResponse<never>>;
      return {
        success: false,
        error: axiosError.response?.data?.error || 'Failed to acknowledge order',
      };
    }
  }

  async updateOrderStatus(
    orderId: string,
    status: OrderStatus
  ): Promise<ApiResponse<Order>> {
    const endpoint = `/api/tablet/orders/${orderId}/status`;
    console.log(`[API] ====== STATUS UPDATE REQUEST ======`);
    console.log(`[API] URL: ${BASE_URL}${endpoint}`);
    console.log(`[API] Order ID: "${orderId}" (type: ${typeof orderId})`);
    console.log(`[API] Status: "${status}"`);
    console.log(`[API] Auth Token: ${this.sessionToken ? 'Present (' + this.sessionToken.substring(0, 20) + '...)' : 'MISSING!'}`);
    
    try {
      const response = await this.client.patch<any>(endpoint, { status });
      
      console.log(`[API] ====== STATUS UPDATE RESPONSE ======`);
      console.log(`[API] HTTP Status: ${response.status}`);
      console.log('[API] Response:', JSON.stringify(response.data));
      
      // Backend returns { success: true, order: {...}, status_history: [...] }
      if (response.data?.success) {
        console.log(`[API] ✓ SUCCESS`);
        return {
          success: true,
          data: response.data.order,
        };
      }
      
      console.log(`[API] ✗ API returned success=false`);
      return {
        success: false,
        error: response.data?.error || 'Unknown error',
      };
    } catch (error) {
      const axiosError = error as AxiosError<any>;
      console.error(`[API] ====== STATUS UPDATE ERROR ======`);
      console.error(`[API] HTTP Status: ${axiosError.response?.status || 'N/A'}`);
      console.error(`[API] Error: ${axiosError.message}`);
      console.error(`[API] Response Body:`, JSON.stringify(axiosError.response?.data));
      
      const errorMsg = axiosError.response?.data?.error 
        || axiosError.response?.data?.message 
        || axiosError.message;
      
      return {
        success: false,
        error: `${errorMsg} (HTTP ${axiosError.response?.status || '?'})`,
      };
    }
  }

  // ==================== Health/Heartbeat Methods ====================

  async sendHeartbeat(payload: HeartbeatPayload): Promise<ApiResponse<HeartbeatResponse>> {
    try {
      console.log('[API] Sending heartbeat...');
      const response = await this.client.post<any>(
        '/api/tablet/heartbeat',
        payload
      );
      
      // Backend may return data directly, not wrapped
      const data = response.data;
      console.log('[API] Heartbeat response:', data);
      
      return {
        success: true,
        data: data,
      };
    } catch (error) {
      const axiosError = error as AxiosError<any>;
      console.error('[API] Heartbeat error:', axiosError.message);
      return {
        success: false,
        error: axiosError.response?.data?.error || 'Failed to send heartbeat',
      };
    }
  }

  // ==================== RestoZone Driver Dispatch Methods ====================

  /**
   * Check if driver dispatch is available for an order.
   * Returns dispatch_available: true for restaurants with a configured delivery provider.
   */
  async checkDispatchAvailable(orderId: string): Promise<ApiResponse<DispatchAvailabilityResponse>> {
    const endpoint = `/api/tablet/orders/${orderId}/dispatch-driver`;
    console.log(`[API] Checking dispatch availability for order ${orderId}...`);
    
    try {
      const response = await this.client.get<any>(endpoint);
      console.log('[API] Dispatch availability response:', response.data);
      
      // Handle both old format (uses_restozone) and new format (provider object)
      const rawData = response.data;
      let normalizedData: DispatchAvailabilityResponse;
      
      if (rawData.provider) {
        // New format - already has provider object
        normalizedData = rawData as DispatchAvailabilityResponse;
      } else if (rawData.uses_restozone && rawData.restozone_id) {
        // Old format - transform to new format
        normalizedData = {
          dispatch_available: rawData.dispatch_available ?? true,
          provider: {
            code: 'restozone',
            name: 'RestoZone',
            external_id: String(rawData.restozone_id),
          },
        };
        console.log('[API] Transformed old format to new provider format:', normalizedData);
      } else {
        // Unknown format or dispatch not available
        normalizedData = {
          dispatch_available: rawData.dispatch_available ?? false,
          provider: null,
        };
      }
      
      return {
        success: true,
        data: normalizedData,
      };
    } catch (error) {
      const axiosError = error as AxiosError<any>;
      // 404 or other errors mean dispatch is not available for this restaurant
      console.log('[API] Dispatch not available:', axiosError.response?.status, axiosError.message);
      return {
        success: true,
        data: { 
          dispatch_available: false,
          provider: null,
        },
      };
    }
  }

  /**
   * Request a driver for a delivery order via configured delivery provider.
   */
  async dispatchDriver(
    orderId: string,
    overrides?: DispatchDriverRequest
  ): Promise<ApiResponse<DispatchDriverResponse>> {
    const endpoint = `/api/tablet/orders/${orderId}/dispatch-driver`;
    console.log(`[API] Requesting driver for order ${orderId}...`);
    
    try {
      const response = await this.client.post<DispatchDriverResponse>(
        endpoint,
        overrides || {}
      );
      console.log('[API] Dispatch driver response:', response.data);
      
      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      const axiosError = error as AxiosError<any>;
      console.error('[API] Dispatch driver error:', axiosError.response?.status, axiosError.message);
      
      const errorMsg = axiosError.response?.data?.error 
        || axiosError.response?.data?.message 
        || 'Failed to request driver';
      
      return {
        success: false,
        error: `${errorMsg} (HTTP ${axiosError.response?.status || '?'})`,
      };
    }
  }
}

// Export singleton instance
export const apiClient = new ApiClient();
