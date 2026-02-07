import * as Sentry from '@sentry/react-native';

// Sentry DSN - Replace with your actual DSN from sentry.io
// To get a DSN: Create a project at sentry.io > Settings > Client Keys (DSN)
const SENTRY_DSN = 'YOUR_SENTRY_DSN_HERE';

/**
 * Initialize Sentry error tracking.
 * Call this early in app initialization, before any React code.
 */
export const initSentry = () => {
  // Skip initialization in development mode
  if (__DEV__) {
    console.log('[Sentry] Skipping initialization in dev mode');
    return;
  }

  // Skip if DSN not configured
  if (SENTRY_DSN === 'YOUR_SENTRY_DSN_HERE') {
    console.warn('[Sentry] DSN not configured - error tracking disabled');
    return;
  }

  try {
    Sentry.init({
      dsn: SENTRY_DSN,
      
      // Performance monitoring - sample 20% of transactions
      tracesSampleRate: 0.2,
      
      // Environment based on build
      environment: 'production',
      
      // App version for tracking releases
      release: 'ca.menu.orders@1.4.0',
      
      // Don't send personally identifiable information
      sendDefaultPii: false,
      
      // Attach stack traces to all events
      attachStacktrace: true,
      
      // Filter out non-actionable errors
      beforeSend(event) {
        // Filter network errors that are expected during offline mode
        const errorMessage = event.exception?.values?.[0]?.value;
        if (errorMessage) {
          // Skip common network errors that happen during normal offline operation
          if (
            errorMessage.includes('Network request failed') ||
            errorMessage.includes('Network Error') ||
            errorMessage.includes('timeout')
          ) {
            console.log('[Sentry] Filtering network error:', errorMessage);
            return null;
          }
        }
        return event;
      },
    });
    
    console.log('[Sentry] Initialized successfully');
  } catch (error) {
    console.error('[Sentry] Initialization failed:', error);
    // App continues without Sentry - don't crash on init failure
  }
};

/**
 * Set user/restaurant context for error tracking.
 * Call this after successful authentication.
 */
export const setSentryContext = (
  restaurantId: string,
  restaurantName: string,
  deviceName: string
) => {
  if (__DEV__) return;
  
  try {
    // Set user identity (just ID, no PII)
    Sentry.setUser({
      id: restaurantId,
    });
    
    // Set tags for filtering in Sentry dashboard
    Sentry.setTag('restaurant_name', restaurantName);
    Sentry.setTag('device_name', deviceName);
    
    console.log('[Sentry] Context set for restaurant:', restaurantId);
  } catch (error) {
    console.error('[Sentry] Failed to set context:', error);
  }
};

/**
 * Clear user context on logout.
 */
export const clearSentryContext = () => {
  if (__DEV__) return;
  
  try {
    Sentry.setUser(null);
    console.log('[Sentry] Context cleared');
  } catch (error) {
    console.error('[Sentry] Failed to clear context:', error);
  }
};

/**
 * Add a breadcrumb to track user actions.
 * Breadcrumbs appear in the timeline of error reports.
 */
export const addBreadcrumb = (
  message: string,
  category: string,
  data?: Record<string, unknown>
) => {
  if (__DEV__) return;
  
  try {
    Sentry.addBreadcrumb({
      message,
      category,
      data,
      level: 'info',
    });
  } catch (error) {
    // Silently fail - don't break app for breadcrumb issues
  }
};

/**
 * Capture an exception with optional context.
 * Use this for caught errors that should be reported.
 */
export const captureException = (
  error: Error | unknown,
  context?: Record<string, unknown>
) => {
  if (__DEV__) {
    console.error('[Sentry] Would capture exception:', error);
    return;
  }
  
  try {
    if (context) {
      Sentry.withScope((scope) => {
        scope.setExtras(context);
        Sentry.captureException(error);
      });
    } else {
      Sentry.captureException(error);
    }
  } catch (e) {
    console.error('[Sentry] Failed to capture exception:', e);
  }
};

/**
 * Capture a message for non-error events.
 * Use for important events that aren't errors.
 */
export const captureMessage = (
  message: string,
  level: 'info' | 'warning' | 'error' = 'info'
) => {
  if (__DEV__) {
    console.log('[Sentry] Would capture message:', message);
    return;
  }
  
  try {
    Sentry.captureMessage(message, level);
  } catch (error) {
    console.error('[Sentry] Failed to capture message:', error);
  }
};

// Re-export Sentry for advanced usage
export { Sentry };
