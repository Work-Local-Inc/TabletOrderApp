// Order Types
export interface OrderItem {
  id: string;
  name: string;
  quantity: number;
  price: number;
  modifiers?: OrderModifier[];
  notes?: string;
}

export interface OrderModifier {
  id: string;
  name: string;
  price: number;
  quantity?: number; // Quantity of this modifier (e.g., "extra cheese x2")
  placement?: 'whole' | 'left' | 'right' | null;
}

export interface CustomerInfo {
  name: string;
  phone: string;
  email?: string;
}

export interface DeliveryAddress {
  street: string;
  unit?: string;
  city: string;
  province?: string;              // province/state
  postalCode?: string;            // camelCase version
  postal_code?: string;           // snake_case version (API uses this)
  instructions?: string;          // Delivery instructions
  delivery_instructions?: string; // Alternative field name for instructions
}

export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'out_for_delivery'
  | 'delivered'
  | 'completed'
  | 'cancelled';

export type OrderType = 'pickup' | 'delivery' | 'dine_in';

export interface Order {
  id: string;
  order_number: string;
  restaurant_id: string;
  status: OrderStatus;
  order_type: OrderType;
  items: OrderItem[];
  customer: CustomerInfo;
  delivery_address?: DeliveryAddress;
  subtotal: number;
  tax: number;
  tip?: number;
  delivery_fee?: number;
  total: number;
  notes?: string;
  estimated_ready_time?: string;
  created_at: string;
  updated_at: string;
  acknowledged_at?: string;
}

// Device/Auth Types
export interface DeviceCredentials {
  device_uuid: string;
  device_key: string;
}

export interface AuthResponse {
  session_token: string;
  expires_at: string;
  restaurant_id: string;
  restaurant_name: string;
  device_name: string;
}

export interface DeviceConfig {
  poll_interval_ms: number;
  auto_print: boolean;
  sound_enabled: boolean;
  notification_tone: string;
  printer_connected: boolean;
}

// Heartbeat Types
export interface HeartbeatPayload {
  battery_level?: number;
  wifi_strength?: number;
  printer_status?: 'connected' | 'disconnected' | 'error';
  app_version: string;
  last_order_received?: string;
}

export interface HeartbeatResponse {
  config_updates?: Partial<DeviceConfig>;
  server_time: string;
}

// API Response Types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface OrdersListResponse {
  orders: Order[];
  total: number;
  has_more: boolean;
}

// Offline Queue Types
export interface QueuedAction {
  id: string;
  type: 'acknowledge' | 'status_update';
  order_id: string;
  payload: any;
  created_at: string;
  retry_count: number;
}

// Dispatch Types (Delivery Provider Integration)
export interface DispatchProvider {
  code: string;           // 'restozone', 'tookan', etc.
  name: string;           // 'RestoZone', 'Tookan', etc.
  external_id: string;    // Restaurant's ID in provider's system
}

export interface DispatchAvailabilityResponse {
  dispatch_available: boolean;
  provider: DispatchProvider | null;
}

export interface DispatchDriverResponse {
  success: boolean;
  order_id: number;
  provider: string;           // Provider code used
  used_backup_email: boolean;
  message: string;
}

export interface DispatchDriverRequest {
  prepTime?: string;        // HH:MM format
  driverEarning?: number;
  distanceKm?: number;
  postalCode?: string;
}
