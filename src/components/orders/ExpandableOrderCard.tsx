import React, { useRef, useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Vibration,
  Animated,
  TouchableOpacity,
  ScrollView,
  LayoutAnimation,
  Platform,
  UIManager,
  Linking,
  ActivityIndicator,
  Alert,
  useWindowDimensions,
} from 'react-native';
import {
  PanGestureHandler,
  PanGestureHandlerGestureEvent,
  PanGestureHandlerStateChangeEvent,
  TapGestureHandler,
  TapGestureHandlerStateChangeEvent,
  State,
} from 'react-native-gesture-handler';
import { LinearGradient } from 'expo-linear-gradient';
import { Order } from '../../types';
import { apiClient } from '../../api/client';
import { useStore } from '../../store/useStore';

const BRAND_PURPLE = '#7c3aed';
const HEADER_ACTION_BORDER = '#c4b5fd';
const COMPLETE_CARD_RED = '#8B1E2D';
const COMPLETE_CARD_RED_DARK = '#5E1220';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface ExpandableOrderCardProps {
  order: Order;
  column: 'new' | 'active' | 'ready' | 'complete';
  isExpanded: boolean;
  onDragEnd: (orderId: string, translationX: number) => void;
  onDragStart?: () => void;
  onDragRelease?: () => void;
  onTap: (orderId: string) => void;
  onStatusChange: (orderId: string, targetStatus: string) => void;
  onAccept?: (orderId: string) => void;
  onPrint?: (order: Order) => void;
  containerWidth: number;
  containerHeight?: number;
  onScrollLock?: () => void;
  onScrollUnlock?: () => void;
  simultaneousHandlers?: any;
}

