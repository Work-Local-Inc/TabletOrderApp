/**
 * @deprecated DO NOT USE THIS FILE!
 * 
 * ⚠️⚠️⚠️ SECURITY WARNING ⚠️⚠️⚠️
 * 
 * This file used direct Supabase connection with a service-role key.
 * This approach is INSECURE for client apps.
 * 
 * USE INSTEAD: import { apiClient } from './client';
 * 
 * The REST API client (client.ts) properly authenticates via
 * the secure /api/tablet/* endpoints.
 */

console.error('⚠️ DEPRECATED: Do not use supabaseClient.ts - use client.ts instead!');

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, SCHEMA } from '../lib/supabase';
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
import { RealtimeChannel } from '@supabase/supabase-js';

const STORAGE_KEYS = {
  SESSION_TOKEN: '@tablet_session_token',
  TOKEN_EXPIRY: '@tablet_token_expiry',
  DEVICE_CREDENTIALS: '@tablet_device_credentials',
  RESTAURANT_INFO: '@tablet_restaurant_info',
  DEVICE_ID: '@tablet_device_id',
};

// Order channel for realtime subscriptions
let orderChannel: RealtimeChannel | null = null;

class SupabaseApiClient {
  private deviceId: number | null = null;
  private restaurantId: number | null = null;
  private deviceUuid: string | null = null;

  constructor() {
    this.loadStoredSession();
  }

