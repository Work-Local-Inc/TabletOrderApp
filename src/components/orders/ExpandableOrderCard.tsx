import React, { useRef, useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Vibration,
  Animated,
  PanResponder,
  TouchableOpacity,
  LayoutAnimation,
  Platform,
  UIManager,
  Linking,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Order } from '../../types';
import { useTheme } from '../../theme';
import { apiClient } from '../../api/client';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface ExpandableOrderCardProps {
  order: Order;
  column: 'new' | 'complete';
  isExpanded: boolean;
  onDragEnd: (orderId: string, translationX: number) => void;
  onDragStart?: () => void;
  onDragRelease?: () => void;
  onTap: (orderId: string) => void;
  onStatusChange: (orderId: string) => void;
  containerWidth: number;
}

/**
 * Strip Twilio call log entries from order notes.
 * These are injected by the backend and shouldn't show to restaurant staff.
 */
const stripTwilioLogs = (notes: string): string => {
  if (!notes) return '';
  // Remove lines containing TWILIO_FALLBACK_CALL and surrounding whitespace
  const cleaned = notes
    .split('\n')
    .filter(line => !line.includes('TWILIO_FALLBACK_CALL'))
    .join('\n')
    .replace(/\|\s*\|/g, '|')  // Clean up double pipes left behind
    .replace(/^\s*\|\s*/gm, '') // Clean up leading pipes
    .replace(/\s*\|\s*$/gm, '') // Clean up trailing pipes
    .trim();
  return cleaned;
};

