import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Modal,
  Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Order } from '../../types';
import { useTheme } from '../../theme';
import {
  printKitchenTicket,
  printCustomerReceipt,
  printBoth,
} from '../../services/printService';
import { apiClient } from '../../api/client';

interface OrderDetailPanelProps {
  order: Order | null;
  onStatusChange?: (orderId: string, status: string) => Promise<void>;
  onPrinted?: (orderId: string) => void;
  onClose?: () => void;
  printerConnected: boolean;
  simplifiedView?: boolean;
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
  { key: 'preparing', label: 'In progress' },
  { key: 'ready', label: 'Ready' },
  { key: 'completed', label: 'Picked up' },
];

// Simplified view: only 2 states (New = pending/preparing, Complete = completed)
const SIMPLIFIED_STATUS_OPTIONS = [
  { key: 'pending', label: 'New' },
  { key: 'completed', label: 'Complete' },
];

// User-friendly status options - app handles auto-transitions behind the scenes
const getAvailableStatusOptions = (currentStatus: string) => {
  // Show practical options based on where the order is in the workflow
  switch (currentStatus) {
    case 'pending':
    case 'confirmed':
      // New order: can mark as in progress, ready, or completed
      return STATUS_OPTIONS;
    case 'preparing':
      // In progress: can mark as ready or completed (app auto-transitions)
      return STATUS_OPTIONS.filter(o => o.key === 'ready' || o.key === 'completed');
    case 'ready':
      // Ready: can mark as completed or revert to in progress
      return STATUS_OPTIONS.filter(o => o.key === 'preparing' || o.key === 'completed');
    case 'completed':
    case 'delivered':
      // Done: can revert if needed
      return STATUS_OPTIONS.filter(o => o.key === 'preparing' || o.key === 'ready');
    default:
      return STATUS_OPTIONS;
  }
};

// Simplified view: just toggle between New and Complete
const getSimplifiedStatusOptions = (currentStatus: string) => {
  // In simplified view, show the opposite state
  const isComplete = currentStatus === 'completed' || currentStatus === 'ready' || currentStatus === 'cancelled';
  if (isComplete) {
    // Can move back to New
    return SIMPLIFIED_STATUS_OPTIONS.filter(o => o.key === 'pending');
  } else {
    // Can mark as Complete
    return SIMPLIFIED_STATUS_OPTIONS.filter(o => o.key === 'completed');
  }
};

const getInitials = (name: string): string => {
  if (!name) return '??';
  const parts = name.split(' ');
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
};

// Get short, memorable order number (last 4 chars)
const getShortOrderNumber = (orderNumber: string): string => {
  if (!orderNumber) return '----';
  return orderNumber.slice(-4).toUpperCase();
};

