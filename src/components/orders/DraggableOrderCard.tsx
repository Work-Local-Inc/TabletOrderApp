import React, { useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Vibration,
  Animated,
  PanResponder,
} from 'react-native';
import { Order } from '../../types';
import { useTheme } from '../../theme';

interface DraggableOrderCardProps {
  order: Order;
  column: 'new' | 'complete';
  onDragEnd: (orderId: string, translationX: number) => void;
  onTap: (orderId: string) => void;
  containerWidth: number;
}

const formatTime = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
};

const getOrderTypeLabel = (type: string): string => {
  switch (type?.toLowerCase()) {
    case 'delivery': return 'Delivery';
    case 'dine_in': return 'Dine-in';
    case 'pickup':
    case 'takeout':
    default: return 'Pickup';
  }
};

// Get short, memorable order number (last 4 chars)
const getShortOrderNumber = (orderNumber: string): string => {
  if (!orderNumber) return '----';
  return orderNumber.slice(-4).toUpperCase();
};

export const DraggableOrderCard: React.FC<DraggableOrderCardProps> = ({
  order,
  column,
  onDragEnd,
  onTap,
  containerWidth,
}) => {
  const { theme, themeMode } = useTheme();
  const pan = useRef(new Animated.ValueXY()).current;
  const scale = useRef(new Animated.Value(1)).current;
  const zIndex = useRef(new Animated.Value(1)).current;
  const isDragging = useRef(false);
  const startTime = useRef(0);

  const customerName = order.customer?.name || 'Walk-in';
  const orderType = order.order_type || 'pickup';

  // Match existing app colors exactly
  const colors = {
    bg: themeMode === 'dark' ? '#1e293b' : '#ffffff',
    border: themeMode === 'dark' ? '#334155' : '#e2e8f0',
    text: theme.text,
    textSecondary: theme.textSecondary,
    textMuted: theme.textMuted,
    // Status accent (left border)
    newAccent: '#FF5722',    // Brand red for new orders
    completeAccent: '#22c55e', // Green for complete
  };

  // Always use white/dark background - no aging colors
  const cardBg = colors.bg;

  const accentColor = column === 'new' ? colors.newAccent : colors.completeAccent;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return Math.abs(gestureState.dx) > 10 || Math.abs(gestureState.dy) > 10;
      },
      onPanResponderGrant: () => {
        startTime.current = Date.now();
        isDragging.current = false;
        zIndex.setValue(999);
        Animated.spring(scale, { toValue: 1.02, useNativeDriver: false }).start();
      },
      onPanResponderMove: (_, gestureState) => {
        if (Math.abs(gestureState.dx) > 15 || Math.abs(gestureState.dy) > 15) {
          if (!isDragging.current) {
            isDragging.current = true;
            Vibration.vibrate(50);
          }
          pan.setValue({ x: gestureState.dx, y: gestureState.dy });
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        const dragDuration = Date.now() - startTime.current;
        
        Animated.spring(scale, { toValue: 1, useNativeDriver: false }).start();
        zIndex.setValue(1);

        // Tap detection
        if (dragDuration < 200 && Math.abs(gestureState.dx) < 15 && Math.abs(gestureState.dy) < 15) {
          pan.setValue({ x: 0, y: 0 });
          onTap(order.id);
          return;
        }

        // Drag threshold
        const threshold = containerWidth * 0.25;
        if (Math.abs(gestureState.dx) > threshold) {
          Vibration.vibrate(100);
          onDragEnd(order.id, gestureState.dx);
        }

        Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
      },
      onPanResponderTerminate: () => {
        zIndex.setValue(1);
        Animated.parallel([
          Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: false }),
          Animated.spring(scale, { toValue: 1, useNativeDriver: false }),
        ]).start();
      },
    })
  ).current;

  return (
    <Animated.View
      style={[
        styles.card,
        {
          backgroundColor: cardBg,
          borderColor: colors.border,
          borderLeftColor: accentColor,
          zIndex: zIndex,
          elevation: zIndex,
          transform: [
            { translateX: pan.x },
            { translateY: pan.y },
            { scale: scale },
          ],
        },
      ]}
      {...panResponder.panHandlers}
    >
      {/* Content */}
      <View style={styles.content}>
        {/* Top row: Customer name + Time */}
        <View style={styles.row}>
          <Text style={[styles.customerName, { color: colors.text }]} numberOfLines={1}>
            {customerName}
          </Text>
          <Text style={[styles.time, { color: colors.textMuted }]}>
            {formatTime(order.created_at)}
          </Text>
        </View>

        {/* Bottom row: Type + Order number */}
        <View style={styles.row}>
          <Text style={[styles.type, { color: colors.textSecondary }]}>
            {getOrderTypeLabel(orderType)}
          </Text>
          <Text style={[styles.orderNumber, { color: colors.textMuted }]}>
            #{getShortOrderNumber(order.order_number)}
          </Text>
        </View>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 8,
    marginVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderLeftWidth: 4,
  },
  content: {
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  customerName: {
    fontSize: 15,
    fontWeight: '500',
    flex: 1,
    marginRight: 8,
  },
  time: {
    fontSize: 13,
  },
  type: {
    fontSize: 14,
    marginTop: 4,
  },
  orderNumber: {
    fontSize: 12,
    marginTop: 4,
  },
});

export default DraggableOrderCard;
