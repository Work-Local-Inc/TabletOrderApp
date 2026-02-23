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
  TabletServiceConfig,
  RecoveryCommand,
} from '../types';
import { addBreadcrumb, captureException } from '../config/sentry';

const normalizeBaseUrl = (url: string): string => {
  return url.trim().replace(/\/+$/, '');
};

export const DEFAULT_API_BASE_URL = normalizeBaseUrl('https://menuai.ca');

// SECURITY: Sensitive keys stored in SecureStore (OS keychain/keystore)
// Non-sensitive keys remain in AsyncStorage for performance
const SECURE_KEYS = {
  SESSION_TOKEN: 'tablet_session_token',      // SecureStore (sensitive)
  TOKEN_EXPIRY: 'tablet_token_expiry',        // SecureStore (sensitive)
  DEVICE_CREDENTIALS: 'tablet_device_creds',  // SecureStore (sensitive)
};

const STORAGE_KEYS = {
  RESTAURANT_INFO: '@tablet_restaurant_info', // AsyncStorage (non-sensitive, display only)
  API_BASE_URL: '@tablet_api_base_url',       // Legacy key (single-backend mode no longer reads it)
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
  private baseUrl: string = DEFAULT_API_BASE_URL;

  private isAuthEndpoint(url?: string, headers?: Record<string, any>): boolean {
    return (
      !!url &&
      (url.includes('/api/tablet/auth/login') ||
        url.includes('/api/tablet/auth/refresh') ||
        url.includes('/auth/login') ||
        url.includes('/auth/refresh'))
    ) || headers?.['x-skip-auth-refresh'] === '1';
  }

  constructor() {
    this.client = axios.create({
      baseURL: DEFAULT_API_BASE_URL,
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

        const isAuthRequest = this.isAuthEndpoint(config.url, config.headers as any);

        // Never trigger token refresh logic from auth endpoints (prevents self-deadlock).
        if (!isAuthRequest && this.shouldRefreshToken()) {
          await this.refreshToken();
        }

        if (this.sessionToken && !config.headers.Authorization && !config.url?.includes('/auth/login')) {
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

        const isAuthEndpoint = this.isAuthEndpoint(
          error.config?.url,
          error.config?.headers as any
        );

        if (error.response?.status === 401 && !isAuthEndpoint) {
          // Token expired, try to refresh
          const refreshed = await this.refreshToken();
          if (refreshed && error.config) {
            // Retry the original request
            error.config.headers.Authorization = `Bearer ${this.sessionToken}`;
            return this.client.request(error.config);
          } else {
            // Refresh failed - try auto re-login with stored device credentials
            const relogged = await this.reloginWithStoredCredentials();
            if (relogged && error.config) {
              error.config.headers.Authorization = `Bearer ${this.sessionToken}`;
              return this.client.request(error.config);
            }
            // If auto re-login fails, clear session (but keep device creds)
            console.log('[API] Token refresh failed; clearing session token (keeping device creds)');
            await this.clearAllStoredData(true);
          }
        }
        return Promise.reject(error);
      }
    );

    // Load stored token on initialization
    this.loadStoredToken();
    this.loadBaseUrl();
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

  private async loadBaseUrl(): Promise<void> {
    try {
      // Single-backend mode: force to compile-time default and discard legacy overrides.
      this.baseUrl = DEFAULT_API_BASE_URL;
      this.client.defaults.baseURL = DEFAULT_API_BASE_URL;
      await AsyncStorage.removeItem(STORAGE_KEYS.API_BASE_URL);
      console.log(`[API] Base URL locked: ${DEFAULT_API_BASE_URL}`);
    } catch (error) {
      console.error('[API] Failed to initialize base URL, using default:', error);
      this.baseUrl = DEFAULT_API_BASE_URL;
      this.client.defaults.baseURL = DEFAULT_API_BASE_URL;
    }
  }

  async setBaseUrl(url: string): Promise<void> {
    const normalized = normalizeBaseUrl(url);
    if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
      throw new Error('API URL must start with http:// or https://');
    }
    if (normalized !== DEFAULT_API_BASE_URL) {
      throw new Error('API URL override is disabled in this build');
    }

    this.baseUrl = DEFAULT_API_BASE_URL;
    this.client.defaults.baseURL = DEFAULT_API_BASE_URL;
    await AsyncStorage.removeItem(STORAGE_KEYS.API_BASE_URL);
    addBreadcrumb('API base URL locked', 'config', { baseUrl: DEFAULT_API_BASE_URL });
    console.log(`[API] Base URL set: ${DEFAULT_API_BASE_URL}`);
  }

  async getBaseUrl(): Promise<string> {
    return DEFAULT_API_BASE_URL;
  }

  async resetBaseUrl(): Promise<void> {
    await this.setBaseUrl(DEFAULT_API_BASE_URL);
  }

  private shouldRefreshToken(): boolean {
    if (!this.tokenExpiry) return false;
    // Refresh if less than 1 hour until expiry
    const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
    return this.tokenExpiry < oneHourFromNow;
  }

  private async refreshToken(): Promise<boolean> {
    if (!this.sessionToken) {
      return false;
    }

    // Prevent multiple simultaneous refresh attempts
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      try {
        const response = await this.client.post<any>(
          '/api/tablet/auth/refresh',
          { session_token: this.sessionToken },
          {
            headers: {
              Authorization: `Bearer ${this.sessionToken}`,
            },
          }
        );

        const rawData = response.data;
        const refreshedToken = rawData?.session_token || rawData?.data?.session_token;
        const refreshedExpiry = rawData?.expires_at || rawData?.data?.expires_at;

        if (refreshedToken && refreshedExpiry) {
          this.sessionToken = refreshedToken;
          this.tokenExpiry = new Date(refreshedExpiry);
          await Promise.all([
            secureSet(SECURE_KEYS.SESSION_TOKEN, refreshedToken),
            secureSet(SECURE_KEYS.TOKEN_EXPIRY, refreshedExpiry),
          ]);
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

  private async reloginWithStoredCredentials(): Promise<boolean> {
    try {
      const creds = this.deviceCredentials ?? (await this.getStoredCredentials());
      if (!creds) return false;

      const response = await this.client.post<any>(
        '/api/tablet/auth/login',
        creds,
        {
          headers: {
            // Prevent auth-refresh loops on failed login attempts
            'x-skip-auth-refresh': '1',
          },
        }
      );

      const rawData = response.data;
      if (rawData?.session_token && rawData?.device) {
        const authData: AuthResponse = {
          session_token: rawData.session_token,
          expires_at: rawData.expires_at,
          restaurant_id: rawData.device.restaurant_id.toString(),
          restaurant_name: rawData.device.restaurant_name,
          device_name: rawData.device.name,
        };
        await this.storeAuthData(authData);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Auto re-login failed:', error);
      return false;
    }
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
          restaurant_logo_url: auth.restaurant_logo_url ?? null,
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
        const dev = rawData.device;
        const authData: AuthResponse = {
          session_token: rawData.session_token,
          expires_at: rawData.expires_at,
          restaurant_id: dev.restaurant_id.toString(),
          restaurant_name: dev.restaurant_name,
          restaurant_logo_url:
            dev.restaurant_logo_url ||
            dev.location_logo_url ||
            dev.logo_url ||
            dev.logoUrl ||
            dev.logo ||
            null,
          device_name: dev.name,
        };

        await this.storeAuthData(authData);
        // Store device credentials securely
        await secureSet(SECURE_KEYS.DEVICE_CREDENTIALS, JSON.stringify(credentials));

        return { success: true, data: authData };
      }

      return { success: false, error: 'Invalid response from server' };
    } catch (error) {
      const axiosError = error as AxiosError<any>;
      const status = axiosError.response?.status;
      const serverError =
        axiosError.response?.data?.error || axiosError.response?.data?.message;
      const networkError = !axiosError.response
        ? `Network error contacting ${DEFAULT_API_BASE_URL}`
        : null;

      return {
        success: false,
        error:
          serverError ||
          networkError ||
          (status === 401
            ? 'Login failed. Please check your credentials.'
            : 'Login failed. Please try again.'),
      };
    }
  }

  async logout(): Promise<void> {
    await this.clearAllStoredData(false);
  }

  private async clearAllStoredData(keepDeviceCredentials = false): Promise<void> {
    console.log('[API] Clearing all stored credentials and data');
    this.sessionToken = null;
    this.tokenExpiry = null;
    if (!keepDeviceCredentials) {
      this.deviceCredentials = null;
    }
    await Promise.all([
      // Clear sensitive data from SecureStore
      secureDelete(SECURE_KEYS.SESSION_TOKEN),
      secureDelete(SECURE_KEYS.TOKEN_EXPIRY),
      ...(keepDeviceCredentials ? [] : [secureDelete(SECURE_KEYS.DEVICE_CREDENTIALS)]),
      // Clear non-sensitive data from AsyncStorage
      AsyncStorage.removeItem(STORAGE_KEYS.RESTAURANT_INFO),
    ]);
  }

  async isAuthenticated(): Promise<boolean> {
    await this.loadStoredToken();
    if (this.sessionToken !== null && this.tokenExpiry !== null && this.tokenExpiry > new Date()) {
      return true;
    }
    // Attempt silent re-login using stored device credentials
    return this.reloginWithStoredCredentials();
  }

  async getStoredCredentials(): Promise<DeviceCredentials | null> {
    try {
      const stored = await secureGet(SECURE_KEYS.DEVICE_CREDENTIALS);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  }

  async getRestaurantInfo(): Promise<{ restaurant_id: string; restaurant_name: string; restaurant_logo_url: string | null; device_name: string } | null> {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEYS.RESTAURANT_INFO);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  }

  async getRestaurantLocationLogoUrl(restaurantId: string): Promise<string | null> {
    const pickUrl = (candidate: any): string | null => {
      const maybe = [
        candidate?.location_logo_url,
        candidate?.locationLogoUrl,
        candidate?.restaurant_logo_url,
        candidate?.restaurantLogoUrl,
        candidate?.logo_url,
        candidate?.logoUrl,
        candidate?.logo,
        candidate?.image_url,
        candidate?.imageUrl,
        candidate?.image,
        candidate?.url,
        candidate?.src,
      ].find((value) => typeof value === 'string' && value.length > 0);
      if (typeof maybe !== 'string') return null;
      if (maybe.startsWith('http')) return maybe;
      if (maybe.startsWith('/')) return `${this.baseUrl}${maybe}`;
      return null;
    };

    const pickFromLocationsPayload = (payload: any): string | null => {
      const locations = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.locations)
          ? payload.locations
          : Array.isArray(payload?.data)
            ? payload.data
            : Array.isArray(payload?.data?.locations)
              ? payload.data.locations
              : null;
      if (!Array.isArray(locations) || locations.length === 0) return null;
      const primary =
        locations.find((loc: any) => loc?.is_primary || loc?.primary || loc?.isPrimary) ?? locations[0];
      return pickUrl(primary);
    };

    try {
      const response = await this.client.get<any>(`/api/restaurants/${restaurantId}`);
      const payload = response.data?.data ?? response.data;
      const direct = pickUrl(payload) ?? pickUrl(payload?.restaurant);
      if (direct) return direct;
      const fromLocations = pickFromLocationsPayload(payload);
      if (fromLocations) return fromLocations;
    } catch {
      // ignore; device token may not have Admin access
    }

    try {
      const response = await this.client.get<any>(`/api/restaurants/${restaurantId}/locations`);
      const payload = response.data?.data ?? response.data;
      const fromLocations = pickFromLocationsPayload(payload);
      if (fromLocations) return fromLocations;
    } catch {
      // ignore; device token may not have Admin access
    }

    try {
      const response = await this.client.get<any>(`/api/restaurants/${restaurantId}/images`);
      const payload = response.data?.data ?? response.data;
      const images = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.images)
          ? payload.images
          : Array.isArray(payload?.data)
            ? payload.data
            : null;
      if (Array.isArray(images) && images.length > 0) {
        const preferred =
          images.find((img: any) => img?.type === 'logo' || img?.kind === 'logo' || img?.tag === 'logo') ??
          images[0];
        const url = pickUrl(preferred);
        if (url) return url;
      }
    } catch {
      // ignore
    }

    return null;
  }

  private mapOrder(rawOrder: any): Order {
    const normalizedId = rawOrder?.id?.toString?.() || '';
    const normalizedNumericId =
      typeof rawOrder?.numeric_id === 'number'
        ? rawOrder.numeric_id
        : typeof rawOrder?.numeric_id === 'string'
          ? parseInt(rawOrder.numeric_id, 10) || 0
          : typeof rawOrder?.id === 'number'
            ? rawOrder.id
            : parseInt(rawOrder?.id, 10) || 0;

    return {
      id: normalizedId,
      numeric_id: normalizedNumericId,
      order_number: rawOrder?.order_number || '',
      restaurant_id:
        rawOrder?.restaurant_id?.toString?.() ||
        rawOrder?.restaurant_uuid?.toString?.() ||
        '',
      status: rawOrder?.order_status || rawOrder?.status || 'pending',
      order_type: rawOrder?.order_type || 'pickup',
      created_at: rawOrder?.created_at || new Date().toISOString(),
      updated_at: rawOrder?.updated_at || rawOrder?.created_at || new Date().toISOString(),
      acknowledged_at: rawOrder?.acknowledged_at || rawOrder?.acknowledgedAt || undefined,
      customer: rawOrder?.customer || { name: 'Customer', phone: '' },
      items: (rawOrder?.items || []).map((item: any) => ({
        id:
          item?.id?.toString?.() ||
          item?.dish_id?.toString?.() ||
          `${normalizedId}-${item?.name || 'item'}`,
        name: item?.name || '',
        size: item?.size || item?.item_size || item?.variant || '',
        quantity: item?.quantity || 1,
        price: item?.unit_price || item?.price || 0,
        notes: item?.special_instructions || item?.notes || '',
        modifiers: item?.modifiers || [],
      })),
      subtotal: rawOrder?.subtotal || 0,
      tax: rawOrder?.tax_amount || rawOrder?.tax || 0,
      delivery_fee: rawOrder?.delivery_fee || 0,
      tip: rawOrder?.tip_amount || rawOrder?.tip || 0,
      total: rawOrder?.total_amount || rawOrder?.total || 0,
      notes: rawOrder?.notes || rawOrder?.special_instructions || '',
      delivery_address: rawOrder?.delivery_address,
      estimated_ready_time: rawOrder?.estimated_ready_time,
    };
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
        const transformedOrders = rawData.orders.map((order: any) => this.mapOrder(order));
        
        console.log('[API] Transformed', transformedOrders.length, 'orders');
        if (transformedOrders.length > 0) {
          console.log(`[API] First transformed order ID: "${transformedOrders[0].id}"`);
        }
        
        return {
          success: true,
          data: {
            orders: transformedOrders,
            total: rawData.total_count || transformedOrders.length,
            has_more: Boolean(rawData.has_more ?? rawData.hasMore ?? false),
          },
        };
      }
      
      return {
        success: true,
        data: { orders: [], total: 0, has_more: false },
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
      const response = await this.client.get<any>(
        `/api/tablet/orders/${orderId}`
      );
      if (response.data?.success === false) {
        return {
          success: false,
          error: response.data?.error || 'Failed to fetch order',
        };
      }
      const rawData = response.data?.order || response.data?.data || response.data;

      if (rawData) {
        return { success: true, data: this.mapOrder(rawData) };
      }

      return { success: false, error: 'Invalid response from server' };
    } catch (error) {
      const axiosError = error as AxiosError<ApiResponse<never>>;
      return {
        success: false,
        error: axiosError.response?.data?.error || 'Failed to fetch order',
      };
    }
  }

  async acknowledgeOrder(orderId: string, acknowledgedAt?: string): Promise<ApiResponse<{ acknowledged_at?: string }>> {
    try {
      const payload = acknowledgedAt ? { acknowledged_at: acknowledgedAt } : undefined;
      const response = await this.client.post<any>(
        `/api/tablet/orders/${orderId}`,
        payload
      );
      const rawData = response.data;
      if (rawData?.success) {
        return {
          success: true,
          data: { acknowledged_at: rawData.acknowledged_at || acknowledgedAt },
        };
      }
      return {
        success: false,
        error: rawData?.error || 'Failed to acknowledge order',
      };
    } catch (error) {
      const axiosError = error as AxiosError<any>;
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
    console.log(`[API] URL: ${(this.client.defaults.baseURL || this.baseUrl)}${endpoint}`);
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
      const data = response.data || {};
      if (data.config_update && !data.config_updates) {
        data.config_updates = data.config_update;
      }
      if (data.config_updates && !data.config_update) {
        data.config_update = data.config_updates;
      }
      if (data.recovery_command) {
        const rawCommand = data.recovery_command as any;
        const normalizedCommand: RecoveryCommand = {
          id: rawCommand?.id || rawCommand?.command_id,
          action: rawCommand?.action,
          reason: rawCommand?.reason || null,
          issued_at: rawCommand?.issued_at || new Date().toISOString(),
          payload: rawCommand?.payload ?? rawCommand?.command_payload ?? null,
        };

        if (!normalizedCommand.id || !normalizedCommand.action) {
          console.warn('[API] Ignoring malformed recovery command payload:', rawCommand);
          delete data.recovery_command;
        } else {
          data.recovery_command = normalizedCommand;
        }
      }
      console.log('[API] Heartbeat response:', data);
      
      return {
        success: data.success !== false,
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

  // ==================== Tablet Service Config Methods ====================

  private toBoolean(value: unknown, fallback: boolean | null = null): boolean | null {
    if (typeof value === 'boolean') return value;
    if (value === 1 || value === '1') return true;
    if (value === 0 || value === '0') return false;
    return fallback;
  }

  private toNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private unwrapTabletServicePayload(rawData: any): any {
    if (rawData && typeof rawData === 'object' && rawData.data && typeof rawData.data === 'object') {
      return rawData.data;
    }
    return rawData;
  }

  private normalizeTabletServiceConfig(rawData: any): TabletServiceConfig | null {
    const payload = this.unwrapTabletServicePayload(rawData);
    const hasDeliveryEnabled = this.toBoolean(
      payload?.has_delivery_enabled ?? payload?.delivery_enabled,
      null
    );
    if (hasDeliveryEnabled === null) {
      return null;
    }

    return {
      config_id: this.toNumber(payload?.config_id),
      has_delivery_enabled: hasDeliveryEnabled,
      pickup_enabled: this.toBoolean(payload?.pickup_enabled, true) ?? true,
      takeout_time_minutes: this.toNumber(payload?.takeout_time_minutes),
      busy_takeout_time_minutes: this.toNumber(payload?.busy_takeout_time_minutes),
      busy_mode_enabled: this.toBoolean(payload?.busy_mode_enabled, false) ?? false,
      twilio_call: this.toBoolean(payload?.twilio_call, false) ?? false,
      online_ordering_enabled:
        this.toBoolean(payload?.online_ordering_enabled, true) ?? true,
    };
  }

  async getTabletServiceConfig(): Promise<ApiResponse<TabletServiceConfig>> {
    try {
      const response = await this.client.get<any>('/api/tablet/service-config');
      const normalized = this.normalizeTabletServiceConfig(response.data);

      if (!normalized) {
        console.warn('[API] Unrecognized tablet service-config payload:', response.data);
        return { success: false, error: 'Invalid response from server' };
      }

      return {
        success: true,
        data: normalized,
      };
    } catch (error) {
      const axiosError = error as AxiosError<any>;
      return {
        success: false,
        error: axiosError.response?.data?.error || 'Failed to fetch service config',
      };
    }
  }

  async updateTabletServiceConfig(
    updates: Partial<
      Pick<
        TabletServiceConfig,
        | 'has_delivery_enabled'
        | 'pickup_enabled'
        | 'takeout_time_minutes'
        | 'busy_takeout_time_minutes'
        | 'busy_mode_enabled'
        | 'twilio_call'
        | 'online_ordering_enabled'
      >
    >
  ): Promise<ApiResponse<TabletServiceConfig>> {
    try {
      const response = await this.client.patch<any>('/api/tablet/service-config', updates);
      const rawData = response.data;
      const normalized = this.normalizeTabletServiceConfig(rawData);

      if (rawData?.success === false) {
        return {
          success: false,
          error: rawData?.error || 'Failed to update service config',
        };
      }

      if (normalized) {
        return {
          success: true,
          data: normalized,
        };
      }

      console.warn('[API] Unrecognized tablet service-config update payload:', rawData);
      return {
        success: false,
        error: rawData?.error || 'Failed to update service config',
      };
    } catch (error) {
      const axiosError = error as AxiosError<any>;
      return {
        success: false,
        error: axiosError.response?.data?.error || 'Failed to update service config',
      };
    }
  }

  async getDeliveryConfig(): Promise<ApiResponse<TabletServiceConfig>> {
    return this.getTabletServiceConfig();
  }

  async updateDeliveryEnabled(hasDeliveryEnabled: boolean): Promise<ApiResponse<TabletServiceConfig>> {
    return this.updateTabletServiceConfig({ has_delivery_enabled: hasDeliveryEnabled });
  }

  async acknowledgeRecoveryCommand(
    commandId: string,
    status: 'executed' | 'failed',
    result?: string
  ): Promise<ApiResponse<{ acknowledged: boolean }>> {
    try {
      const response = await this.client.post<any>(
        '/api/tablet/recovery-ack',
        {
          command_id: commandId,
          status,
          result,
        }
      );

      if (response.data?.success) {
        return { success: true, data: { acknowledged: true } };
      }

      return {
        success: false,
        error: response.data?.error || 'Failed to acknowledge recovery command',
      };
    } catch (error) {
      const axiosError = error as AxiosError<any>;
      return {
        success: false,
        error: axiosError.response?.data?.error || 'Failed to acknowledge recovery command',
      };
    }
  }
}

// Export singleton instance
export const apiClient = new ApiClient();
