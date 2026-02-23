// Order Types
export interface OrderItem {
  id: string;
  name: string;
  size?: string; // Item size variant (e.g., "Large", "Small", "2 x Large")
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
  group_name?: string | null; // Modifier group label (e.g., "CHOOSE YOUR SIZE", "Extra Sauce")
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

export type NotificationTone =
  | 'default'
  | 'chime'
  | 'bell'
  | 'alert'
  | 'submarine_sonar'
  | 'rotary_phone'
  | 'clown_horn';

export interface Order {
  id: string;
  numeric_id: number;
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
  restaurant_logo_url?: string | null;
  device_name: string;
}

export interface DeviceConfig {
  poll_interval_ms: number;
  auto_print: boolean;
  sound_enabled: boolean;
  notification_tone: NotificationTone;
  printer_connected: boolean;
}

// Stuck Order Detection Types
export interface StuckOrderInfo {
  order_id: string;
  order_number: string;
  status: OrderStatus;
  minutes_stuck: number;
  created_at: string;
}

// Heartbeat Types
export interface HeartbeatPayload {
  battery_level?: number;
  wifi_strength?: number;
  printer_status?: 'connected' | 'disconnected' | 'error';
  app_version: string;
  last_order_received?: string;
  last_successful_fetch?: string;
  consecutive_fetch_failures?: number;
  oldest_pending_order_minutes?: number;
  // Stuck order detection - orders that haven't progressed
  stuck_orders?: StuckOrderInfo[];
}

export type RecoveryCommandAction =
  | 'resync'
  | 'reload_app'
  | 'clear_offline_queue'
  | 'reset_api_base_url'
  | 'set_api_base_url'
  | 'check_for_update';

export interface RecoveryCommand {
  id: string;
  action: RecoveryCommandAction;
  reason?: string | null;
  issued_at: string;
  payload?: {
    api_base_url?: string;
    campaign_id?: number | null;
    campaign_key?: string | null;
    rollout_type?: 'ota' | 'binary';
    target_version?: string | null;
    required?: boolean;
    force_at?: string | null;
    update_url?: string | null;
    message?: string | null;
    metadata?: Record<string, any> | null;
  } | null;
}

export interface HeartbeatResponse {
  config_updates?: Partial<DeviceConfig>;
  config_update?: Partial<DeviceConfig>;
  recovery_command?: RecoveryCommand | null;
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

export interface TabletServiceConfig {
  config_id: number | null;
  has_delivery_enabled: boolean;
  pickup_enabled: boolean;
  takeout_time_minutes: number | null;
  busy_takeout_time_minutes: number | null;
  busy_mode_enabled: boolean;
  twilio_call: boolean;
  online_ordering_enabled: boolean;
}
