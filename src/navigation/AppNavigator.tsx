import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useStore } from '../store/useStore';

// Screens
import { LoginScreen } from '../screens/LoginScreen';
import { OrdersListScreen } from '../screens/OrdersListScreen';
import { OrderDetailScreen } from '../screens/OrderDetailScreen';
import { SettingsScreen } from '../screens/SettingsScreen';

export type RootStackParamList = {
  Login: undefined;
  Orders: undefined;
  OrderDetail: { orderId: string };
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export const AppNavigator: React.FC = () => {
  const [isReady, setIsReady] = useState(false);
  const { auth, checkAuth } = useStore();

  useEffect(() => {
    const init = async () => {
      await checkAuth();
      setIsReady(true);
    };
    init();
  }, [checkAuth]);

  if (!isReady || auth.isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4CAF50" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
        }}
      >
        {!auth.isAuthenticated ? (
          // Auth Stack
          <Stack.Screen
            name="Login"
            component={LoginScreen}
            options={{ orientation: 'default' }}
          />
        ) : (
          // Main App Stack
          <>
            <Stack.Screen
              name="Orders"
              component={OrdersListScreen}
              options={{ orientation: 'landscape' }}
            />
            <Stack.Screen
              name="OrderDetail"
              component={OrderDetailScreen}
              options={{
                animation: 'slide_from_bottom',
                orientation: 'landscape',
              }}
            />
            <Stack.Screen
              name="Settings"
              component={SettingsScreen}
              options={{
                animation: 'slide_from_right',
                orientation: 'default',
              }}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
};

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
});
