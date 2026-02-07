import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import * as Sentry from '@sentry/react-native';
import * as Updates from 'expo-updates';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error boundary component that catches React component errors.
 * Reports errors to Sentry and provides a reload option.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    // Update state so next render shows fallback UI
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error);
    console.error('[ErrorBoundary] Component stack:', errorInfo.componentStack);
    
    // Report to Sentry with component stack
    if (!__DEV__) {
      try {
        Sentry.withScope((scope) => {
          scope.setExtra('componentStack', errorInfo.componentStack);
          scope.setTag('error_boundary', 'true');
          Sentry.captureException(error);
        });
      } catch (e) {
        console.error('[ErrorBoundary] Failed to report to Sentry:', e);
      }
    }
  }

  handleReload = async () => {
    try {
      // In production, try to reload with latest update
      if (!__DEV__) {
        console.log('[ErrorBoundary] Attempting to reload app...');
        await Updates.reloadAsync();
      } else {
        // In dev, just reset the error state
        this.setState({ hasError: false, error: null });
      }
    } catch (e) {
      console.error('[ErrorBoundary] Reload failed:', e);
      // Fallback: reset state to try rendering again
      this.setState({ hasError: false, error: null });
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <View style={styles.content}>
            <Text style={styles.icon}>⚠️</Text>
            <Text style={styles.title}>Something went wrong</Text>
            <Text style={styles.message}>
              The app encountered an unexpected error.{'\n'}
              This has been reported automatically.
            </Text>
            {__DEV__ && this.state.error && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>
                  {this.state.error.message}
                </Text>
              </View>
            )}
            <TouchableOpacity style={styles.button} onPress={this.handleReload}>
              <Text style={styles.buttonText}>Reload App</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    padding: 40,
  },
  content: {
    alignItems: 'center',
    maxWidth: 400,
  },
  icon: {
    fontSize: 64,
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 16,
    textAlign: 'center',
  },
  message: {
    fontSize: 16,
    color: '#a0a0a0',
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 24,
  },
  errorBox: {
    backgroundColor: '#2d1f1f',
    borderRadius: 8,
    padding: 16,
    marginBottom: 32,
    width: '100%',
  },
  errorText: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: '#ff6b6b',
  },
  button: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 40,
    paddingVertical: 16,
    borderRadius: 12,
    minWidth: 200,
    alignItems: 'center',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600',
  },
});
