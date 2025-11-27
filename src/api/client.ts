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
      const response = await this.client.get<ApiResponse<OrdersListResponse>>(
        '/api/tablet/orders',
        { params }
      );
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError<ApiResponse<never>>;
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
      const response = await this.client.patch<ApiResponse<Order>>(
        `/api/tablet/orders/${orderId}/status`,
        { status }
      );
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError<ApiResponse<never>>;
      return {
        success: false,
        error: axiosError.response?.data?.error || 'Failed to update order status',
      };
    }
  }

  // ==================== Health/Heartbeat Methods ====================

  async sendHeartbeat(payload: HeartbeatPayload): Promise<ApiResponse<HeartbeatResponse>> {
    try {
      const response = await this.client.post<ApiResponse<HeartbeatResponse>>(
        '/api/tablet/heartbeat',
        payload
      );
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError<ApiResponse<never>>;
      return {
        success: false,
        error: axiosError.response?.data?.error || 'Failed to send heartbeat',
      };
    }
  }
}

// Export singleton instance
export const apiClient = new ApiClient();