const formatTime = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleTimeString('en-US', {
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

const getShortOrderNumber = (orderNumber: string): string => {
  if (!orderNumber) return '----';
  return orderNumber.slice(-4).toUpperCase();
};

const formatPrice = (price: number): string => {
  return `$${(price || 0).toFixed(2)}`;
};

const getInitials = (name: string): string => {
  if (!name) return '??';
  const parts = name.split(' ');
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
};

export const ExpandableOrderCard: React.FC<ExpandableOrderCardProps> = ({
  order,
  column,
  isExpanded,
  onDragEnd,
  onDragStart,
  onDragRelease,
  onTap,
  onStatusChange,
  containerWidth,
}) => {
  const { theme, themeMode } = useTheme();
  const pan = useRef(new Animated.ValueXY()).current;
  const scale = useRef(new Animated.Value(1)).current;
  const zIndex = useRef(new Animated.Value(2)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const isDragging = useRef(false);
  const startTime = useRef(0);

  const customerName = order.customer?.name || 'Walk-in';
  const customerPhone = order.customer?.phone;
  const orderType = order.order_type || 'pickup';
  const items = order.items || [];

  // Driver dispatch state
  const [dispatchInfo, setDispatchInfo] = useState<{
    dispatch_available: boolean;
    provider: { code: string; name: string; external_id: string } | null;
  } | null>(null);
  const [dispatchingDriver, setDispatchingDriver] = useState(false);
  const [driverDispatched, setDriverDispatched] = useState(false);
  const [showCompleteOptions, setShowCompleteOptions] = useState(false);

  // Check if driver dispatch is available for delivery orders
  useEffect(() => {
    const checkDispatch = async () => {
      setDispatchInfo(null);
      setDriverDispatched(false);
      
      console.log('[Dispatch] Checking - order_type:', order?.order_type, 'status:', order?.status);
      
      if (!order || order.order_type !== 'delivery') {
        console.log('[Dispatch] Not a delivery order, skipping');
        return;
      }
      
      const validStatuses = ['confirmed', 'preparing', 'ready'];
      if (!validStatuses.includes(order.status)) {
        console.log('[Dispatch] Status not valid for dispatch:', order.status);
        return;
      }
      
      try {
        console.log('[Dispatch] Calling checkDispatchAvailable for order:', order.id);
        const response = await apiClient.checkDispatchAvailable(order.id);
        console.log('[Dispatch] Response:', response);
        if (response.success && response.data) {
          console.log('[Dispatch] Setting dispatch info:', response.data);
          setDispatchInfo(response.data);
        } else {
          console.log('[Dispatch] No dispatch available or failed');
        }
      } catch (error) {
        console.log('[Dispatch] Check failed:', error);
      }
    };
    
    if (isExpanded) {
      checkDispatch();
    }
  }, [order?.id, order?.status, order?.order_type, isExpanded]);

  const handleDispatchDriver = async () => {
    if (!order) return;
    
    setDispatchingDriver(true);
    try {
      const response = await apiClient.dispatchDriver(order.id);
      if (response.success && response.data) {
        setDriverDispatched(true);
        setDispatchInfo(null);
        
        if (response.data.used_backup_email) {
          Alert.alert('Driver Requested (Backup)', 'Driver request sent via backup email.');
        } else {
          Alert.alert('Driver Requested', response.data.message || 'A driver has been dispatched.');
        }
      } else {
        Alert.alert('Error', response.error || 'Failed to request driver.');
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to request driver.');
    } finally {
      setDispatchingDriver(false);
    }
  };

  // Reset opacity and pan when order/column changes (after drag completes)
  useEffect(() => {
    opacity.setValue(1);
    pan.setValue({ x: 0, y: 0 });
    setShowCompleteOptions(false);
  }, [order.id, column]);
  
  // Reset complete options when card collapses
  useEffect(() => {
    if (!isExpanded) {
      setShowCompleteOptions(false);
    }
  }, [isExpanded]);

  // Animate expand/collapse
  useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  }, [isExpanded]);

  // Design system colors
  const colors = {
    // Card backgrounds
    cardBg: '#ffffff',
    cardBgDark: '#1e293b',
    // Header background when expanded
    headerBg: '#293A4A',
    headerText: '#ffffff',
    // Content
    contentBg: '#ffffff',
    contentBgDark: '#0f172a',
    // Text
    text: themeMode === 'dark' ? '#f1f5f9' : '#1e293b',
    textSecondary: themeMode === 'dark' ? '#94a3b8' : '#64748b',
    textMuted: themeMode === 'dark' ? '#64748b' : '#94a3b8',
    // Borders
    border: themeMode === 'dark' ? '#334155' : '#e2e8f0',
    borderExpanded: themeMode === 'dark' ? '#475569' : '#cbd5e1',
    // Accents - New = Green, Complete = Red
    newAccent: '#22c55e',
    completeAccent: '#DC2626',
    // Interactive
    link: '#3b82f6',
    // Status badges
    badgeBg: 'rgba(255,255,255,0.15)',
    // Items
    itemBg: '#293A4A',
    // Action button
    actionBg: column === 'new' ? '#22c55e' : '#3b82f6',
  };

  const cardBackground = themeMode === 'dark' ? colors.cardBgDark : colors.cardBg;
  const contentBackground = themeMode === 'dark' ? colors.contentBgDark : colors.contentBg;
  const borderColor = isExpanded ? colors.borderExpanded : colors.border;
  const accentColor = column === 'new' ? colors.newAccent : colors.completeAccent;

  const panResponder = useRef(
    PanResponder.create({
      // Claim touch on start so native Android ScrollView doesn't grab it first.
      // Native ScrollView operates at the native level and will win if we don't claim.
      // We'll give up to ScrollView only when vertical movement is clearly established.
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        // Also claim on move if horizontal movement dominates (reclaim after termination)
        return Math.abs(gestureState.dx) > 10 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy);
      },
      // Capture phase: intercept horizontal moves before ScrollView can claim them
      onMoveShouldSetPanResponderCapture: (_, gestureState) => {
        return Math.abs(gestureState.dx) > 10 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy);
      },
      // CRITICAL: Allow native ScrollView to work on Android
      onShouldBlockNativeResponder: () => false,
      // Smart termination: only give up when vertical scroll intent is clear.
      // Default to KEEPING the touch so horizontal drags aren't stolen.
      onPanResponderTerminationRequest: (_, gestureState) => {
        // Active drag: never give up
        if (isDragging.current) return false;
        // Horizontal movement started: keep the touch
        if (Math.abs(gestureState.dx) > 5 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy)) return false;
        // Only give up when vertical movement clearly dominates (user is scrolling)
        if (Math.abs(gestureState.dy) > 10 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx) * 1.5) return true;
        // No clear direction yet: hold the touch (don't give up prematurely)
        return false;
      },
      onPanResponderGrant: () => {
        startTime.current = Date.now();
        isDragging.current = false;
      },
      onPanResponderMove: (_, gestureState) => {
        // Only start drag after significant horizontal movement
        if (!isDragging.current && Math.abs(gestureState.dx) > 15 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy)) {
          isDragging.current = true;
          zIndex.setValue(20);
          opacity.setValue(0.92);
          Vibration.vibrate(50);
          Animated.spring(scale, { toValue: 1.08, useNativeDriver: false }).start();
          onDragStart?.();
        }
        if (isDragging.current) {
          pan.setValue({ x: gestureState.dx, y: 0 });
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        // Reset visual state
        Animated.spring(scale, { toValue: 1, useNativeDriver: false }).start();
        opacity.setValue(1);
        zIndex.setValue(2);

        if (isDragging.current) {
          onDragRelease?.();
          isDragging.current = false;

          const threshold = containerWidth * 0.25;
          if (Math.abs(gestureState.dx) > threshold) {
            Vibration.vibrate(100);
            pan.setValue({ x: 0, y: 0 });
            onDragEnd(order.id, gestureState.dx);
          } else {
            Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
          }
        } else {
          isDragging.current = false;
        }
      },
      onPanResponderTerminate: () => {
        zIndex.setValue(2);
        opacity.setValue(1);
        if (isDragging.current) {
          onDragRelease?.();
        }
        isDragging.current = false;
        Animated.parallel([
          Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: false }),
          Animated.spring(scale, { toValue: 1, useNativeDriver: false }),
        ]).start();
      },
    })
  ).current;

  const handlePhonePress = () => {
    if (customerPhone) {
      const cleanPhone = customerPhone.replace(/[^\d+]/g, '');
      Linking.openURL(`tel:${cleanPhone}`);
    }
  };

  const handleStatusPress = () => {
    // For delivery orders with dispatch available in the "new" column, show options
    if (column === 'new' && orderType === 'delivery' && dispatchInfo?.dispatch_available && !driverDispatched) {
      setShowCompleteOptions(!showCompleteOptions);
    } else {
      onStatusChange(order.id);
    }
  };

  const handleCompleteOnly = () => {
    setShowCompleteOptions(false);
    onStatusChange(order.id);
  };

  const handleCompleteAndDispatch = async () => {
    setShowCompleteOptions(false);
    setDispatchingDriver(true);
    
    // First complete the order
    onStatusChange(order.id);
    
    // Then dispatch the driver
    try {
      const response = await apiClient.dispatchDriver(order.id);
      if (response.success && response.data) {
        setDriverDispatched(true);
        setDispatchInfo(null);
        Alert.alert('Order Complete', 'Driver has been requested.');
      } else {
        Alert.alert('Order Completed', 'Note: Driver request failed - ' + (response.error || 'please try manually.'));
      }
    } catch (error) {
      Alert.alert('Order Completed', 'Note: Driver request failed - please try manually.');
    } finally {
      setDispatchingDriver(false);
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'pending': return 'New';
      case 'confirmed': return 'Confirmed';
      case 'preparing': return 'Active';
      case 'ready': return 'Ready';
      case 'completed': return 'Completed';
      case 'cancelled': return 'Cancelled';
      default: return status;
    }
  };

  // Collapsed card view
  if (!isExpanded) {
    const isCompleteColumn = column === 'complete';
    const collapsedBg = isCompleteColumn ? '#DC2626' : cardBackground;
    const collapsedTextColor = isCompleteColumn ? '#ffffff' : colors.text;
    const collapsedSecondaryColor = isCompleteColumn ? 'rgba(255,255,255,0.8)' : colors.textSecondary;
    const collapsedMutedColor = isCompleteColumn ? 'rgba(255,255,255,0.9)' : colors.textMuted;
    
    return (
      <Animated.View
        renderToHardwareTextureAndroid
        style={[
          styles.card,
          {
            backgroundColor: collapsedBg,
            borderColor: isCompleteColumn ? '#DC2626' : borderColor,
            borderLeftColor: accentColor,
            zIndex: zIndex,
            elevation: zIndex,
            opacity: opacity,
            transform: [
              { translateX: pan.x },
              { translateY: pan.y },
              { scale: scale },
            ],
          },
        ]}
        // Tap detection via native touch events — lightweight, doesn't claim
        // the responder, so it coexists with PanResponder without conflict.
        onTouchStart={() => {
          startTime.current = Date.now();
        }}
        onTouchEnd={() => {
          const duration = Date.now() - startTime.current;
          if (!isDragging.current && duration < 300) {
            onTap(order.id);
          }
        }}
        {...panResponder.panHandlers}
      >
        <View style={styles.collapsedContent}>
          <View style={styles.collapsedLeft}>
            <Text style={[styles.collapsedName, { color: collapsedTextColor }]} numberOfLines={1}>
              {customerName}
            </Text>
            <Text style={[styles.collapsedType, { color: collapsedSecondaryColor }]}>
              {getOrderTypeLabel(orderType)}
            </Text>
          </View>
          <View style={styles.collapsedRight}>
            <Text style={[styles.collapsedTime, { color: collapsedMutedColor }]}>
              {formatTime(order.created_at)}
            </Text>
            <Text style={[styles.collapsedOrder, { color: collapsedMutedColor }]}>
              #{getShortOrderNumber(order.order_number)}
            </Text>
          </View>
        </View>
      </Animated.View>
    );
  }

  // Detect if we're in narrow mode (4-column layout)
  const isNarrow = containerWidth < 300;

  // Expanded card view - no PanResponder (drag only on collapsed cards)
  return (
    <View 
      style={[
        styles.expandedCard, 
        { 
          backgroundColor: contentBackground,
          borderColor: colors.borderExpanded,
        }
      ]}
    >
      {/* Header with customer name - Soft red gradient - Tap anywhere to collapse */}
      <TouchableOpacity 
        activeOpacity={0.9} 
        onPress={() => onTap(order.id)}
        style={styles.headerTouchable}
      >
        <LinearGradient
          colors={['#DC2626', '#B91C1C']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={isNarrow ? styles.expandedHeaderCompact : styles.expandedHeader}
        >
          {isNarrow ? (
            /* Compact header for 4-column view */
            <View style={styles.headerCompactContent}>
              <View style={styles.headerCompactRow1}>
                <Text style={[styles.headerNameCompact, { color: colors.headerText }]} numberOfLines={1}>
                  {customerName}
                </Text>
                {/* Show dispatch options for delivery orders with dispatch available */}
                {column === 'new' && orderType === 'delivery' && dispatchInfo?.dispatch_available && !driverDispatched ? (
                  <View style={styles.headerCompactBtnGroup}>
                    <TouchableOpacity 
                      style={styles.headerActionBtnCompact}
                      onPress={(e) => {
                        e.stopPropagation();
                        onStatusChange(order.id);
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.headerActionTextCompact}>→</Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={[styles.headerActionBtnCompact, { backgroundColor: '#10b981', marginLeft: 4 }]}
                      onPress={(e) => {
                        e.stopPropagation();
                        handleCompleteAndDispatch();
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.headerActionTextCompact}>🚗</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity 
                    style={styles.headerActionBtnCompact}
                    onPress={(e) => {
                      e.stopPropagation();
                      onStatusChange(order.id);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.headerActionTextCompact}>
                      {column === 'new' ? '→' : '←'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
              <Text style={styles.headerMetaCompact}>
                {formatTime(order.created_at)} • #{getShortOrderNumber(order.order_number)}
              </Text>
              <View style={styles.headerBadgeRowCompact}>
                <View style={[styles.headerBadgeCompact, { backgroundColor: 'rgba(0,0,0,0.15)' }]}>
                  <Text style={styles.headerBadgeTextCompact}>{getStatusLabel(order.status)}</Text>
                </View>
                <View style={[styles.headerBadgeCompact, { backgroundColor: 'rgba(0,0,0,0.15)' }]}>
                  <Text style={styles.headerBadgeTextCompact}>{getOrderTypeLabel(orderType)}</Text>
                </View>
              </View>
            </View>
          ) : (
            /* Full header for 2-column view */
            <View style={styles.headerContent}>
              <View style={styles.headerLeft}>
                <Text style={[styles.headerName, { color: colors.headerText }]} numberOfLines={1}>
                  {customerName}
                </Text>
                <View style={styles.headerBadgeRow}>
                  <Text style={styles.headerMeta}>
                    {formatTime(order.created_at)}  •  #{getShortOrderNumber(order.order_number)}
                  </Text>
                  <View style={[styles.headerBadge, { backgroundColor: 'rgba(0,0,0,0.15)' }]}>
                    <Text style={styles.headerBadgeText}>{getStatusLabel(order.status)}</Text>
                  </View>
                  <View style={[styles.headerBadge, { backgroundColor: 'rgba(0,0,0,0.15)' }]}>
                    <Text style={styles.headerBadgeText}>Paid</Text>
                  </View>
                  <View style={[styles.headerBadge, { backgroundColor: 'rgba(0,0,0,0.15)' }]}>
                    <Text style={styles.headerBadgeText}>{getOrderTypeLabel(orderType)}</Text>
                  </View>
                </View>
              </View>
              {/* Right side: Action button(s) */}
              {showCompleteOptions ? (
                <View style={styles.headerActionGroup}>
                  <TouchableOpacity 
                    style={styles.headerActionBtnSmall}
                    onPress={(e) => { e.stopPropagation(); handleCompleteOnly(); }}
                  >
                    <Text style={styles.headerActionTextSmall}>Complete</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.headerActionBtnSmall, styles.headerActionBtnDispatch]}
                    onPress={(e) => { e.stopPropagation(); handleCompleteAndDispatch(); }}
                    disabled={dispatchingDriver}
                  >
                    {dispatchingDriver ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.headerActionTextSmall}>+ Driver</Text>
                    )}
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity 
                  style={styles.headerActionBtn}
                  onPress={(e) => { e.stopPropagation(); handleStatusPress(); }}
                >
                  <Text style={styles.headerActionText}>
                    {column === 'new' ? 'Complete' : 'Reopen'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </LinearGradient>
      </TouchableOpacity>

      {/* Content */}
      <View style={[styles.expandedBody, { backgroundColor: contentBackground }]}>
        {/* Order Details */}
        <View style={styles.detailsSection}>
          <View style={[styles.detailRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.detailLabel, { color: colors.textMuted }]}>Created</Text>
            <Text style={[styles.detailValue, { color: colors.text }]}>{formatDate(order.created_at)}</Text>
          </View>
          
          {customerPhone && (
            <TouchableOpacity 
              style={[styles.detailRow, { borderBottomColor: colors.border }]}
              onPress={handlePhonePress}
            >
              <Text style={[styles.detailLabel, { color: colors.textMuted }]}>Phone</Text>
              <Text style={[styles.detailValue, { color: colors.link }]}>{customerPhone}</Text>
            </TouchableOpacity>
          )}

          {/* Delivery Address */}
          {orderType === 'delivery' && order.delivery_address && (
            <View style={[styles.detailRowColumn, { borderBottomColor: colors.border }]}>
              <Text style={[styles.detailLabel, { color: colors.textMuted }]}>Delivery Address</Text>
              <View style={styles.addressBlock}>
                {order.delivery_address.street && (
                  <Text style={[styles.addressText, { color: colors.text }]}>{order.delivery_address.street}</Text>
                )}
                {(order.delivery_address.city || order.delivery_address.province || order.delivery_address.postal_code || order.delivery_address.postalCode) && (
                  <Text style={[styles.addressText, { color: colors.text }]}>
                    {[
                      order.delivery_address.city, 
                      order.delivery_address.province, 
                      order.delivery_address.postal_code || order.delivery_address.postalCode
                    ].filter(Boolean).join(', ')}
                  </Text>
                )}
                {(order.delivery_address.instructions || order.delivery_address.delivery_instructions) && (
                  <Text style={[styles.deliveryNotes, { color: colors.textSecondary }]}>
                    Note: {order.delivery_address.instructions || order.delivery_address.delivery_instructions}
                  </Text>
                )}
              </View>
            </View>
          )}
        </View>

        {/* Items Section */}
        <View style={styles.itemsSection}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Items ({items.length})
          </Text>

          {items.map((item, index) => (
            <View key={index} style={[styles.itemRow, { borderBottomColor: colors.border }]}>
              <View style={[styles.itemIcon, { backgroundColor: colors.itemBg }]}>
                <Text style={styles.itemInitials}>{getInitials(item.name)}</Text>
              </View>
              <View style={styles.itemDetails}>
                <Text style={[styles.itemName, { color: colors.text }]}>
                  {item.name}
                </Text>
                {item.modifiers && item.modifiers.length > 0 && (
                  <Text style={[styles.itemMods, { color: colors.textMuted }]}>
                    {item.modifiers.map(m => m.name).join(', ')}
                  </Text>
                )}
                {item.notes && (
                  <Text style={[styles.itemNotes, { color: colors.textSecondary }]}>
                    "{item.notes}"
                  </Text>
                )}
              </View>
              <View style={styles.itemPricing}>
                <Text style={[styles.itemQty, { color: colors.textMuted }]}>x{item.quantity}</Text>
                <Text style={[styles.itemPrice, { color: colors.text }]}>
                  {formatPrice((item.price || 0) * (item.quantity || 1))}
                </Text>
              </View>
            </View>
          ))}
        </View>

        {/* Totals */}
        <View style={[styles.totalsSection, { borderTopColor: colors.border }]}>
          <View style={styles.totalRow}>
            <Text style={[styles.totalLabel, { color: colors.textMuted }]}>Subtotal</Text>
            <Text style={[styles.totalValue, { color: colors.text }]}>{formatPrice(order.subtotal || 0)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={[styles.totalLabel, { color: colors.textMuted }]}>Tax</Text>
            <Text style={[styles.totalValue, { color: colors.text }]}>{formatPrice(order.tax || 0)}</Text>
          </View>
          <View style={[styles.totalRow, styles.grandTotal]}>
            <Text style={[styles.grandTotalLabel, { color: colors.text }]}>Total</Text>
            <Text style={styles.grandTotalValue}>{formatPrice(order.total || order.total_amount || 0)}</Text>
          </View>
        </View>

        {/* Order Notes */}
        {order.notes && stripTwilioLogs(order.notes) !== '' && (
          <View style={[styles.notesSection, { backgroundColor: colors.border }]}>
            <Text style={[styles.notesTitle, { color: colors.text }]}>Order Notes</Text>
            <Text style={[styles.notesText, { color: colors.textSecondary }]}>{stripTwilioLogs(order.notes)}</Text>
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  // Collapsed card styles
  card: {
    marginHorizontal: 8,
    marginVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderLeftWidth: 4,
  },
  collapsedContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  collapsedLeft: {
    flex: 1,
    marginRight: 12,
  },
  collapsedRight: {
    alignItems: 'flex-end',
  },
  collapsedName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  collapsedType: {
    fontSize: 13,
  },
  collapsedTime: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 2,
  },
  collapsedOrder: {
    fontSize: 14,
    fontWeight: '700',
  },

  // Expanded card styles
  expandedCard: {
    marginHorizontal: 8,
    marginVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'visible',
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },
  headerTouchable: {
    // Wrapper to make entire header tappable
  },
  expandedHeader: {
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerLeft: {
    flex: 1,
    marginRight: 16,
  },
  headerName: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  headerBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  headerMeta: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.8)',
  },
  headerActionBtn: {
    backgroundColor: '#60a5fa',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
  },
  headerActionText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  headerActionGroup: {
    flexDirection: 'row',
    gap: 8,
  },
  headerActionBtnSmall: {
    backgroundColor: '#60a5fa',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
  },
  headerActionBtnDispatch: {
    backgroundColor: '#10b981',
  },
  headerActionTextSmall: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  headerBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 5,
  },
  headerBadgeText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '600',
  },

  // Compact header styles for 4-column view
  expandedHeaderCompact: {
    paddingVertical: 12,
    paddingHorizontal: 10,
    minHeight: 80,
  },
  headerCompactContent: {
    width: '100%',
  },
  headerCompactRow1: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  headerCompactBtnGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerCompactNameArea: {
    flex: 1,
    marginRight: 8,
  },
  headerCompactMeta: {
    flex: 1,
  },
  headerNameCompact: {
    fontSize: 13,
    fontWeight: '700',
    color: '#ffffff',
  },
  headerActionBtnCompact: {
    backgroundColor: '#60a5fa',
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerActionTextCompact: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  headerMetaCompact: {
    fontSize: 11,
    color: '#ffffff',
    marginBottom: 6,
    opacity: 0.9,
  },
  headerBadgeRowCompact: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  headerBadgeCompact: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  headerBadgeTextCompact: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '600',
  },

  // Body styles
  expandedBody: {
    padding: 16,
  },
  detailsSection: {
    marginBottom: 16,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  detailRowColumn: {
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
  addressBlock: {
    marginTop: 4,
  },
  addressText: {
    fontSize: 14,
    lineHeight: 20,
  },
  deliveryNotes: {
    fontSize: 13,
    marginTop: 4,
    fontStyle: 'italic',
  },

  // Items section
  itemsSection: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 12,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  itemIcon: {
    width: 42,
    height: 42,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  itemInitials: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  itemDetails: {
    flex: 1,
    marginRight: 12,
  },
  itemName: {
    fontSize: 15,
    fontWeight: '500',
  },
  itemMods: {
    fontSize: 13,
    marginTop: 2,
  },
  itemNotes: {
    fontSize: 13,
    marginTop: 4,
    fontStyle: 'italic',
  },
  itemPricing: {
    alignItems: 'flex-end',
  },
  itemQty: {
    fontSize: 13,
    marginBottom: 2,
  },
  itemPrice: {
    fontSize: 15,
    fontWeight: '600',
  },

  // Totals
  totalsSection: {
    paddingTop: 12,
    borderTopWidth: 1,
    marginBottom: 16,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  totalLabel: {
    fontSize: 14,
  },
  totalValue: {
    fontSize: 14,
  },
  grandTotal: {
    marginTop: 8,
    paddingTop: 8,
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

  // Notes
  notesSection: {
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  notesTitle: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 4,
  },
  notesText: {
    fontSize: 14,
    lineHeight: 20,
  },


});

export default ExpandableOrderCard;