export const OrderDetailPanel: React.FC<OrderDetailPanelProps> = ({
  order,
  onStatusChange,
  onPrinted,
  onClose,
  printerConnected,
  simplifiedView = false,
}) => {
  const { theme, themeMode } = useTheme();
  const insets = useSafeAreaInsets();
  const [printingType, setPrintingType] = useState<string | null>(null);
  const [changingStatus, setChangingStatus] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [showPrintMenu, setShowPrintMenu] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [cancellingOrder, setCancellingOrder] = useState(false);
  const [dispatchInfo, setDispatchInfo] = useState<{
    dispatch_available: boolean;
    provider: { code: string; name: string; external_id: string } | null;
  } | null>(null);
  const [dispatchingDriver, setDispatchingDriver] = useState(false);
  const [driverDispatched, setDriverDispatched] = useState(false);

  // Check if driver dispatch is available for delivery orders
  useEffect(() => {
    const checkDispatch = async () => {
      // Reset state when order changes
      setDispatchInfo(null);
      setDriverDispatched(false);
      
      // Only check for delivery orders in valid statuses
      if (!order || order.order_type !== 'delivery') {
        return;
      }
      
      // Check for confirmed, preparing, or ready statuses
      const validStatuses = ['confirmed', 'preparing', 'ready'];
      if (!validStatuses.includes(order.status)) {
        return;
      }
      
      try {
        const response = await apiClient.checkDispatchAvailable(order.id);
        if (response.success && response.data) {
          setDispatchInfo(response.data);
        }
      } catch (error) {
        console.log('[Dispatch] Check failed, not showing button');
      }
    };
    
    checkDispatch();
  }, [order?.id, order?.status, order?.order_type]);
  
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
    setShowMoreMenu(false);
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
      const currentStatus = order.status;
      
      // Auto-transition: If going from preparing -> completed, go through ready first
      if (currentStatus === 'preparing' && newStatus === 'completed') {
        await onStatusChange(order.id, 'ready');
        // Small delay to ensure backend processes first transition
        await new Promise(resolve => setTimeout(resolve, 300));
        await onStatusChange(order.id, 'completed');
      }
      // Auto-transition: If going from pending -> ready, go through preparing first
      else if (currentStatus === 'pending' && newStatus === 'ready') {
        await onStatusChange(order.id, 'preparing');
        await new Promise(resolve => setTimeout(resolve, 300));
        await onStatusChange(order.id, 'ready');
      }
      // Auto-transition: If going from pending -> completed, go through preparing -> ready -> completed
      else if (currentStatus === 'pending' && newStatus === 'completed') {
        await onStatusChange(order.id, 'preparing');
        await new Promise(resolve => setTimeout(resolve, 300));
        await onStatusChange(order.id, 'ready');
        await new Promise(resolve => setTimeout(resolve, 300));
        await onStatusChange(order.id, 'completed');
      }
      // Direct transition for all other cases
      else {
        await onStatusChange(order.id, newStatus);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to update status');
    } finally {
      setChangingStatus(false);
    }
  };

  const handleCancelOrder = () => {
    setShowMoreMenu(false);
    Alert.alert(
      'Cancel Order',
      `Are you sure you want to cancel order #${getShortOrderNumber(order.order_number)}? This cannot be undone.`,
      [
        { text: 'No, Keep Order', style: 'cancel' },
        { 
          text: 'Yes, Cancel Order', 
          style: 'destructive',
          onPress: async () => {
            if (!onStatusChange) return;
            setCancellingOrder(true);
            try {
              await onStatusChange(order.id, 'cancelled');
            } catch (error) {
              Alert.alert('Error', 'Failed to cancel order');
            } finally {
              setCancellingOrder(false);
            }
          }
        },
      ]
    );
  };

  const handleCallCustomer = () => {
    setShowMoreMenu(false);
    const phone = order.customer?.phone;
    if (!phone) {
      Alert.alert('No Phone Number', 'This customer does not have a phone number on file.');
      return;
    }
    // Clean the phone number (remove spaces, dashes, etc.)
    const cleanPhone = phone.replace(/[^\d+]/g, '');
    Linking.openURL(`tel:${cleanPhone}`).catch(() => {
      Alert.alert('Error', 'Could not open phone dialer.');
    });
  };

  const handleDispatchDriver = async () => {
    if (!order) return;
    
    setDispatchingDriver(true);
    try {
      const response = await apiClient.dispatchDriver(order.id);
      if (response.success && response.data) {
        setDriverDispatched(true);
        setDispatchInfo(null);
        
        // Show appropriate message based on backup email usage
        if (response.data.used_backup_email) {
          Alert.alert(
            'Driver Requested (Backup)',
            'Driver request sent via backup email. A driver will be dispatched shortly.',
            [{ text: 'OK' }]
          );
        } else {
          Alert.alert(
            'Driver Requested',
            response.data.message || 'A driver has been dispatched and will arrive shortly.',
            [{ text: 'OK' }]
          );
        }
      } else {
        Alert.alert('Error', response.error || 'Failed to request driver. Please try again.');
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to request driver. Please try again.');
    } finally {
      setDispatchingDriver(false);
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
        
        {/* Mark as Button - positioned left to avoid OS gesture area */}
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
        
        {/* Request Driver Button - positioned left, next to Mark as */}
        {dispatchInfo?.dispatch_available && dispatchInfo?.provider && !driverDispatched && (
          <TouchableOpacity 
            style={styles.dispatchButton}
            onPress={handleDispatchDriver}
            disabled={dispatchingDriver}
          >
            {dispatchingDriver ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.dispatchButtonText}>
                Request {dispatchInfo.provider.name} Driver
              </Text>
            )}
          </TouchableOpacity>
        )}
        
        {/* Driver Dispatched Indicator */}
        {driverDispatched && (
          <View style={styles.dispatchedBadge}>
            <Text style={styles.dispatchedText}>Driver Requested</Text>
          </View>
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
        <TouchableOpacity 
          style={[styles.headerButton, { borderColor: colors.border }]}
          onPress={() => setShowMoreMenu(!showMoreMenu)}
        >
          <Text style={[styles.headerButtonText, { color: colors.text }]}>⋯</Text>
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

      {/* More Menu Dropdown */}
      {showMoreMenu && (
        <View style={[styles.moreMenu, { backgroundColor: colors.bg, borderColor: colors.border }]}>
          <TouchableOpacity style={styles.printMenuItem} onPress={() => handlePrint('receipt')}>
            <Text style={styles.printMenuIcon}>🧾</Text>
            <Text style={[styles.printMenuText, { color: colors.text }]}>Reprint Receipt</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.printMenuItem} onPress={() => handlePrint('kitchen')}>
            <Text style={styles.printMenuIcon}>🍳</Text>
            <Text style={[styles.printMenuText, { color: colors.text }]}>Reprint Kitchen Ticket</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.printMenuItem} onPress={handleCallCustomer}>
            <Text style={styles.printMenuIcon}>📞</Text>
            <Text style={[styles.printMenuText, { color: colors.text }]}>Call Customer</Text>
          </TouchableOpacity>
          <View style={[styles.menuDivider, { backgroundColor: colors.border }]} />
          <TouchableOpacity 
            style={styles.printMenuItem} 
            onPress={handleCancelOrder}
            disabled={cancellingOrder || order.status === 'cancelled'}
          >
            {cancellingOrder ? (
              <ActivityIndicator size="small" color="#ef4444" />
            ) : (
              <Text style={styles.printMenuIcon}>❌</Text>
            )}
            <Text style={[styles.printMenuText, { color: order.status === 'cancelled' ? colors.textMuted : '#ef4444' }]}>
              {order.status === 'cancelled' ? 'Order Cancelled' : 'Cancel Order'}
            </Text>
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
            <Text style={[styles.detailValue, { color: colors.text }]}>#{getShortOrderNumber(order.order_number)}</Text>
          </View>
          
          {order.customer?.phone && (
            <View style={[styles.detailRow, { borderBottomColor: colors.border }]}>
              <Text style={[styles.detailLabel, { color: colors.textMuted }]}>Phone</Text>
              <Text style={[styles.detailValue, { color: colors.link }]}>{order.customer.phone}</Text>
            </View>
          )}
          
          {/* Delivery Address (for delivery orders) */}
          {orderType === 'delivery' && order.delivery_address && (
            <View style={[styles.detailRow, { borderBottomColor: colors.border, flexDirection: 'column', alignItems: 'flex-start' }]}>
              <Text style={[styles.detailLabel, { color: colors.textMuted, marginBottom: 4 }]}>Delivery Address</Text>
              <View>
                {order.delivery_address.street && (
                  <Text style={[styles.detailValue, { color: colors.text }]}>{order.delivery_address.street}</Text>
                )}
                {(order.delivery_address.city || order.delivery_address.province || order.delivery_address.postal_code || order.delivery_address.postalCode) && (
                  <Text style={[styles.detailValue, { color: colors.text }]}>
                    {[
                      order.delivery_address.city, 
                      order.delivery_address.province, 
                      order.delivery_address.postal_code || order.delivery_address.postalCode
                    ].filter(Boolean).join(', ')}
                  </Text>
                )}
                {(order.delivery_address.instructions || order.delivery_address.delivery_instructions) && (
                  <Text style={[styles.itemNotes, { marginTop: 4 }]}>
                    📍 {order.delivery_address.instructions || order.delivery_address.delivery_instructions}
                  </Text>
                )}
              </View>
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

        {/* Order Notes (strip Twilio call logs) */}
        {order.notes && order.notes.split('\n').filter(l => !l.includes('TWILIO_FALLBACK_CALL')).join('\n').trim() !== '' && (
          <View style={styles.notesSection}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Order Notes</Text>
            <Text style={[styles.notesText, { color: colors.text }]}>
              {order.notes.split('\n').filter(l => !l.includes('TWILIO_FALLBACK_CALL')).join('\n').trim()}
            </Text>
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
            
            {(simplifiedView ? getSimplifiedStatusOptions(order.status) : getAvailableStatusOptions(order.status)).map((option) => {
              const isCurrentStatus = order.status === option.key;
              return (
                <TouchableOpacity
                  key={option.key}
                  style={[
                    styles.modalOption, 
                    { 
                      borderColor: isCurrentStatus ? '#3b82f6' : colors.border,
                      backgroundColor: isCurrentStatus 
                        ? (themeMode === 'dark' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(59, 130, 246, 0.08)')
                        : 'transparent',
                      borderWidth: isCurrentStatus ? 2 : 1,
                    }
                  ]}
                  onPress={() => handleStatusChange(option.key)}
                >
                  <View style={styles.modalOptionContent}>
                    {isCurrentStatus && (
                      <Text style={styles.modalOptionCheck}>✓</Text>
                    )}
                    <Text style={[
                      styles.modalOptionText, 
                      { 
                        color: isCurrentStatus ? '#3b82f6' : colors.text,
                        fontWeight: isCurrentStatus ? '600' : '500',
                      }
                    ]}>
                      {option.label}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
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
  dispatchButton: {
    backgroundColor: '#10b981',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    marginLeft: 8,
  },
  dispatchButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  dispatchedBadge: {
    backgroundColor: '#d1fae5',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginLeft: 8,
  },
  dispatchedText: {
    color: '#047857',
    fontSize: 13,
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
  moreMenu: {
    position: 'absolute',
    top: 60,
    right: 70,
    borderRadius: 8,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 100,
    minWidth: 200,
  },
  menuDivider: {
    height: 1,
    marginVertical: 4,
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
  modalOptionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  modalOptionCheck: {
    fontSize: 16,
    color: '#3b82f6',
    fontWeight: '700',
  },
  modalOptionText: {
    fontSize: 16,
    fontWeight: '500',
  },
});

export default OrderDetailPanel;
