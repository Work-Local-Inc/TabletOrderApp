import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Supabase configuration
const SUPABASE_URL = 'https://nthpbtdjhhnwfxqsxbvy.supabase.co';
// Using service role key for tablet app (internal use only, not public-facing)
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50aHBidGRqaGhud2Z4cXN4YnZ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NTI3MzQ4NCwiZXhwIjoyMDcwODQ5NDg0fQ.THhg9RhwfeN2B9V1SZdef0iJIeBntwd2w67p_J0ch1g';

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