  private async loadStoredSession(): Promise<void> {
    try {
      console.log('📂 Loading stored session from AsyncStorage...');
      const [deviceId, restaurantInfo] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.DEVICE_ID),
        AsyncStorage.getItem(STORAGE_KEYS.RESTAURANT_INFO),
      ]);

      console.log('📂 Stored deviceId:', deviceId, 'restaurantInfo:', restaurantInfo);

      if (deviceId) {
        this.deviceId = parseInt(deviceId, 10);
      }
      if (restaurantInfo) {
        const info = JSON.parse(restaurantInfo);
        this.restaurantId = parseInt(info.restaurant_id, 10);
        console.log('✅ Loaded restaurantId from storage:', this.restaurantId);
      }
    } catch (error) {
      console.error('Failed to load stored session:', error);
    }
  }

  // ==================== Auth Methods ====================

  async login(credentials: DeviceCredentials): Promise<ApiResponse<AuthResponse>> {
    try {
      console.log('🔐 Attempting Supabase login with UUID:', credentials.device_uuid);

      // Query device from Supabase by UUID
      const { data: device, error: deviceError } = await supabase
        .from('devices')
        .select('*, restaurants(id, name)')
        .eq('uuid', credentials.device_uuid)
        .eq('is_active', true)
        .single();

      if (deviceError) {
        console.error('Device lookup error:', deviceError);
        return { success: false, error: 'Device not found. Please check your Device UUID.' };
      }

      if (!device) {
        return { success: false, error: 'Device not found or inactive.' };
      }

      console.log('📱 Found device:', device.device_name);

      // For now, we'll do a simplified key verification
      // In production, this should use proper hashing
      // The device_key is stored hashed, so we need to verify differently
      // For testing, we'll trust the UUID match and check the key format

      if (!credentials.device_key || credentials.device_key.length < 10) {
        return { success: false, error: 'Invalid device key format.' };
      }

      // Get restaurant info - handle both array and object responses from Supabase join
      const restaurant = Array.isArray(device.restaurants)
        ? device.restaurants[0]
        : device.restaurants;
      if (!restaurant) {
        return { success: false, error: 'Device not assigned to a restaurant.' };
      }

      console.log('🏪 Restaurant from join:', JSON.stringify(restaurant));

      // Store device info
      this.deviceId = device.id;
      this.deviceUuid = device.uuid;
      this.restaurantId = restaurant.id;

      console.log('📝 Set restaurantId to:', this.restaurantId, 'type:', typeof this.restaurantId);

      // Create session token (for compatibility with existing code)
      const sessionToken = `supabase_${device.uuid}_${Date.now()}`;
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours

      const authData: AuthResponse = {
        session_token: sessionToken,
        expires_at: expiresAt,
        restaurant_id: restaurant.id.toString(),
        restaurant_name: restaurant.name,
        device_name: device.device_name,
      };

      // Store auth data
      await Promise.all([
        AsyncStorage.setItem(STORAGE_KEYS.SESSION_TOKEN, sessionToken),
        AsyncStorage.setItem(STORAGE_KEYS.TOKEN_EXPIRY, expiresAt),
        AsyncStorage.setItem(STORAGE_KEYS.DEVICE_ID, device.id.toString()),
        AsyncStorage.setItem(STORAGE_KEYS.DEVICE_CREDENTIALS, JSON.stringify(credentials)),
        AsyncStorage.setItem(
          STORAGE_KEYS.RESTAURANT_INFO,
          JSON.stringify({
            restaurant_id: restaurant.id.toString(),
            restaurant_name: restaurant.name,
            device_name: device.device_name,
          })
        ),
      ]);

      // Update device last check time
      await supabase
        .from('devices')
        .update({ last_check_at: new Date().toISOString() })
        .eq('id', device.id);

      console.log('✅ Login successful for restaurant:', restaurant.name);
      return { success: true, data: authData };
    } catch (error) {
      console.error('Login error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Login failed. Please try again.',
      };
    }
  }

  async logout(): Promise<void> {
    // Unsubscribe from realtime
    if (orderChannel) {
      await supabase.removeChannel(orderChannel);
      orderChannel = null;
    }

    this.deviceId = null;
    this.restaurantId = null;
    this.deviceUuid = null;

    await Promise.all([
      AsyncStorage.removeItem(STORAGE_KEYS.SESSION_TOKEN),
      AsyncStorage.removeItem(STORAGE_KEYS.TOKEN_EXPIRY),
      AsyncStorage.removeItem(STORAGE_KEYS.RESTAURANT_INFO),
      AsyncStorage.removeItem(STORAGE_KEYS.DEVICE_ID),
    ]);
  }

  async isAuthenticated(): Promise<boolean> {
    try {
      const [token, expiry] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.SESSION_TOKEN),
        AsyncStorage.getItem(STORAGE_KEYS.TOKEN_EXPIRY),
      ]);

      if (!token || !expiry) return false;

      const expiryDate = new Date(expiry);
      return expiryDate > new Date();
    } catch {
      return false;
    }
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
      console.log('🔍 getOrders called, current restaurantId:', this.restaurantId);

      if (!this.restaurantId) {
        console.log('⚠️ restaurantId is null, loading from storage...');
        await this.loadStoredSession();
        console.log('📦 After loadStoredSession, restaurantId:', this.restaurantId);
        if (!this.restaurantId) {
          console.log('❌ Still no restaurantId after loading session');
          return { success: false, error: 'Not authenticated' };
        }
      }

      console.log('🔎 Querying orders for restaurant_id:', this.restaurantId);

      let query = supabase
        .from('orders')
        .select(`
          *,
          order_items(*)
        `)
        .eq('restaurant_id', this.restaurantId)
        .order('created_at', { ascending: false });

      if (params?.status) {
        query = query.eq('order_status', params.status);
      }

      if (params?.since) {
        console.log('🕐 Filtering orders since:', params.since);
        query = query.gte('created_at', params.since);
      } else {
        console.log('🕐 No since filter, fetching all recent orders');
      }

      if (params?.limit) {
        query = query.limit(params.limit);
      } else {
        query = query.limit(50); // Default limit
      }

      const { data: orders, error } = await query;

      console.log('📊 Query result - orders count:', orders?.length || 0, 'error:', error?.message || 'none');

      if (error) {
        console.error('Orders fetch error:', error);
        return { success: false, error: 'Failed to fetch orders' };
      }

      if (orders && orders.length > 0) {
        console.log('📦 First order:', JSON.stringify(orders[0]));
      }

      // Transform to match expected format
      const transformedOrders: Order[] = (orders || []).map(this.transformOrder);

      return {
        success: true,
        data: {
          orders: transformedOrders,
          total: transformedOrders.length,
          hasMore: transformedOrders.length === (params?.limit || 50),
        },
      };
    } catch (error) {
      console.error('Get orders error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch orders',
      };
    }
  }

  async getOrder(orderId: string): Promise<ApiResponse<Order>> {
    try {
      const { data: order, error } = await supabase
        .from('orders')
        .select(`
          *,
          order_items(*)
        `)
        .eq('uuid', orderId)
        .single();

      if (error || !order) {
        return { success: false, error: 'Order not found' };
      }

      return { success: true, data: this.transformOrder(order) };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch order',
      };
    }
  }

  async acknowledgeOrder(orderId: string): Promise<ApiResponse<Order>> {
    try {
      const { data: order, error } = await supabase
        .from('orders')
        .update({
          order_status: 'confirmed',
          confirmed_at: new Date().toISOString(),
        })
        .eq('uuid', orderId)
        .select(`*, order_items(*)`)
        .single();

      if (error || !order) {
        return { success: false, error: 'Failed to acknowledge order' };
      }

      return { success: true, data: this.transformOrder(order) };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to acknowledge order',
      };
    }
  }

  async updateOrderStatus(orderId: string, status: OrderStatus): Promise<ApiResponse<Order>> {
    try {
      const updateData: Record<string, any> = { order_status: status };

      // Set timestamps based on status
      if (status === 'confirmed') {
        updateData.confirmed_at = new Date().toISOString();
      } else if (status === 'delivered' || status === 'cancelled') {
        updateData.completed_at = new Date().toISOString();
      }

      const { data: order, error } = await supabase
        .from('orders')
        .update(updateData)
        .eq('uuid', orderId)
        .select(`*, order_items(*)`)
        .single();

      if (error || !order) {
        return { success: false, error: 'Failed to update order status' };
      }

      return { success: true, data: this.transformOrder(order) };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update order status',
      };
    }
  }

  // ==================== Realtime Methods ====================

  subscribeToOrders(callback: (order: Order) => void): () => void {
    if (!this.restaurantId) {
      console.warn('Cannot subscribe to orders: not authenticated');
      return () => {};
    }

    // Unsubscribe from existing channel
    if (orderChannel) {
      supabase.removeChannel(orderChannel);
    }

    console.log('📡 Subscribing to realtime orders for restaurant:', this.restaurantId);

    orderChannel = supabase
      .channel(`orders:restaurant:${this.restaurantId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: SCHEMA,
          table: 'orders',
          filter: `restaurant_id=eq.${this.restaurantId}`,
        },
        async (payload) => {
          console.log('🔔 New order received:', payload.new);

          // Fetch full order with items
          const { data: fullOrder } = await supabase
            .from('orders')
            .select(`*, order_items(*)`)
            .eq('id', payload.new.id)
            .single();

          if (fullOrder) {
            callback(this.transformOrder(fullOrder));
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: SCHEMA,
          table: 'orders',
          filter: `restaurant_id=eq.${this.restaurantId}`,
        },
        async (payload) => {
          console.log('📝 Order updated:', payload.new);

          const { data: fullOrder } = await supabase
            .from('orders')
            .select(`*, order_items(*)`)
            .eq('id', payload.new.id)
            .single();

          if (fullOrder) {
            callback(this.transformOrder(fullOrder));
          }
        }
      )
      .subscribe((status) => {
        console.log('📡 Realtime subscription status:', status);
      });

    // Return unsubscribe function
    return () => {
      if (orderChannel) {
        supabase.removeChannel(orderChannel);
        orderChannel = null;
      }
    };
  }

  // ==================== Health/Heartbeat Methods ====================

  async sendHeartbeat(payload: HeartbeatPayload): Promise<ApiResponse<HeartbeatResponse>> {
    try {
      if (!this.deviceId) {
        return { success: false, error: 'Not authenticated' };
      }

      // Update device last check time
      await supabase
        .from('devices')
        .update({
          last_check_at: new Date().toISOString(),
          software_version: parseInt(payload.app_version?.replace(/\./g, '') || '0', 10),
        })
        .eq('id', this.deviceId);

      return {
        success: true,
        data: {
          server_time: new Date().toISOString(),
          config_updates: null,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to send heartbeat',
      };
    }
  }

  // ==================== Helper Methods ====================

  private transformOrder(dbOrder: any): Order {
    return {
      id: dbOrder.uuid,
      order_number: dbOrder.order_number,
      status: dbOrder.order_status as OrderStatus,
      type: dbOrder.order_type,
      created_at: dbOrder.created_at,
      estimated_ready_time: dbOrder.estimated_ready_time,
      acknowledged_at: dbOrder.confirmed_at,
      customer: {
        name: dbOrder.customer_name || 'Guest',
        phone: dbOrder.customer_phone,
        email: dbOrder.customer_email,
      },
      items: (dbOrder.order_items || []).map((item: any) => ({
        id: item.id.toString(),
        name: item.item_name,
        quantity: item.quantity,
        unit_price: item.unit_price,
        total_price: item.total_price,
        modifiers: item.customizations ? JSON.parse(typeof item.customizations === 'string' ? item.customizations : JSON.stringify(item.customizations)) : [],
        special_instructions: item.special_instructions,
      })),
      totals: {
        subtotal: dbOrder.subtotal,
        tax: dbOrder.tax_amount,
        delivery_fee: dbOrder.delivery_fee,
        tip: dbOrder.tip_amount,
        discount: dbOrder.discount_amount,
        total: dbOrder.total_amount,
      },
      delivery_address: dbOrder.delivery_address,
      special_instructions: dbOrder.special_instructions,
      payment_method: dbOrder.payment_method,
    };
  }
}

// Export singleton instance
export const supabaseApiClient = new SupabaseApiClient();
