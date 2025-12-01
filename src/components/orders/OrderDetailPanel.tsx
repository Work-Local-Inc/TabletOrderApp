import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Order } from '../../types';
import { useTheme } from '../../theme';
import {
  printKitchenTicket,
  printCustomerReceipt,
  printBoth,
} from '../../services/printService';

interface OrderDetailPanelProps {
  order: Order | null;
  onStatusChange?: (orderId: string, status: string) => Promise<void>;
  onPrinted?: (orderId: string) => void;
  onClose?: () => void;
  printerConnected: boolean;
}

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
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
};

const STATUS_OPTIONS = [
  { key: 'preparing', label: 'In progress', color: '#3b82f6' },
  { key: 'ready', label: 'Ready', color: '#1e293b' },
  { key: 'completed', label: 'Picked up', color: '#1e293b' },
];

const getInitials = (name: string): string => {
  if (!name) return '??';
  const parts = name.split(' ');
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
};

export const OrderDetailPanel: React.FC<OrderDetailPanelProps> = ({
  order,
  onStatusChange,
  onPrinted,
  onClose,
  printerConnected,
}) => {
  const { theme, themeMode } = useTheme();
  const insets = useSafeAreaInsets();
  const [printingType, setPrintingType] = useState<string | null>(null);
  const [changingStatus, setChangingStatus] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [showPrintMenu, setShowPrintMenu] = useState(false);
  
  const bottomPadding = Math.max(insets.bottom, 16);

  const colors = {
    bg: themeMode === 'dark' ? '#1a1a2e' : '#ffffff',
    surface: themeMode === 'dark' ? '#16213e' : '#f8fafc',
    text: theme.text,
    textSecondary: theme.textSecondary,
    textMuted: theme.textMuted,
    border: themeMode === 'dark' ? '#334155' : '#e2e8f0',
    link: '#3b82f6',
    itemBg: '#8b5cf6',
  };

  if (!order) {
    return (
      <View style={[styles.emptyContainer, { backgroundColor: colors.bg }]}>
        <Text style={styles.emptyIcon}>📋</Text>
        <Text style={[styles.emptyTitle, { color: colors.text }]}>Select an Order</Text>
        <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
          Tap an order from the list to view details
        </Text>
      </View>
    );
  }

  const handlePrint = async (type: 'kitchen' | 'receipt' | 'both') => {
    setShowPrintMenu(false);
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
    setShowStatusModal(false);
    try {
      await onStatusChange(order.id, newStatus);
    } catch (error) {
      Alert.alert('Error', 'Failed to update status');
    } finally {
      setChangingStatus(false);
    }
  };

  const customerName = order.customer?.name || 'Walk-in Customer';
  const orderType = order.order_type || 'pickup';
  const itemCount = order.items?.length || 0;

  const getStatusBadge = (status: string) => {
    const statusColors: Record<string, { bg: string; text: string }> = {
      pending: { bg: '#dbeafe', text: '#1d4ed8' },
      preparing: { bg: '#fef3c7', text: '#b45309' },
      ready: { bg: '#d1fae5', text: '#047857' },
      completed: { bg: '#f3f4f6', text: '#6b7280' },
    };
    const color = statusColors[status] || statusColors.pending;
    const label = status === 'pending' ? 'New' : status === 'preparing' ? 'Active' : status.charAt(0).toUpperCase() + status.slice(1);
    
    return (
      <View style={[styles.statusBadge, { backgroundColor: color.bg }]}>
        {status === 'pending' && <View style={styles.statusDot} />}
        <Text style={[styles.statusBadgeText, { color: color.text }]}>{label}</Text>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      {/* Header Bar - Square Style */}
      <View style={[styles.headerBar, { borderBottomColor: colors.border }]}>
        {onClose && (
          <TouchableOpacity style={styles.headerButton} onPress={onClose}>
            <Text style={[styles.headerButtonText, { color: colors.text }]}>✕</Text>
          </TouchableOpacity>
        )}
        <View style={styles.headerSpacer} />
        
        {/* Print Button */}
        <TouchableOpacity 
          style={[styles.headerButton, { borderColor: colors.border }]} 
          onPress={() => setShowPrintMenu(!showPrintMenu)}
          disabled={!!printingType}
        >
          {printingType ? (
            <ActivityIndicator size="small" color={colors.text} />
          ) : (
            <Text style={styles.printIcon}>🖨️</Text>
          )}
        </TouchableOpacity>
        
        {/* More Button */}
        <TouchableOpacity style={[styles.headerButton, { borderColor: colors.border }]}>
          <Text style={[styles.headerButtonText, { color: colors.text }]}>⋯</Text>
        </TouchableOpacity>
        
        {/* Mark as Button */}
        <TouchableOpacity 
          style={styles.markAsButton}
          onPress={() => setShowStatusModal(true)}
          disabled={changingStatus}
        >
          {changingStatus ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.markAsText}>Mark as...</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Print Menu Dropdown */}
      {showPrintMenu && (
        <View style={[styles.printMenu, { backgroundColor: colors.bg, borderColor: colors.border }]}>
          <TouchableOpacity style={styles.printMenuItem} onPress={() => handlePrint('kitchen')}>
            <Text style={styles.printMenuIcon}>🍳</Text>
            <Text style={[styles.printMenuText, { color: colors.text }]}>Kitchen Ticket</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.printMenuItem} onPress={() => handlePrint('receipt')}>
            <Text style={styles.printMenuIcon}>🧾</Text>
            <Text style={[styles.printMenuText, { color: colors.text }]}>Customer Receipt</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.printMenuItem} onPress={() => handlePrint('both')}>
            <Text style={styles.printMenuIcon}>📋</Text>
            <Text style={[styles.printMenuText, { color: colors.text }]}>Print Both</Text>
          </TouchableOpacity>
        </View>
      )}

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Customer Name */}
        <Text style={[styles.customerName, { color: colors.text }]}>{customerName}</Text>
        
        {/* Status Badges */}
        <View style={styles.badgeRow}>
          {getStatusBadge(order.status)}
          <View style={[styles.statusBadge, { backgroundColor: '#d1fae5' }]}>
            <Text style={[styles.statusBadgeText, { color: '#047857' }]}>Paid</Text>
          </View>
        </View>

        {/* Pickup/Delivery Details */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          {orderType === 'delivery' ? 'Delivery details' : 'Pickup details'}
        </Text>

        <View style={styles.detailsGrid}>
          <View style={[styles.detailRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.detailLabel, { color: colors.textMuted }]}>Customer</Text>
            <Text style={[styles.detailValue, { color: colors.link }]}>{customerName}</Text>
          </View>
          
          <View style={[styles.detailRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.detailLabel, { color: colors.textMuted }]}>Created</Text>
            <Text style={[styles.detailValue, { color: colors.text }]}>{formatDate(order.created_at)}</Text>
          </View>
          
          <View style={[styles.detailRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.detailLabel, { color: colors.textMuted }]}>Order #</Text>
            <Text style={[styles.detailValue, { color: colors.text }]}>{order.order_number}</Text>
          </View>
          
          {order.customer?.phone && (
            <View style={[styles.detailRow, { borderBottomColor: colors.border }]}>
              <Text style={[styles.detailLabel, { color: colors.textMuted }]}>Phone</Text>
              <Text style={[styles.detailValue, { color: colors.link }]}>{order.customer.phone}</Text>
            </View>
          )}
        </View>

        {/* Items Section */}
        <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 24 }]}>
          Items ({itemCount})
        </Text>

        {(order.items || []).map((item, index) => (
          <View key={index} style={[styles.itemRow, { borderBottomColor: colors.border }]}>
            <View style={[styles.itemPreview, { backgroundColor: colors.itemBg }]}>
              <Text style={styles.itemInitials}>{getInitials(item.name)}</Text>
            </View>
            <View style={styles.itemInfo}>
              <Text style={[styles.itemName, { color: colors.text }]}>
                {item.name} <Text style={{ color: colors.textMuted }}>x {item.quantity}</Text>
              </Text>
              {item.modifiers && item.modifiers.length > 0 && (
                <Text style={[styles.itemModifiers, { color: colors.textMuted }]}>
                  {item.modifiers.map(m => m.name).join(', ')}
                </Text>
              )}
              {item.notes && (
                <Text style={styles.itemNotes}>"{item.notes}"</Text>
              )}
            </View>
            <Text style={[styles.itemPrice, { color: colors.text }]}>
              ${((item.price || 0) * (item.quantity || 1)).toFixed(2)}
            </Text>
          </View>
        ))}

        {/* Totals */}
        <View style={[styles.totalsSection, { borderTopColor: colors.border }]}>
          <View style={styles.totalRow}>
            <Text style={[styles.totalLabel, { color: colors.textMuted }]}>Subtotal</Text>
            <Text style={[styles.totalValue, { color: colors.text }]}>${(order.subtotal || 0).toFixed(2)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={[styles.totalLabel, { color: colors.textMuted }]}>Tax</Text>
            <Text style={[styles.totalValue, { color: colors.text }]}>${(order.tax || 0).toFixed(2)}</Text>
          </View>
          <View style={[styles.totalRow, styles.grandTotalRow]}>
            <Text style={[styles.grandTotalLabel, { color: colors.text }]}>Total</Text>
            <Text style={[styles.grandTotalValue]}>${(order.total || 0).toFixed(2)}</Text>
          </View>
        </View>

        {/* Order Notes */}
        {order.notes && (
          <View style={styles.notesSection}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Order Notes</Text>
            <Text style={[styles.notesText, { color: colors.text }]}>{order.notes}</Text>
          </View>
        )}

        <View style={{ height: bottomPadding + 20 }} />
      </ScrollView>

      {/* Mark as Modal - Square Style */}
      <Modal
        visible={showStatusModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowStatusModal(false)}
      >
        <TouchableOpacity 
          style={styles.modalOverlay} 
          activeOpacity={1} 
          onPress={() => setShowStatusModal(false)}
        >
          <View style={[styles.modalContent, { backgroundColor: colors.bg }]}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setShowStatusModal(false)}>
                <Text style={[styles.modalClose, { color: colors.text }]}>✕</Text>
              </TouchableOpacity>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Mark items as...</Text>
              <View style={{ width: 30 }} />
            </View>
            
            <Text style={[styles.modalItemName, { color: colors.textMuted }]}>
              {order.items?.[0]?.name || 'Order'} x {itemCount}
            </Text>
            
            {STATUS_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.key}
                style={[styles.modalOption, { borderColor: colors.border }]}
                onPress={() => handleStatusChange(option.key)}
              >
                <Text style={[styles.modalOptionText, { color: option.color }]}>
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 15,
    textAlign: 'center',
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    gap: 8,
  },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerButtonText: {
    fontSize: 18,
  },
  printIcon: {
    fontSize: 20,
  },
  headerSpacer: {
    flex: 1,
  },
  markAsButton: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  markAsText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  printMenu: {
    position: 'absolute',
    top: 60,
    right: 120,
    borderRadius: 8,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 100,
  },
  printMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 10,
  },
  printMenuIcon: {
    fontSize: 18,
  },
  printMenuText: {
    fontSize: 15,
  },
  content: {
    flex: 1,
    padding: 20,
  },
  customerName: {
    fontSize: 26,
    fontWeight: '600',
    marginBottom: 12,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 24,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#3b82f6',
  },
  statusBadgeText: {
    fontSize: 13,
    fontWeight: '500',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  detailsGrid: {},
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  detailLabel: {
    fontSize: 14,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '500',
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    gap: 12,
  },
  itemPreview: {
    width: 44,
    height: 44,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  itemInitials: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  itemInfo: {
    flex: 1,
  },
  itemName: {
    fontSize: 15,
    fontWeight: '500',
  },
  itemModifiers: {
    fontSize: 13,
    marginTop: 2,
  },
  itemNotes: {
    fontSize: 13,
    color: '#f59e0b',
    marginTop: 4,
    fontStyle: 'italic',
  },
  itemPrice: {
    fontSize: 15,
    fontWeight: '500',
  },
  totalsSection: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  totalLabel: {
    fontSize: 14,
  },
  totalValue: {
    fontSize: 14,
  },
  grandTotalRow: {
    marginTop: 8,
    paddingTop: 12,
  },
  grandTotalLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  grandTotalValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#22c55e',
  },
  notesSection: {
    marginTop: 24,
    padding: 16,
    backgroundColor: '#fef3c7',
    borderRadius: 8,
  },
  notesText: {
    fontSize: 14,
    lineHeight: 20,
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '80%',
    maxWidth: 400,
    borderRadius: 12,
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  modalClose: {
    fontSize: 20,
    padding: 4,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  modalItemName: {
    fontSize: 14,
    marginBottom: 20,
    textAlign: 'center',
  },
  modalOption: {
    paddingVertical: 16,
    borderWidth: 1,
    borderRadius: 8,
    marginBottom: 10,
    alignItems: 'center',
  },
  modalOptionText: {
    fontSize: 16,
    fontWeight: '500',
  },
});

export default OrderDetailPanel;
