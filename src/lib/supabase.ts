/**
 * @deprecated DO NOT USE THIS FILE!
 * 
 * ⚠️⚠️⚠️ SECURITY WARNING ⚠️⚠️⚠️
 * 
 * This file contained a Supabase service-role key which has FULL DATABASE ACCESS.
 * Exposing this key in a client app is a CRITICAL SECURITY VULNERABILITY.
 * 
 * The key has been removed. Use the REST API client instead:
 * import { apiClient } from '../api/client';
 * 
 * The service-role key should be REVOKED in the Supabase dashboard
 * once this fix is confirmed working.
 */

import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ❌ REMOVED - Service role key was exposed here
// This key should be REVOKED in Supabase dashboard
const SUPABASE_URL = 'https://nthpbtdjhhnwfxqsxbvy.supabase.co';
const SUPABASE_KEY = 'KEY_REMOVED_FOR_SECURITY';

console.error('⚠️ DEPRECATED: Do not use lib/supabase.ts - use api/client.ts instead!');

// Schema name for all queries
export const SCHEMA = 'menuca_v3';

// Create Supabase client with React Native storage
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false, // Important for React Native
  },
  db: {
    schema: SCHEMA,
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});

// Helper to get typed schema queries
export const db = {
  from: <T extends string>(table: T) => supabase.from(table),
};

export default supabase;
