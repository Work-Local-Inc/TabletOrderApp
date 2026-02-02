import React, { useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  Vibration,
  TouchableOpacity,
} from 'react-native';
import { Order } from '../../types';
import { useTheme } from '../../theme';
import { ExpandableOrderCard } from './ExpandableOrderCard';

interface KanbanBoardProps {
  newOrders: Order[];
  completeOrders: Order[];
  selectedOrderId: string | null;
  onMoveToComplete: (orderId: string) => void;
  onMoveToNew: (orderId: string) => void;
  onOrderSelect: (orderId: string | null) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
}

export const KanbanBoard: React.FC<KanbanBoardProps> = ({
  newOrders,
  completeOrders,
  selectedOrderId,
  onMoveToComplete,
  onMoveToNew,
  onOrderSelect,
  onRefresh,
  refreshing = false,
}) => {
  const { themeMode } = useTheme();
  const { width } = useWindowDimensions();
  const columnWidth = width / 2;

  const colors = {
    bg: themeMode === 'dark' ? '#0f172a' : '#f8fafc',
    columnBg: themeMode === 'dark' ? '#1e293b' : '#ffffff',
    headerBg: themeMode === 'dark' ? '#1e293b' : '#f1f5f9',
    border: themeMode === 'dark' ? '#334155' : '#e2e8f0',
    text: themeMode === 'dark' ? '#f1f5f9' : '#1e293b',
    textMuted: themeMode === 'dark' ? '#94a3b8' : '#64748b',
    newDot: '#22c55e',
    completeDot: '#DC2626',
    countBadge: themeMode === 'dark' ? '#334155' : '#e2e8f0',
  };

  const handleDragEnd = useCallback(
    (orderId: string, translationX: number, fromColumn: 'new' | 'complete') => {
      // Positive X = dragged right, Negative X = dragged left
      if (fromColumn === 'new' && translationX > 0) {
        Vibration.vibrate(100);
        onMoveToComplete(orderId);
      } else if (fromColumn === 'complete' && translationX < 0) {
        Vibration.vibrate(100);
        onMoveToNew(orderId);
      }
    },
    [onMoveToComplete, onMoveToNew]
  );

  const handleOrderTap = useCallback(
    (orderId: string) => {
      // Toggle selection - if already selected, deselect; otherwise select
      if (selectedOrderId === orderId) {
        onOrderSelect(null);
      } else {
        onOrderSelect(orderId);
      }
    },
    [selectedOrderId, onOrderSelect]
  );

  const handleStatusChange = useCallback(
    (orderId: string, column: 'new' | 'complete') => {
      if (column === 'new') {
        onMoveToComplete(orderId);
      } else {
        onMoveToNew(orderId);
      }
      // Collapse the card after action
      onOrderSelect(null);
    },
    [onMoveToComplete, onMoveToNew, onOrderSelect]
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      {/* New Orders Column */}
      <View style={[styles.column, { borderRightColor: colors.border }]}>
        <View style={[styles.columnHeader, { backgroundColor: colors.headerBg }]}>
          <View style={styles.headerLeft}>
            <View style={[styles.statusDot, { backgroundColor: colors.newDot }]} />
            <Text style={[styles.columnTitle, { color: colors.text }]}>New</Text>
          </View>
          <View style={styles.headerRight}>
            {onRefresh && (
              <TouchableOpacity 
                style={[styles.refreshBtn, { backgroundColor: colors.countBadge }]} 
                onPress={onRefresh}
              >
                <Text style={[styles.refreshBtnText, { color: colors.textMuted }]}>Refresh</Text>
              </TouchableOpacity>
            )}
            <View style={[styles.countBadge, { backgroundColor: colors.countBadge }]}>
              <Text style={[styles.countText, { color: colors.textMuted }]}>
                {newOrders.length}
              </Text>
            </View>
          </View>
        </View>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
        >
          {newOrders.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>
                No new orders
              </Text>
            </View>
          ) : (
            newOrders.map((order) => (
              <ExpandableOrderCard
                key={order.id}
                order={order}
                column="new"
                isExpanded={selectedOrderId === order.id}
                containerWidth={columnWidth}
                onDragEnd={(orderId, translationX) =>
                  handleDragEnd(orderId, translationX, 'new')
                }
                onTap={handleOrderTap}
                onStatusChange={() => handleStatusChange(order.id, 'new')}
              />
            ))
          )}
        </ScrollView>
        {/* Drag hint */}
        <View style={[styles.dragHint, { borderTopColor: colors.border }]}>
          <Text style={[styles.dragHintText, { color: colors.textMuted }]}>
            Drag right to complete
          </Text>
        </View>
      </View>

      {/* Complete Orders Column */}
      <View style={styles.column}>
        <View style={[styles.columnHeader, { backgroundColor: colors.headerBg }]}>
          <View style={styles.headerLeft}>
            <View style={[styles.statusDot, { backgroundColor: colors.completeDot }]} />
            <Text style={[styles.columnTitle, { color: colors.text }]}>Complete</Text>
          </View>
          <View style={[styles.countBadge, { backgroundColor: colors.countBadge }]}>
            <Text style={[styles.countText, { color: colors.textMuted }]}>
              {completeOrders.length}
            </Text>
          </View>
        </View>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
        >
          {completeOrders.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>
                No completed orders
              </Text>
            </View>
          ) : (
            completeOrders.map((order) => (
              <ExpandableOrderCard
                key={order.id}
                order={order}
                column="complete"
                isExpanded={selectedOrderId === order.id}
                containerWidth={columnWidth}
                onDragEnd={(orderId, translationX) =>
                  handleDragEnd(orderId, translationX, 'complete')
                }
                onTap={handleOrderTap}
                onStatusChange={() => handleStatusChange(order.id, 'complete')}
              />
            ))
          )}
        </ScrollView>
        {/* Drag hint */}
        <View style={[styles.dragHint, { borderTopColor: colors.border }]}>
          <Text style={[styles.dragHintText, { color: colors.textMuted }]}>
            Drag left to reopen
          </Text>
        </View>
      </View>
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
    borderRightWidth: 1,
    overflow: 'visible',
  },
  columnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  refreshBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  refreshBtnText: {
    fontSize: 13,
    fontWeight: '500',
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  columnTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  countBadge: {
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  countText: {
    fontSize: 14,
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
    overflow: 'visible',
  },
  scrollContent: {
    paddingVertical: 8,
    paddingBottom: 20,
  },
  emptyState: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 15,
    fontStyle: 'italic',
  },
  dragHint: {
    paddingVertical: 10,
    alignItems: 'center',
    borderTopWidth: 1,
  },
  dragHintText: {
    fontSize: 12,
    fontStyle: 'italic',
  },
});

export default KanbanBoard;
