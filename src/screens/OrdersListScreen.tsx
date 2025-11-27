import React, { useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useStore } from '../store/useStore';
import { Order, OrderStatus } from '../types';
import { OrderCard } from '../components/OrderCard';

type RootStackParamList = {
  Orders: undefined;
  OrderDetail: { orderId: string };
  Settings: undefined;
};

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Orders'>;

export const OrdersListScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const {
    orders,
    fetchOrders,
    selectOrder,
    acknowledgeOrder,
    settings,
    offline,
    auth,
  } = useStore();

  // Start polling when screen is focused
  useFocusEffect(
    useCallback(() => {
      // Initial fetch
      fetchOrders();

      // Set up polling
      pollIntervalRef.current = setInterval(() => {
        if (offline.isOnline) {
          fetchOrders();
        }
      }, settings.pollIntervalMs);

      return () => {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
        }
      };
    }, [settings.pollIntervalMs, offline.isOnline])
  );

  const handleOrderPress = useCallback(
    (order: Order) => {
      selectOrder(order);
      navigation.navigate('OrderDetail', { orderId: order.id });
    },
    [navigation, selectOrder]
  );

  const handleAcknowledge = useCallback(
    async (order: Order) => {
      await acknowledgeOrder(order.id);
    },
    [acknowledgeOrder]
  );

  const handleRefresh = useCallback(() => {
    fetchOrders();
  }, [fetchOrders]);

  // Separate orders by status
  const pendingOrders = orders.orders.filter((o) => o.status === 'pending');
  const activeOrders = orders.orders.filter(
    (o) => o.status === 'confirmed' || o.status === 'preparing'
  );
  const readyOrders = orders.orders.filter((o) => o.status === 'ready');

  const renderSectionHeader = (title: string, count: number, color: string) => (
    <View style={[styles.sectionHeader, { backgroundColor: color }]}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>{count}</Text>
      </View>
    </View>
  );

  const renderOrder = ({ item }: { item: Order }) => (
    <OrderCard
      order={item}
      onPress={handleOrderPress}
      onAcknowledge={handleAcknowledge}
    />
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.restaurantName}>{auth.restaurantName}</Text>
          <Text style={styles.deviceName}>{auth.deviceName}</Text>
        </View>
        <View style={styles.headerRight}>
          {!offline.isOnline && (
            <View style={styles.offlineBadge}>
              <Text style={styles.offlineText}>Offline</Text>
            </View>
          )}
          <TouchableOpacity
            style={styles.settingsButton}
            onPress={() => navigation.navigate('Settings')}
          >
            <Text style={styles.settingsIcon}>⚙️</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Loading indicator */}
      {orders.isLoading && orders.orders.length === 0 && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#4CAF50" />
          <Text style={styles.loadingText}>Loading orders...</Text>
        </View>
      )}

      {/* Error message */}
      {orders.error && !orders.isLoading && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{orders.error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={handleRefresh}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Orders Grid - Tablet Layout */}
      <View style={styles.gridContainer}>
        {/* Pending Orders - Most Important */}
        <View style={styles.column}>
          {renderSectionHeader('New Orders', pendingOrders.length, '#FF5722')}
          <FlatList
            data={pendingOrders}
            renderItem={renderOrder}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl
                refreshing={orders.isLoading}
                onRefresh={handleRefresh}
                colors={['#4CAF50']}
              />
            }
            ListEmptyComponent={
              <View style={styles.emptySection}>
                <Text style={styles.emptyIcon}>✓</Text>
                <Text style={styles.emptyText}>No new orders</Text>
              </View>
            }
          />
        </View>

        {/* Active Orders */}
        <View style={styles.column}>
          {renderSectionHeader('In Progress', activeOrders.length, '#2196F3')}
          <FlatList
            data={activeOrders}
            renderItem={renderOrder}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <View style={styles.emptySection}>
                <Text style={styles.emptyText}>No active orders</Text>
              </View>
            }
          />
        </View>

        {/* Ready Orders */}
        <View style={styles.column}>
          {renderSectionHeader('Ready', readyOrders.length, '#4CAF50')}
          <FlatList
            data={readyOrders}
            renderItem={renderOrder}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <View style={styles.emptySection}>
                <Text style={styles.emptyText}>No orders ready</Text>
              </View>
            }
          />
        </View>
      </View>

      {/* Queue indicator */}
      {offline.queuedActions.length > 0 && (
        <View style={styles.queueIndicator}>
          <Text style={styles.queueText}>
            {offline.queuedActions.length} actions queued (will sync when online)
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f0f0',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
  },
  restaurantName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  deviceName: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  offlineBadge: {
    backgroundColor: '#FF5722',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 12,
  },
  offlineText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  settingsButton: {
    padding: 8,
  },
  settingsIcon: {
    fontSize: 28,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
  errorContainer: {
    margin: 20,
    padding: 20,
    backgroundColor: '#ffebee',
    borderRadius: 12,
    alignItems: 'center',
  },
  errorText: {
    color: '#c62828',
    fontSize: 16,
    marginBottom: 12,
  },
  retryButton: {
    backgroundColor: '#f44336',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryText: {
    color: '#fff',
    fontWeight: '600',
  },
  gridContainer: {
    flex: 1,
    flexDirection: 'row',
    padding: 8,
  },
  column: {
    flex: 1,
    marginHorizontal: 8,
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  badge: {
    backgroundColor: 'rgba(255,255,255,0.3)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badgeText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  listContent: {
    padding: 12,
  },
  emptySection: {
    padding: 40,
    alignItems: 'center',
  },
  emptyIcon: {
    fontSize: 48,
    color: '#4CAF50',
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 16,
    color: '#999',
  },
  queueIndicator: {
    backgroundColor: '#FF9800',
    padding: 12,
    alignItems: 'center',
  },
  queueText: {
    color: '#fff',
    fontWeight: '600',
  },
});
