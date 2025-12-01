import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Order } from '../../types';
import { StatusBadge, OrderStatusType } from './StatusBadge';
import {
  printKitchenTicket,
  printCustomerReceipt,
  printBoth,
  isPrinterConnected,
} from '../../services/printService';

interface OrderDetailPanelProps {
  order: Order | null;
  onStatusChange?: (orderId: string, status: string) => Promise<void>;
  onPrinted?: (orderId: string) => void;
  printerConnected: boolean;
}

const formatDateTime = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
};

const formatDate = (dateString: string): string => {
  const date = new Date(dateString);
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  
  if (isToday) {
    return `Today at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
  }
  
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
};

const STATUS_OPTIONS = [
  { key: 'active', label: 'Active', color: '#f59e0b' },
  { key: 'ready', label: 'Ready', color: '#22c55e' },
  { key: 'completed', label: 'Picked Up', color: '#6b7280' },
];

export const OrderDetailPanel: React.FC<OrderDetailPanelProps> = ({
  order,
  onStatusChange,
  onPrinted,
  printerConnected,
}) => {
  const [printingType, setPrintingType] = useState<string | null>(null);
  const [changingStatus, setChangingStatus] = useState(false);
  const [showStatusMenu, setShowStatusMenu] = useState(false);

  if (!order) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyIcon}>📋</Text>
        <Text style={styles.emptyTitle}>Select an Order</Text>
        <Text style={styles.emptySubtitle}>
          Tap an order from the list to view details
        </Text>
      </View>
    );
  }

  const handlePrint = async (type: 'kitchen' | 'receipt' | 'both') => {
    if (!printerConnected) {
      Alert.alert('Printer Not Connected', 'Please connect a printer in Settings first.');
      return;
    }

    setPrintingType(type);
    try {
      let success = false;
      switch (type) {
        case 'kitchen':
          success = await printKitchenTicket(order);
          break;
        case 'receipt':
          success = await printCustomerReceipt(order);
          break;
        case 'both':
          success = await printBoth(order);
          break;
      }

      if (success) {
        onPrinted?.(order.id);
        Alert.alert('✓ Printed!', `${type === 'kitchen' ? 'Kitchen ticket' : type === 'receipt' ? 'Receipt' : 'Both'} sent to printer`);
      } else {
        Alert.alert('Print Failed', 'Could not print. Please try again.');
      }
    } catch (error: any) {
      Alert.alert('Print Error', error.message || 'Unknown error');
    } finally {
      setPrintingType(null);
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!onStatusChange) return;
    
    setChangingStatus(true);
    setShowStatusMenu(false);
    try {
      await onStatusChange(order.id, newStatus);
    } catch (error) {
      Alert.alert('Error', 'Failed to update status');
    } finally {
      setChangingStatus(false);
    }
  };

  const customerName = order.customer?.name || 'Walk-in Customer';
  const orderType = order.order_type || order.order_type || 'pickup';
  const itemCount = order.items?.length || 0;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Text style={styles.customerName}>{customerName}</Text>
          <StatusBadge status={order.status as OrderStatusType} size="large" />
        </View>
        
        <Text style={styles.orderNumber}>Order #{order.order_number || order.order_number}</Text>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Order Details Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            {orderType === 'delivery' ? '🚗 Delivery Details' : orderType === 'dine_in' ? '🍽️ Dine-In Details' : '🛍️ Pickup Details'}
          </Text>
          
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Customer</Text>
            <Text style={styles.detailValue}>{customerName}</Text>
          </View>
          
          {order.customer?.phone && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Phone</Text>
              <Text style={styles.detailValue}>{order.customer.phone}</Text>
            </View>
          )}
          
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Created</Text>
            <Text style={styles.detailValue}>{formatDate(order.created_at)}</Text>
          </View>
          
          {order.estimated_ready_time && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Due</Text>
              <Text style={[styles.detailValue, styles.dueTime]}>
                {formatDate(order.estimated_ready_time)}
              </Text>
            </View>
          )}

          {/* Delivery Address */}
          {orderType === 'delivery' && order.delivery_address && (
            <>
              <View style={styles.divider} />
              <Text style={styles.addressLabel}>Deliver To:</Text>
              <Text style={styles.addressText}>
                {order.delivery_address.street}
                {order.delivery_address.unit && `, Unit ${order.delivery_address.unit}`}
              </Text>
              <Text style={styles.addressText}>
                {order.delivery_address.city}, {order.delivery_address.postalCode}
              </Text>
              {order.delivery_address.instructions && (
                <Text style={styles.instructions}>
                  📝 {order.delivery_address.instructions}
                </Text>
              )}
            </>
          )}
        </View>

        {/* Items Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Items ({itemCount})</Text>
          
          {(order.items || []).map((item, index) => (
            <View key={index} style={styles.itemRow}>
              <View style={styles.itemInfo}>
                <Text style={styles.itemName}>
                  {item.name} <Text style={styles.itemQty}>×{item.quantity}</Text>
                </Text>
                {item.modifiers && item.modifiers.length > 0 && (
                  <View style={styles.modifiers}>
                    {item.modifiers.map((mod, mIndex) => (
                      <Text key={mIndex} style={styles.modifierText}>
                        • {mod.name} {mod.price > 0 && `+$${mod.price.toFixed(2)}`}
                      </Text>
                    ))}
                  </View>
                )}
                {item.notes && (
                  <Text style={styles.itemNotes}>"{item.notes}"</Text>
                )}
              </View>
              <Text style={styles.itemPrice}>
                ${((item.price || 0) * (item.quantity || 1)).toFixed(2)}
              </Text>
            </View>
          ))}
          
          {/* Totals */}
          <View style={styles.totalsSection}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Subtotal</Text>
              <Text style={styles.totalValue}>${(order.subtotal || 0).toFixed(2)}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Tax</Text>
              <Text style={styles.totalValue}>${(order.tax || 0).toFixed(2)}</Text>
            </View>
            {order.delivery_fee && order.delivery_fee > 0 && (
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Delivery</Text>
                <Text style={styles.totalValue}>${order.delivery_fee.toFixed(2)}</Text>
              </View>
            )}
            {order.tip && order.tip > 0 && (
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Tip</Text>
                <Text style={styles.totalValue}>${order.tip.toFixed(2)}</Text>
              </View>
            )}
            <View style={[styles.totalRow, styles.grandTotalRow]}>
              <Text style={styles.grandTotalLabel}>Total</Text>
              <Text style={styles.grandTotalValue}>${(order.total || 0).toFixed(2)}</Text>
            </View>
          </View>
        </View>

        {/* Order Notes */}
        {order.notes && (
          <View style={[styles.card, styles.notesCard]}>
            <Text style={styles.notesTitle}>📝 Order Notes</Text>
            <Text style={styles.notesText}>{order.notes}</Text>
          </View>
        )}

        {/* Spacer for bottom buttons */}
        <View style={{ height: 120 }} />
      </ScrollView>

      {/* Bottom Action Bar */}
      <View style={styles.actionBar}>
        {/* Print Buttons */}
        <View style={styles.printButtons}>
          <TouchableOpacity
            style={[styles.printButton, styles.kitchenButton]}
            onPress={() => handlePrint('kitchen')}
            disabled={!!printingType}
          >
            {printingType === 'kitchen' ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Text style={styles.printIcon}>🍳</Text>
                <Text style={styles.printLabel}>Kitchen</Text>
              </>
            )}
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.printButton, styles.receiptButton]}
            onPress={() => handlePrint('receipt')}
            disabled={!!printingType}
          >
            {printingType === 'receipt' ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Text style={styles.printIcon}>🧾</Text>
                <Text style={styles.printLabel}>Receipt</Text>
              </>
            )}
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.printButton, styles.bothButton]}
            onPress={() => handlePrint('both')}
            disabled={!!printingType}
          >
            {printingType === 'both' ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Text style={styles.printIcon}>📋</Text>
                <Text style={styles.printLabel}>Both</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Status Change Button */}
        <TouchableOpacity
          style={styles.statusButton}
          onPress={() => setShowStatusMenu(!showStatusMenu)}
          disabled={changingStatus}
        >
          {changingStatus ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.statusButtonText}>Mark as...</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Status Menu Dropdown */}
      {showStatusMenu && (
        <View style={styles.statusMenu}>
          {STATUS_OPTIONS.map((option) => (
            <TouchableOpacity
              key={option.key}
              style={styles.statusOption}
              onPress={() => handleStatusChange(option.key)}
            >
              <View style={[styles.statusDot, { backgroundColor: option.color }]} />
              <Text style={styles.statusOptionText}>{option.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#16213e',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#16213e',
    padding: 40,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 16,
    color: '#64748b',
    textAlign: 'center',
  },
  header: {
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  customerName: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    flex: 1,
    marginRight: 16,
  },
  orderNumber: {
    fontSize: 14,
    color: '#64748b',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#94a3b8',
    marginBottom: 16,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  detailLabel: {
    fontSize: 15,
    color: '#64748b',
  },
  detailValue: {
    fontSize: 15,
    color: '#fff',
    fontWeight: '500',
  },
  dueTime: {
    color: '#f59e0b',
  },
  divider: {
    height: 1,
    backgroundColor: '#334155',
    marginVertical: 16,
  },
  addressLabel: {
    fontSize: 14,
    color: '#64748b',
    marginBottom: 8,
  },
  addressText: {
    fontSize: 15,
    color: '#fff',
    marginBottom: 2,
  },
  instructions: {
    fontSize: 14,
    color: '#fbbf24',
    marginTop: 8,
    fontStyle: 'italic',
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  itemInfo: {
    flex: 1,
    marginRight: 12,
  },
  itemName: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '500',
  },
  itemQty: {
    color: '#94a3b8',
    fontWeight: '400',
  },
  modifiers: {
    marginTop: 6,
  },
  modifierText: {
    fontSize: 13,
    color: '#94a3b8',
    marginTop: 2,
  },
  itemNotes: {
    fontSize: 13,
    color: '#fbbf24',
    marginTop: 6,
    fontStyle: 'italic',
  },
  itemPrice: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '500',
  },
  totalsSection: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 2,
    borderTopColor: '#334155',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  totalLabel: {
    fontSize: 14,
    color: '#94a3b8',
  },
  totalValue: {
    fontSize: 14,
    color: '#fff',
  },
  grandTotalRow: {
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  grandTotalLabel: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  grandTotalValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#22c55e',
  },
  notesCard: {
    backgroundColor: '#422006',
    borderWidth: 1,
    borderColor: '#78350f',
  },
  notesTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fbbf24',
    marginBottom: 8,
  },
  notesText: {
    fontSize: 15,
    color: '#fcd34d',
    lineHeight: 22,
  },
  actionBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#0f172a',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#334155',
    flexDirection: 'row',
    alignItems: 'center',
  },
  printButtons: {
    flexDirection: 'row',
    flex: 1,
  },
  printButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginRight: 10,
    minWidth: 100,
  },
  kitchenButton: {
    backgroundColor: '#ea580c',
  },
  receiptButton: {
    backgroundColor: '#0284c7',
  },
  bothButton: {
    backgroundColor: '#7c3aed',
  },
  printIcon: {
    fontSize: 18,
    marginRight: 6,
  },
  printLabel: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  statusButton: {
    backgroundColor: '#3b82f6',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 10,
  },
  statusButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  statusMenu: {
    position: 'absolute',
    bottom: 80,
    right: 16,
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  statusOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 12,
  },
  statusOptionText: {
    fontSize: 16,
    color: '#fff',
  },
});

export default OrderDetailPanel;

