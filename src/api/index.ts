// Export the REST API client for secure communication with the backend
// DO NOT use supabaseClient.ts - it has been deprecated for security reasons
export { apiClient } from './client';

// Re-export types for convenience
export type { ApiResponse, AuthResponse, Order, OrdersListResponse } from '../types';