const stripTwilioLogs = (notes: string): string => {
  if (!notes) return '';
  const cleaned = notes
    .split('\n')
    .filter(line => !line.includes('TWILIO_FALLBACK_CALL'))
    .join('\n')
    .replace(/\|\s*\|/g, '|')
    .replace(/^\s*\|\s*/gm, '')
    .replace(/\s*\|\s*$/gm, '')
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

const getOrderAgeMinutes = (createdAt: string): number => {
  const created = new Date(createdAt);
  const now = new Date();
  return Math.floor((now.getTime() - created.getTime()) / (1000 * 60));
};

const getAgingAccent = (ageMinutes: number, yellowMin: number, redMin: number): string | null => {
  if (ageMinutes >= redMin) return '#ef4444';
  if (ageMinutes >= yellowMin) return '#eab308';
  return null;
};

const formatPrice = (price: number): string => {
  return `$${(price || 0).toFixed(2)}`;
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
  onAccept,
  onPrint,
  containerWidth,
  containerHeight,
  onScrollLock,
  onScrollUnlock,
  simultaneousHandlers,
}) => {
  const orderAgingEnabled = useStore((state) => state.settings.orderAgingEnabled);
  const orderAgingYellowMin = useStore((state) => state.settings.orderAgingYellowMin);
  const orderAgingRedMin = useStore((state) => state.settings.orderAgingRedMin);
  const viewMode = useStore((state) => state.settings.viewMode ?? 'three');
  const printerConnected = useStore((state) => state.settings.printerConnected ?? false);
  const showPricesInExpanded = useStore((state) => state.settings.showPricesInExpanded ?? true);
  const autoShowPricesWhenNoPrinter = useStore((state) => state.settings.autoShowPricesWhenNoPrinter ?? true);
  const isTwoColView = viewMode === 'two';
  const { height: windowHeight } = useWindowDimensions();
  const showPricesEffective = showPricesInExpanded || (autoShowPricesWhenNoPrinter && !printerConnected);

  const nextAction = (() => {
    if (column === 'complete') return 'reopen';
    if (viewMode === 'two') return 'complete';
    if (viewMode === 'three') return column === 'new' ? 'accept' : 'complete';
    if (viewMode === 'four') {
      if (column === 'new') return 'accept';
      if (column === 'active') return 'ready';
      if (column === 'ready') return 'complete';
    }
    return 'complete';
  })();

  const nextStatus = (() => {
    switch (order.status) {
      case 'pending': return 'confirmed';
      case 'confirmed': return 'preparing';
      case 'preparing': return 'ready';
      case 'ready': return 'completed';
      case 'completed': return 'preparing'; // reopen
      default: return '';
    }
  })();

  const nextActionLabel = (() => {
    switch (nextAction) {
      case 'accept': return 'Accept';
      case 'ready': return 'Ready';
      case 'complete': return 'Complete';
      case 'reopen': return 'Reopen';
      default: return 'Complete';
    }
  })();

  const pan = useRef(new Animated.ValueXY()).current;
  const scale = useRef(new Animated.Value(1)).current;
  const zIndex = useRef(new Animated.Value(2)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const isDragging = useRef(false);
  const startTime = useRef(0);
  const panRef = useRef<PanGestureHandler | null>(null);
  const tapRef = useRef<TapGestureHandler | null>(null);
  const ignoreTapRef = useRef(false);

  const onDragEndRef = useRef(onDragEnd);
  const onDragStartRef = useRef(onDragStart);
  const onDragReleaseRef = useRef(onDragRelease);
  const onTapRef = useRef(onTap);
  const onScrollLockRef = useRef(onScrollLock);
  const onScrollUnlockRef = useRef(onScrollUnlock);
  const containerWidthRef = useRef(containerWidth);
  const orderIdRef = useRef(order.id);

  onDragEndRef.current = onDragEnd;
  onDragStartRef.current = onDragStart;
  onDragReleaseRef.current = onDragRelease;
  onTapRef.current = onTap;
  onScrollLockRef.current = onScrollLock;
  onScrollUnlockRef.current = onScrollUnlock;
  containerWidthRef.current = containerWidth;
  orderIdRef.current = order.id;

  const customerName = order.customer?.name || 'Walk-in';
  const customerPhone = order.customer?.phone;
  const orderType = order.order_type || 'pickup';
  const canChangeStatus = order.status !== 'cancelled';
  const items = order.items || [];
  const showAcceptButton =
    nextAction === 'accept' && order.status === 'pending' && !order.acknowledged_at;
  const isCompleteColumn = column === 'complete';
  const agingYellowMin = Math.max(1, orderAgingYellowMin ?? 5);
  const agingRedMin = Math.max(agingYellowMin + 1, orderAgingRedMin ?? 10);
  const isAgingEligible =
    order.status !== 'completed' && order.status !== 'cancelled';
  const orderAgeMinutes = getOrderAgeMinutes(order.created_at);
  const agingAccent =
    orderAgingEnabled && isAgingEligible
      ? getAgingAccent(orderAgeMinutes, agingYellowMin, agingRedMin)
      : null;

  const [dispatchInfo, setDispatchInfo] = useState<{
    dispatch_available: boolean;
    provider: { code: string; name: string; external_id: string } | null;
  } | null>(null);
  const [dispatchingDriver, setDispatchingDriver] = useState(false);
  const [driverDispatched, setDriverDispatched] = useState(false);
  const [showCompleteOptions, setShowCompleteOptions] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(0);

  useEffect(() => {
    const checkDispatch = async () => {
      setDispatchInfo(null);
      setDriverDispatched(false);
      if (!order || order.order_type !== 'delivery') return;
      const validStatuses = ['confirmed', 'preparing', 'ready'];
      if (!validStatuses.includes(order.status)) return;
      try {
        const response = await apiClient.checkDispatchAvailable(order.id);
        if (response.success && response.data) {
          setDispatchInfo(response.data);
        }
      } catch (error) {
        console.log('[Dispatch] Check failed:', error);
      }
    };
    if (isExpanded) checkDispatch();
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

  useEffect(() => {
    opacity.setValue(1);
    pan.setValue({ x: 0, y: 0 });
    setShowCompleteOptions(false);
    setShowDetails(false);
  }, [order.id, column]);

  useEffect(() => {
    if (!isExpanded) setShowCompleteOptions(false);
  }, [isExpanded]);

  useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  }, [isExpanded]);

  useEffect(() => {
    if (isExpanded) {
      onScrollLockRef.current?.();
    } else {
      onScrollUnlockRef.current?.();
    }
    return () => { onScrollUnlockRef.current?.(); };
  }, [isExpanded]);

  const colors = {
    cardBg: '#ffffff',
    headerBg: '#293A4A',
    headerText: '#ffffff',
    contentBg: '#ffffff',
    text: '#1e293b',
    textSecondary: '#64748b',
    textMuted: '#94a3b8',
    border: '#e2e8f0',
    borderExpanded: '#cbd5e1',
    newAccent: '#22c55e',
    activeAccent: BRAND_PURPLE,
    readyAccent: '#22c55e',
    completeAccent: COMPLETE_CARD_RED,
    link: BRAND_PURPLE,
    badgeBg: 'rgba(255,255,255,0.15)',
    itemBg: '#293A4A',
    actionBg: column === 'new' ? '#22c55e' : BRAND_PURPLE,
  };

  const cardBackground = colors.cardBg;
  const contentBackground = colors.contentBg;
  const borderColor = isExpanded ? colors.borderExpanded : colors.border;
  const baseAccentColor = column === 'complete' ? colors.completeAccent : colors.newAccent;
  const accentColor = agingAccent ?? baseAccentColor;

  const resetVisuals = () => {
    Animated.spring(scale, { toValue: 1, useNativeDriver: false }).start();
    opacity.setValue(1);
    zIndex.setValue(2);
  };

  const handlePanGestureEvent = (event: PanGestureHandlerGestureEvent) => {
    if (!canChangeStatus) return;
    const { translationX, translationY } = event.nativeEvent;
    if (!isDragging.current && Math.abs(translationX) > 15 && Math.abs(translationX) > Math.abs(translationY)) {
      isDragging.current = true;
      zIndex.setValue(20);
      opacity.setValue(0.92);
      Vibration.vibrate(50);
      Animated.spring(scale, { toValue: 1.08, useNativeDriver: false }).start();
      onDragStartRef.current?.();
      onScrollLockRef.current?.();
    }
    if (isDragging.current) {
      pan.setValue({ x: translationX, y: 0 });
    }
  };

  const handlePanStateChange = (event: PanGestureHandlerStateChangeEvent) => {
    if (!canChangeStatus) return;
    const { state, translationX } = event.nativeEvent;
    if (state === State.BEGAN) {
      startTime.current = Date.now();
      isDragging.current = false;
      return;
    }
    if (state === State.END) {
      resetVisuals();
      onScrollUnlockRef.current?.();
      if (isDragging.current) {
        onDragReleaseRef.current?.();
        isDragging.current = false;
        const threshold = Math.min(containerWidthRef.current * 0.25, 80);
        if (Math.abs(translationX) > threshold) {
          Vibration.vibrate(100);
          pan.setValue({ x: 0, y: 0 });
          onDragEndRef.current(orderIdRef.current, translationX);
        } else {
          Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
        }
      } else {
        Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
        isDragging.current = false;
      }
      return;
    }
    if (state === State.CANCELLED || state === State.FAILED) {
      resetVisuals();
      onScrollUnlockRef.current?.();
      if (isDragging.current) onDragReleaseRef.current?.();
      isDragging.current = false;
      Animated.parallel([
        Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: false }),
        Animated.spring(scale, { toValue: 1, useNativeDriver: false }),
      ]).start();
    }
  };

  const handleTapStateChange = (event: TapGestureHandlerStateChangeEvent) => {
    if (event.nativeEvent.state === State.END) {
      if (ignoreTapRef.current) return;
      onTapRef.current(orderIdRef.current);
    }
  };

  const handlePhonePress = () => {
    if (customerPhone) {
      const cleanPhone = customerPhone.replace(/[^\d+]/g, '');
      Linking.openURL(`tel:${cleanPhone}`);
    }
  };

  const handleAcceptPress = () => {
    if (!canChangeStatus) return;
    onAccept?.(order.id);
  };

  const handleAdvancePress = () => {
    if (!canChangeStatus) return;
    if (column === 'new') {
      onAccept?.(order.id);
    }
    const shouldShowDispatchOptions =
      nextAction === 'complete' &&
      orderType === 'delivery' &&
      dispatchInfo?.dispatch_available &&
      !driverDispatched;
    if (shouldShowDispatchOptions) {
      setShowCompleteOptions(!showCompleteOptions);
      return;
    }
    onStatusChange(order.id, nextStatus);
  };

  const handleCompleteOnly = () => {
    if (!canChangeStatus) return;
    setShowCompleteOptions(false);
    if (column === 'new') onAccept?.(order.id);
    onStatusChange(order.id, nextStatus);
  };

  const handleCompleteAndDispatch = async () => {
    if (!canChangeStatus) return;
    setShowCompleteOptions(false);
    setDispatchingDriver(true);
    if (column === 'new') onAccept?.(order.id);
    onStatusChange(order.id, nextStatus);
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

  // ── COLLAPSED CARD ──
  if (!isExpanded) {
    const collapsedBg = isCompleteColumn ? COMPLETE_CARD_RED : cardBackground;
    const collapsedTextColor = isCompleteColumn ? '#ffffff' : colors.text;
    const collapsedSecondaryColor = isCompleteColumn ? 'rgba(255,255,255,0.8)' : colors.textSecondary;
    const collapsedMutedColor = isCompleteColumn ? 'rgba(255,255,255,0.9)' : colors.textMuted;
    const itemCount = (order.items || []).reduce((sum, item) => sum + (item.quantity || 1), 0);
    const primaryItemName = order.items && order.items.length > 0 ? order.items[0].name : '';
    const collapsedSummary =
      itemCount > 0
        ? `${itemCount} item${itemCount !== 1 ? 's' : ''} • ${primaryItemName}`
        : getOrderTypeLabel(orderType);
    
    return (
      <TapGestureHandler
        ref={tapRef}
        onHandlerStateChange={handleTapStateChange}
        waitFor={panRef}
        simultaneousHandlers={simultaneousHandlers}
        maxDeltaX={10}
        maxDeltaY={10}
      >
        <PanGestureHandler
          ref={panRef}
          onGestureEvent={handlePanGestureEvent}
          onHandlerStateChange={handlePanStateChange}
          enabled={canChangeStatus}
          activeOffsetX={[-10, 10]}
          failOffsetY={[-10, 10]}
          simultaneousHandlers={simultaneousHandlers}
        >
          <Animated.View
            renderToHardwareTextureAndroid
            style={[
              styles.card,
              {
                backgroundColor: collapsedBg,
                borderColor: isCompleteColumn ? COMPLETE_CARD_RED : borderColor,
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
            testID="order-card-collapsed"
            nativeID="order-card-collapsed"
          >
            <View style={styles.collapsedContent}>
              <View style={styles.collapsedLeft}>
                <Text style={[styles.collapsedName, { color: collapsedTextColor }]} numberOfLines={1}>
                  {customerName}
                </Text>
                <Text style={[styles.collapsedType, { color: collapsedSecondaryColor }]} numberOfLines={1}>
                  {collapsedSummary}
                </Text>
              </View>
              <View style={styles.collapsedRight}>
                <View style={styles.collapsedMeta}>
                  <Text style={[styles.collapsedTime, { color: collapsedMutedColor }]}>
                    {formatTime(order.created_at)}
                  </Text>
                  <Text style={[styles.collapsedOrder, { color: collapsedMutedColor }]}>
                    #{getShortOrderNumber(order.order_number)}
                  </Text>
                </View>
                {showAcceptButton && (
                  <TouchableOpacity
                    style={styles.acceptButton}
                    onPress={() => handleAcceptPress()}
                    onPressIn={() => { ignoreTapRef.current = true; }}
                    onPressOut={() => { ignoreTapRef.current = false; }}
                    activeOpacity={0.85}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    testID="order-accept-button"
                    nativeID="order-accept-button"
                  >
                    <Text style={styles.acceptButtonText}>Accept</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </Animated.View>
        </PanGestureHandler>
      </TapGestureHandler>
    );
  }

  // ── EXPANDED CARD ──
  const isNarrow = containerWidth < 300;
  const fallbackMaxHeight = Math.max(320, windowHeight - 120);
  const resolvedMaxHeight =
    containerHeight && containerHeight > 200
      ? Math.max(240, containerHeight - 8)
      : fallbackMaxHeight;
  const expandedMaxHeight = resolvedMaxHeight;
  const bodyMaxHeight = Math.max(200, expandedMaxHeight - Math.max(headerHeight, 80));

  return (
    <View 
      style={[
        styles.expandedCard, 
        { 
          backgroundColor: contentBackground,
          borderColor: colors.borderExpanded,
          maxHeight: expandedMaxHeight,
        }
      ]}
      testID="order-card-expanded"
      nativeID="order-card-expanded"
    >
      {/* Header */}
      <TouchableOpacity 
        activeOpacity={0.9} 
        onPress={() => onTap(order.id)}
        style={styles.headerTouchable}
        testID="order-card-header"
        nativeID="order-card-header"
      >
        <LinearGradient
          colors={isCompleteColumn ? [COMPLETE_CARD_RED, COMPLETE_CARD_RED_DARK] : ['#DC2626', '#B91C1C']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          onLayout={(event) => {
            const h = event.nativeEvent.layout.height;
            if (h && h !== headerHeight) setHeaderHeight(h);
          }}
          style={isNarrow ? styles.expandedHeaderCompact : styles.expandedHeader}
        >
          {isNarrow ? (
            <View style={styles.headerCompactContent}>
              <View style={styles.headerCompactRow1}>
                <Text style={[styles.headerNameCompact, { color: colors.headerText }]} numberOfLines={1}>
                  {customerName}
                </Text>
                {!canChangeStatus ? null : nextAction === 'complete' && orderType === 'delivery' && dispatchInfo?.dispatch_available && !driverDispatched ? (
                  <View style={styles.headerCompactBtnGroup}>
                    <TouchableOpacity 
                      style={styles.headerActionBtnCompact}
                      onPress={(e) => { e.stopPropagation(); if (column === 'new') onAccept?.(order.id); onStatusChange(order.id, nextStatus); }}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.headerActionTextCompact}>→</Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={[styles.headerActionBtnCompact, { backgroundColor: '#10b981', marginLeft: 4 }]}
                      onPress={(e) => { e.stopPropagation(); handleCompleteAndDispatch(); }}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.headerActionTextCompact}>🚗</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity 
                    style={styles.headerActionBtnCompact}
                    onPress={(e) => { e.stopPropagation(); if (showAcceptButton) handleAcceptPress(); else handleAdvancePress(); }}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.headerActionTextCompact}>
                      {column === 'complete' ? '←' : '→'}
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
                  <View style={[styles.headerBadge, { backgroundColor: order.payment_status === 'paid' ? 'rgba(0,0,0,0.15)' : 'rgba(251,191,36,0.4)' }]}>
                    <Text style={styles.headerBadgeText}>{order.payment_status === 'paid' ? 'Paid' : 'Payment Due'}</Text>
                  </View>
                  <View style={[styles.headerBadge, { backgroundColor: 'rgba(0,0,0,0.15)' }]}>
                    <Text style={styles.headerBadgeText}>{getOrderTypeLabel(orderType)}</Text>
                  </View>
                </View>
              </View>
              {!canChangeStatus ? null : showCompleteOptions ? (
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
                  testID="order-accept-button"
                  nativeID="order-accept-button"
                  onPress={(e) => { 
                    e.stopPropagation();
                    if (showAcceptButton) handleAcceptPress();
                    else handleAdvancePress();
                  }}
                >
                  <Text style={styles.headerActionText}>{nextActionLabel}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </LinearGradient>
      </TouchableOpacity>

      {/* Body - Items first, details collapsible at bottom */}
      <ScrollView
        style={[
          styles.expandedBodyScroll,
          { backgroundColor: contentBackground },
          bodyMaxHeight ? { height: bodyMaxHeight, maxHeight: bodyMaxHeight } : null,
        ]}
        contentContainerStyle={styles.expandedBodyContent}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
      >
        {/* Items Section */}
        <View style={styles.itemsSection}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Items ({items.length})
          </Text>

          {items.map((item, index) => {
            const modifiers = item.modifiers || [];
            const hasModifiers = modifiers.length > 0;
            const hasInstanceIndex = modifiers.some(m => m.instance_index != null);

            const instanceGroups: Array<{ instanceLabel: string; instanceMods: typeof modifiers }> | null =
              hasInstanceIndex
                ? (() => {
                    const byInstance: Record<number, typeof modifiers> = {};
                    modifiers.forEach(m => {
                      const key = m.instance_index ?? 0;
                      if (!byInstance[key]) byInstance[key] = [];
                      byInstance[key].push(m);
                    });
                    return Object.keys(byInstance)
                      .map(Number)
                      .sort()
                      .map(idx => ({ instanceLabel: `Pizza ${idx + 1}`, instanceMods: byInstance[idx] }));
                  })()
                : null;

            const groupedModifiers =
              showPricesEffective && !hasInstanceIndex
                ? modifiers.reduce<Record<string, typeof modifiers>>((acc, mod) => {
                    const group = mod.group_name || '';
                    if (!acc[group]) acc[group] = [];
                    acc[group].push(mod);
                    return acc;
                  }, {})
                : null;

            return (
            <View key={index} style={[styles.itemRow, { borderBottomColor: colors.border }]}>
              <View style={styles.itemDetails}>
                <View style={styles.itemHeaderRow}>
                  <Text style={[styles.itemName, { color: colors.text }]}>
                    <Text style={styles.itemQtyInline}>x{item.quantity} </Text>
                    {item.name}
                  </Text>
                  {showPricesEffective && (
                    <Text style={[styles.itemPrice, { color: colors.text }]}>
                      {formatPrice((item.price || 0) * (item.quantity || 1))}
                    </Text>
                  )}
                </View>
                {/* Per-instance display (2-for-1 pizzas etc.) */}
                {hasModifiers && hasInstanceIndex && instanceGroups && (
                  <View style={styles.modifierGroups}>
                    {instanceGroups.map(({ instanceLabel, instanceMods }) => (
                      <View key={instanceLabel} style={styles.modifierGroup}>
                        <Text style={[styles.modifierGroupLabel, { color: colors.textMuted }]}>
                          {instanceLabel.toUpperCase()}
                        </Text>
                        {instanceMods.map((mod, modIndex) => (
                          <View key={`${mod.id ?? modIndex}-${modIndex}`} style={styles.modifierRow}>
                            <Text style={[styles.modifierName, { color: colors.textSecondary }]}>
                              {mod.quantity && mod.quantity > 1 ? `${mod.quantity}x ` : ''}
                              {mod.name}
                            </Text>
                            {showPricesEffective && (
                              <Text style={[styles.modifierPrice, { color: colors.textMuted }]}>
                                {formatPrice((mod.price || 0) * (mod.quantity || 1))}
                              </Text>
                            )}
                          </View>
                        ))}
                      </View>
                    ))}
                  </View>
                )}
                {/* Flat modifier list (no instance_index, no prices) */}
                {hasModifiers && !hasInstanceIndex && !showPricesEffective && (
                  <View style={styles.itemModsList}>
                    {modifiers.map((mod, modIndex) => (
                      <Text
                        key={`${mod.id ?? modIndex}-${modIndex}`}
                        style={[styles.itemModLine, { color: colors.textSecondary }]}
                      >
                        {'\u2022 '}
                        {mod.group_name ? `${mod.group_name}: ` : ''}
                        {mod.quantity && mod.quantity > 1 ? `${mod.quantity}x ` : ''}
                        {mod.name}
                      </Text>
                    ))}
                  </View>
                )}
                {/* Grouped by group_name with prices */}
                {hasModifiers && !hasInstanceIndex && showPricesEffective && groupedModifiers && (
                  <View style={styles.modifierGroups}>
                    {Object.entries(groupedModifiers).map(([groupName, groupMods]) => (
                      <View key={groupName || 'modifiers'} style={styles.modifierGroup}>
                        {groupName ? (
                          <Text style={[styles.modifierGroupLabel, { color: colors.textMuted }]}>
                            {groupName.toUpperCase()}
                          </Text>
                        ) : null}
                        {groupMods.map((mod, modIndex) => (
                          <View key={`${mod.id ?? modIndex}-${modIndex}`} style={styles.modifierRow}>
                            <Text style={[styles.modifierName, { color: colors.textSecondary }]}>
                              {mod.quantity && mod.quantity > 1 ? `${mod.quantity}x ` : ''}
                              {mod.name}
                            </Text>
                            <Text style={[styles.modifierPrice, { color: colors.textMuted }]}>
                              {formatPrice((mod.price || 0) * (mod.quantity || 1))}
                            </Text>
                          </View>
                        ))}
                      </View>
                    ))}
                  </View>
                )}
                {item.notes && (
                  <Text style={[styles.itemNotes, { color: colors.textSecondary }]}>
                    "{item.notes}"
                  </Text>
                )}
              </View>
            </View>
          );
          })}
        </View>

        {/* Totals */}
        {showPricesEffective && (
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
              <Text style={styles.grandTotalValue}>{formatPrice(order.total || 0)}</Text>
            </View>
          </View>
        )}

        {/* Order Notes */}
        {order.notes && stripTwilioLogs(order.notes) !== '' && (
          <View style={[styles.notesSection, { backgroundColor: colors.border }]}>
            <Text style={[styles.notesTitle, { color: colors.text }]}>Order Notes</Text>
            <Text style={[styles.notesText, { color: colors.textSecondary }]}>{stripTwilioLogs(order.notes)}</Text>
          </View>
        )}

        {/* Collapsible Details Toggle */}
        <TouchableOpacity
          style={[styles.detailsToggle, { borderColor: colors.border, backgroundColor: '#f8fafc' }]}
          onPress={() => setShowDetails((prev) => !prev)}
          activeOpacity={0.8}
        >
          <Text style={[styles.detailsToggleLabel, { color: colors.text }]}>
            {showDetails ? 'Hide details' : 'Show details'}
          </Text>
          <Text style={[styles.detailsToggleChevron, { color: colors.textMuted }]}>
            {showDetails ? '▴' : '▾'}
          </Text>
        </TouchableOpacity>

        {showDetails && (
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
            {orderType === 'delivery' && order.delivery_address && (
              <View style={[styles.detailRowColumn, { borderBottomColor: colors.border }]}>
                <Text style={[styles.detailLabel, { color: colors.textMuted }]}>Delivery Address</Text>
                <View style={styles.addressBlock}>
                  {order.delivery_address.street && (
                    <Text style={[styles.addressText, { color: colors.text }]}>{order.delivery_address.street}</Text>
                  )}
                  {(order.delivery_address.city || order.delivery_address.province || order.delivery_address.postal_code || order.delivery_address.postalCode) && (
                    <Text style={[styles.addressText, { color: colors.text }]}>
                      {[order.delivery_address.city, order.delivery_address.province, order.delivery_address.postal_code || order.delivery_address.postalCode].filter(Boolean).join(', ')}
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
        )}

        {/* Footer Actions */}
        {printerConnected && onPrint && (
          <View style={styles.footerActions}>
            <TouchableOpacity
              style={styles.reprintButton}
              onPress={() => onPrint(order)}
              activeOpacity={0.8}
              testID="order-reprint-button"
              nativeID="order-reprint-button"
            >
              <Text style={styles.reprintButtonText}>Reprint</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 8,
    marginVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
    borderLeftWidth: 4,
  },
  collapsedContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 11,
  },
  collapsedLeft: { flex: 1, marginRight: 12 },
  collapsedRight: { flexDirection: 'row', alignItems: 'center', flexShrink: 0 },
  collapsedMeta: { alignItems: 'flex-end', marginRight: 8 },
  collapsedName: { fontSize: 15, fontWeight: '600', marginBottom: 2 },
  collapsedType: { fontSize: 12 },
  collapsedTime: { fontSize: 14, fontWeight: '700', marginBottom: 1 },
  collapsedOrder: { fontSize: 13, fontWeight: '700' },
  acceptButton: {
    backgroundColor: BRAND_PURPLE,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  acceptButtonText: { color: '#ffffff', fontSize: 12, fontWeight: '700' },

  expandedCard: {
    marginHorizontal: 8,
    marginVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },
  headerTouchable: {},
  expandedHeader: { paddingVertical: 10, paddingHorizontal: 12 },
  headerContent: { flexDirection: 'row', alignItems: 'center' },
  headerLeft: { flex: 1, marginRight: 12 },
  headerName: { fontSize: 17, fontWeight: '700', marginBottom: 4 },
  headerBadgeRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  headerMeta: { fontSize: 12, color: 'rgba(255,255,255,0.8)' },
  headerActionBtn: {
    backgroundColor: BRAND_PURPLE,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: HEADER_ACTION_BORDER,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.22,
    shadowRadius: 2,
    elevation: 2,
  },
  headerActionText: { color: '#ffffff', fontSize: 13, fontWeight: '600' },
  headerActionGroup: { flexDirection: 'row', gap: 8 },
  headerActionBtnSmall: {
    backgroundColor: BRAND_PURPLE,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: HEADER_ACTION_BORDER,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.22,
    shadowRadius: 2,
    elevation: 2,
  },
  headerActionBtnDispatch: { backgroundColor: '#10b981' },
  headerActionTextSmall: { color: '#ffffff', fontSize: 12, fontWeight: '600' },
  headerBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 5 },
  headerBadgeText: { color: '#ffffff', fontSize: 11, fontWeight: '600' },

  expandedHeaderCompact: { paddingVertical: 8, paddingHorizontal: 8, minHeight: 68 },
  headerCompactContent: { width: '100%' },
  headerCompactRow1: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  headerCompactBtnGroup: { flexDirection: 'row', alignItems: 'center' },
  headerNameCompact: { fontSize: 13, fontWeight: '700', color: '#ffffff' },
  headerActionBtnCompact: {
    backgroundColor: BRAND_PURPLE,
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: HEADER_ACTION_BORDER,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.22,
    shadowRadius: 2,
    elevation: 2,
  },
  headerActionTextCompact: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
  headerMetaCompact: { fontSize: 11, color: '#ffffff', marginBottom: 4, opacity: 0.9 },
  headerBadgeRowCompact: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  headerBadgeCompact: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  headerBadgeTextCompact: { color: '#ffffff', fontSize: 9, fontWeight: '600' },

  expandedBodyScroll: { minHeight: 120 },
  expandedBodyContent: { padding: 10, paddingTop: 8 },
  detailsSection: { marginBottom: 16, marginTop: 8 },
  detailsToggle: {
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginBottom: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailsToggleLabel: { fontSize: 12, fontWeight: '600' },
  detailsToggleChevron: { fontSize: 13, fontWeight: '700' },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  detailRowColumn: { paddingVertical: 8, borderBottomWidth: 1 },
  detailLabel: { fontSize: 12 },
  detailValue: { fontSize: 12, fontWeight: '500' },
  addressBlock: { marginTop: 4 },
  addressText: { fontSize: 14, lineHeight: 20 },
  deliveryNotes: { fontSize: 13, marginTop: 4, fontStyle: 'italic' },

  itemsSection: { marginBottom: 8 },
  sectionTitle: { fontSize: 13, fontWeight: '600', marginBottom: 6 },
  itemRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 6, borderBottomWidth: 1 },
  itemHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  itemDetails: { flex: 1 },
  itemName: { fontSize: 13, fontWeight: '600', flex: 1 },
  itemQtyInline: { fontSize: 12, fontWeight: '600', color: BRAND_PURPLE },
  itemModsList: { marginTop: 2 },
  itemModLine: { fontSize: 11, lineHeight: 15, marginTop: 0 },
  modifierGroups: { marginTop: 3 },
  modifierGroup: { marginTop: 2 },
  modifierGroupLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginBottom: 1 },
  modifierRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 1 },
  modifierName: { flex: 1, fontSize: 12, marginRight: 6 },
  modifierPrice: { fontSize: 12, textAlign: 'right' },
  itemNotes: { fontSize: 12, marginTop: 2, fontStyle: 'italic' },
  itemPrice: { fontSize: 13, fontWeight: '600', marginLeft: 6 },

  totalsSection: { paddingTop: 8, borderTopWidth: 1, marginBottom: 8 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  totalLabel: { fontSize: 12 },
  totalValue: { fontSize: 12 },
  grandTotal: { marginTop: 4, paddingTop: 4 },
  grandTotalLabel: { fontSize: 14, fontWeight: '600' },
  grandTotalValue: { fontSize: 15, fontWeight: '700', color: '#22c55e' },

  notesSection: { padding: 8, borderRadius: 6, marginBottom: 8 },
  notesTitle: { fontSize: 12, fontWeight: '600', marginBottom: 2 },
  notesText: { fontSize: 12, lineHeight: 17 },
  footerActions: { marginTop: 8, flexDirection: 'row', justifyContent: 'flex-end' },
  reprintButton: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, backgroundColor: BRAND_PURPLE },
  reprintButtonText: { color: '#ffffff', fontSize: 13, fontWeight: '600' },
});

export default ExpandableOrderCard;
