import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  useWindowDimensions,
  Vibration,
  TouchableOpacity,
} from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { Order } from '../../types';
import { useTheme } from '../../theme';
import { ExpandableOrderCard } from './ExpandableOrderCard';

type ColumnType = 'new' | 'active' | 'ready' | 'complete';

interface KanbanBoard4ColProps {
  newOrders: Order[];       // pending
  activeOrders: Order[];    // confirmed, preparing
  readyOrders: Order[];     // ready
  completeOrders: Order[];  // completed
  selectedOrderId: string | null;
  onStatusChange: (orderId: string, newStatus: string) => void;
  onOrderSelect: (orderId: string | null) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
}

const COLUMN_CONFIG: { key: ColumnType; title: string; color: string; nextStatus: string; prevStatus: string; dragHint: string }[] = [
  { key: 'new', title: 'New', color: '#f59e0b', nextStatus: 'confirmed', prevStatus: '', dragHint: 'Drag right →' },
  { key: 'active', title: 'Active', color: '#3b82f6', nextStatus: 'ready', prevStatus: 'pending', dragHint: '← → Drag' },
  { key: 'ready', title: 'Ready', color: '#22c55e', nextStatus: 'completed', prevStatus: 'preparing', dragHint: '← → Drag' },
  { key: 'complete', title: 'Complete', color: '#DC2626', nextStatus: '', prevStatus: 'ready', dragHint: '← Drag left' },
];

