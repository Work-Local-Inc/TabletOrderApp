import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ApiResponse,
  AuthResponse,
  DeviceCredentials,
  Order,
  OrdersListResponse,
  OrderStatus,
  HeartbeatPayload,
  HeartbeatResponse,
} from '../types';

const BASE_URL = 'https://39d6a4b9-a0f2-4544-a607-a9203b1fa6a8-00-1qkpr2vwm16p5.riker.replit.dev';

const STORAGE_KEYS = {
  SESSION_TOKEN: '@tablet_session_token',
  TOKEN_EXPIRY: '@tablet_token_expiry',
  DEVICE_CREDENTIALS: '@tablet_device_credentials',
  RESTAURANT_INFO: '@tablet_restaurant_info',
};

class ApiClient {
  private client: AxiosInstance;
  private sessionToken: string | null = null;
  private tokenExpiry: Date | null = null;
  private refreshPromise: Promise<boolean> | null = null;

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
        if (error.response?.status === 401) {
          // Token expired, try to refresh
          const refreshed = await this.refreshToken();
          if (refreshed && error.config) {
            // Retry the original request
            error.config.headers.Authorization = `Bearer ${this.sessionToken}`;
            return this.client.request(error.config);
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
      const [token, expiry] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.SESSION_TOKEN),
        AsyncStorage.getItem(STORAGE_KEYS.TOKEN_EXPIRY),
      ]);

      if (token && expiry) {
        this.sessionToken = token;
        this.tokenExpiry = new Date(expiry);
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
      AsyncStorage.setItem(STORAGE_KEYS.SESSION_TOKEN, auth.session_token),
      AsyncStorage.setItem(STORAGE_KEYS.TOKEN_EXPIRY, auth.expires_at),
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
        await AsyncStorage.setItem(
          STORAGE_KEYS.DEVICE_CREDENTIALS,
          JSON.stringify(credentials)
        );

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
    this.sessionToken = null;
    this.tokenExpiry = null;
    await Promise.all([
      AsyncStorage.removeItem(STORAGE_KEYS.SESSION_TOKEN),
      AsyncStorage.removeItem(STORAGE_KEYS.TOKEN_EXPIRY),
      AsyncStorage.removeItem(STORAGE_KEYS.RESTAURANT_INFO),
    ]);
  }

  async isAuthenticated(): Promise<boolean> {
    await this.loadStoredToken();
    return this.sessionToken !== null && this.tokenExpiry !== null && this.tokenExpiry > new Date();
  }

  async getStoredCredentials(): Promise<DeviceCredentials | null> {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEYS.DEVICE_CREDENTIALS);
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
      
      console.log('[API] Raw orders response:', JSON.stringify(response.data).substring(0, 200));
      
      // Backend returns { orders: [], total_count, ... } directly, not wrapped in { success, data }
      const rawData = response.data;
      
      if (rawData && Array.isArray(rawData.orders)) {
        // Transform orders to match our internal format
        const transformedOrders = rawData.orders.map((order: any) => ({
          id: order.id?.toString() || '',
          order_number: order.order_number || '',
          status: order.order_status || order.status || 'pending',
          order_type: order.order_type || 'pickup',
          created_at: order.created_at || new Date().toISOString(),
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
    try {
      console.log(`[API] Updating order ${orderId} to status: ${status}`);
      const response = await this.client.patch<any>(
        `/api/tablet/orders/${orderId}/status`,
        { status }
      );
      
      console.log('[API] Status update response:', JSON.stringify(response.data));
      
      // Backend returns { success: true, order: {...}, status_history: [...] }
      if (response.data?.success) {
        return {
          success: true,
          data: response.data.order,
        };
      }
      
      return {
        success: false,
        error: response.data?.error || 'Unknown error',
      };
    } catch (error) {
      const axiosError = error as AxiosError<any>;
      console.error('[API] Status update FAILED:', axiosError.message);
      console.error('[API] Response:', axiosError.response?.data);
      return {
        success: false,
        error: axiosError.response?.data?.error || 'Failed to update order status',
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
}

// Export singleton instance
export const apiClient = new ApiClient();