export const KanbanBoard4Col: React.FC<KanbanBoard4ColProps> = ({
  newOrders,
  activeOrders,
  readyOrders,
  completeOrders,
  selectedOrderId,
  onStatusChange,
  onOrderSelect,
  onRefresh,
  refreshing = false,
}) => {
  const { themeMode } = useTheme();
  const { width } = useWindowDimensions();
  const columnWidth = width / 4;

  // Track which column has an active drag (for zIndex only)
  const [draggingColumn, setDraggingColumn] = useState<ColumnType | null>(null);

  // ScrollView refs for instant native-level scroll lock via setNativeProps.
  // State-based scrollEnabled is too slow — Android's native ScrollView grabs
  // touches before a React re-render can flip the prop.
  const scrollRefs = useRef<Record<string, ScrollView | null>>({});

  const handleDragStart = useCallback((fromColumn: ColumnType) => {
    setDraggingColumn(fromColumn);
  }, []);

  const handleDragRelease = useCallback(() => {
    setDraggingColumn(null);
  }, []);

  const colors = {
    bg: themeMode === 'dark' ? '#0f172a' : '#f8fafc',
    columnBg: themeMode === 'dark' ? '#1e293b' : '#ffffff',
    headerBg: themeMode === 'dark' ? '#1e293b' : '#f1f5f9',
    border: themeMode === 'dark' ? '#334155' : '#e2e8f0',
    text: themeMode === 'dark' ? '#f1f5f9' : '#1e293b',
    textMuted: themeMode === 'dark' ? '#94a3b8' : '#64748b',
    countBadge: themeMode === 'dark' ? '#334155' : '#e2e8f0',
  };

  const getOrdersForColumn = (column: ColumnType): Order[] => {
    switch (column) {
      case 'new': return newOrders;
      case 'active': return activeOrders;
      case 'ready': return readyOrders;
      case 'complete': return completeOrders;
    }
  };

  const handleDragEnd = useCallback(
    (orderId: string, translationX: number, fromColumn: ColumnType) => {
      const columnIndex = COLUMN_CONFIG.findIndex(c => c.key === fromColumn);
      
      // Calculate how many columns the drag covers based on distance
      const columnsCrossed = Math.max(1, Math.round(Math.abs(translationX) / columnWidth));
      
      // Positive X = dragged right (move forward in workflow)
      // Negative X = dragged left (move backward in workflow)
      if (translationX > 0) {
        // Move forward - skip to the farthest column reached
        const targetIndex = Math.min(columnIndex + columnsCrossed, COLUMN_CONFIG.length - 1);
        if (targetIndex > columnIndex) {
          const targetConfig = COLUMN_CONFIG[targetIndex];
          let targetStatus = '';
          switch (targetConfig.key) {
            case 'active': targetStatus = 'confirmed'; break;
            case 'ready': targetStatus = 'ready'; break;
            case 'complete': targetStatus = 'completed'; break;
          }
          if (targetStatus) {
            Vibration.vibrate(100);
            onStatusChange(orderId, targetStatus);
          }
        }
      } else if (translationX < 0) {
        // Move backward - skip to the farthest column reached
        const targetIndex = Math.max(columnIndex - columnsCrossed, 0);
        if (targetIndex < columnIndex) {
          const targetConfig = COLUMN_CONFIG[targetIndex];
          let targetStatus = '';
          switch (targetConfig.key) {
            case 'new': targetStatus = 'pending'; break;
            case 'active': targetStatus = 'preparing'; break;
            case 'ready': targetStatus = 'ready'; break;
          }
          if (targetStatus) {
            Vibration.vibrate(100);
            onStatusChange(orderId, targetStatus);
          }
        }
      }
    },
    [onStatusChange, columnWidth]
  );

  const handleOrderTap = useCallback(
    (orderId: string) => {
      if (selectedOrderId === orderId) {
        onOrderSelect(null);
      } else {
        onOrderSelect(orderId);
      }
    },
    [selectedOrderId, onOrderSelect]
  );

  const handleStatusButtonPress = useCallback(
    (orderId: string, column: ColumnType) => {
      // Status button moves to next stage
      const columnIndex = COLUMN_CONFIG.findIndex(c => c.key === column);
      if (columnIndex < COLUMN_CONFIG.length - 1) {
        const nextConfig = COLUMN_CONFIG[columnIndex + 1];
        let targetStatus = '';
        switch (nextConfig.key) {
          case 'active': targetStatus = 'confirmed'; break;
          case 'ready': targetStatus = 'ready'; break;
          case 'complete': targetStatus = 'completed'; break;
        }
        if (targetStatus) {
          onStatusChange(orderId, targetStatus);
          onOrderSelect(null);
        }
      }
    },
    [onStatusChange, onOrderSelect]
  );

  const renderColumn = (config: typeof COLUMN_CONFIG[0], index: number) => {
    const orders = getOrdersForColumn(config.key);
    const isLastColumn = index === COLUMN_CONFIG.length - 1;

    return (
      <View 
        key={config.key} 
        style={[
          styles.column, 
          !isLastColumn && { borderRightColor: colors.border, borderRightWidth: 1 }
        ]}
      >
        <View style={[styles.columnHeader, { backgroundColor: colors.headerBg }]}>
          <View style={styles.headerLeft}>
            <View style={[styles.statusDot, { backgroundColor: config.color }]} />
            <Text style={[styles.columnTitle, { color: colors.text }]}>{config.title}</Text>
          </View>
          <View style={styles.headerRight}>
            {index === 0 && onRefresh && (
              <TouchableOpacity 
                style={[styles.refreshBtn, { backgroundColor: colors.countBadge }]} 
                onPress={onRefresh}
              >
                <Text style={[styles.refreshBtnText, { color: colors.textMuted }]}>↻</Text>
              </TouchableOpacity>
            )}
            <View style={[styles.countBadge, { backgroundColor: colors.countBadge }]}>
              <Text style={[styles.countText, { color: colors.textMuted }]}>
                {orders.length}
              </Text>
            </View>
          </View>
        </View>
        <ScrollView
          ref={(ref) => { scrollRefs.current[config.key] = ref; }}
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
        >
          {orders.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>
                Empty
              </Text>
            </View>
          ) : (
            orders.map((order) => (
              <ExpandableOrderCard
                key={order.id}
                order={order}
                column={config.key === 'complete' ? 'complete' : 'new'}
                isExpanded={selectedOrderId === order.id}
                containerWidth={columnWidth}
                onDragEnd={(orderId, translationX) =>
                  handleDragEnd(orderId, translationX, config.key)
                }
                onDragStart={() => handleDragStart(config.key)}
                onDragRelease={handleDragRelease}
                onTap={handleOrderTap}
                onStatusChange={() => handleStatusButtonPress(order.id, config.key)}
                onScrollLock={() => {
                  scrollRefs.current[config.key]?.setNativeProps({ scrollEnabled: false });
                }}
                onScrollUnlock={() => {
                  scrollRefs.current[config.key]?.setNativeProps({ scrollEnabled: true });
                }}
                simultaneousHandlers={scrollRefs.current[config.key] || undefined}
              />
            ))
          )}
        </ScrollView>
        <View style={[styles.dragHint, { borderTopColor: colors.border }]}>
          <Text style={[styles.dragHintText, { color: colors.textMuted }]}>
            {config.dragHint}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      {COLUMN_CONFIG.map((config, index) => renderColumn(config, index))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
  },
  column: {
    flex: 1,
    overflow: 'visible',
  },
  columnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  refreshBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  refreshBtnText: {
    fontSize: 16,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  columnTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  countBadge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  countText: {
    fontSize: 12,
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
    overflow: 'visible',
  },
  scrollContent: {
    paddingVertical: 4,
    paddingBottom: 16,
    overflow: 'visible',
  },
  emptyState: {
    padding: 20,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 13,
    fontStyle: 'italic',
  },
  dragHint: {
    paddingVertical: 8,
    alignItems: 'center',
    borderTopWidth: 1,
  },
  dragHintText: {
    fontSize: 11,
    fontStyle: 'italic',
  },
});

export default KanbanBoard4Col;
