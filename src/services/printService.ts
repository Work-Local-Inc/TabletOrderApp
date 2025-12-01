/**
 * Thermal Printer Service for ESC/POS Compatible Printers
 * Uses react-native-thermal-receipt-printer-image-qr for Bluetooth printing
 */

import { Order, OrderItem } from '../types';

// Import the printer library - install with:
// npm install react-native-thermal-receipt-printer-image-qr
let BLEPrinter: any = null;
let printerConnected = false;
let connectedPrinterAddress: string | null = null;

// Try to import the printer library (may not be installed yet)
try {
  const printerLib = require('react-native-thermal-receipt-printer-image-qr');
  BLEPrinter = printerLib.BLEPrinter;
  console.log('[PrintService] Bluetooth printer library loaded');
} catch (e) {
  console.warn('[PrintService] Printer library not installed. Run: npm install react-native-thermal-receipt-printer-image-qr');
}

// ESC/POS Commands
const ESC = '\x1B';
const GS = '\x1D';

const COMMANDS = {
  // Initialize printer
  INIT: `${ESC}@`,

  // Text alignment
  ALIGN_LEFT: `${ESC}a\x00`,
  ALIGN_CENTER: `${ESC}a\x01`,
  ALIGN_RIGHT: `${ESC}a\x02`,

  // Text size
  NORMAL_SIZE: `${GS}!\x00`,
  DOUBLE_HEIGHT: `${GS}!\x01`,
  DOUBLE_WIDTH: `${GS}!\x10`,
  DOUBLE_SIZE: `${GS}!\x11`,

  // Text style
  BOLD_ON: `${ESC}E\x01`,
  BOLD_OFF: `${ESC}E\x00`,
  UNDERLINE_ON: `${ESC}-\x01`,
  UNDERLINE_OFF: `${ESC}-\x00`,

  // Paper
  CUT_PAPER: `${GS}V\x00`,
  FEED_LINES: (n: number) => `${ESC}d${String.fromCharCode(n)}`,

  // Horizontal line (using dashes for 80mm paper, ~48 chars)
  LINE: '------------------------------------------------',
  DOUBLE_LINE: '================================================',
};

// Format currency
const formatCurrency = (amount: number): string => {
  return `$${amount.toFixed(2)}`;
};

// Right-pad string to fixed width
const padRight = (str: string, width: number): string => {
  return str.substring(0, width).padEnd(width);
};

// Left-pad string to fixed width
const padLeft = (str: string, width: number): string => {
  return str.substring(0, width).padStart(width);
};

// Format a line with left and right content
const formatLine = (left: string, right: string, totalWidth = 48): string => {
  const rightWidth = right.length;
  const leftWidth = totalWidth - rightWidth - 1;
  return `${padRight(left, leftWidth)} ${padLeft(right, rightWidth)}`;
};

// Format date/time
const formatDateTime = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

// Order type labels
const orderTypeLabels: Record<string, string> = {
  pickup: 'PICKUP',
  delivery: 'DELIVERY',
  dine_in: 'DINE IN',
};

/**
 * Generate ESC/POS formatted receipt data for an order
 */
export const generateReceiptData = (order: Order): string => {
  let receipt = '';

  // Initialize printer
  receipt += COMMANDS.INIT;

  // Header - Restaurant Name (if available)
  receipt += COMMANDS.ALIGN_CENTER;
  receipt += COMMANDS.DOUBLE_SIZE;
  receipt += COMMANDS.BOLD_ON;
  receipt += `ORDER #${order.order_number}\n`;
  receipt += COMMANDS.BOLD_OFF;
  receipt += COMMANDS.NORMAL_SIZE;
  receipt += '\n';

  // Order Type - Big and Bold
  receipt += COMMANDS.DOUBLE_HEIGHT;
  receipt += COMMANDS.BOLD_ON;
  receipt += `*** ${orderTypeLabels[order.order_type] || order.order_type.toUpperCase()} ***\n`;
  receipt += COMMANDS.BOLD_OFF;
  receipt += COMMANDS.NORMAL_SIZE;
  receipt += '\n';

  // Date/Time
  receipt += formatDateTime(order.created_at) + '\n';
  receipt += COMMANDS.DOUBLE_LINE + '\n';

  // Customer Info
  receipt += COMMANDS.ALIGN_LEFT;
  receipt += COMMANDS.BOLD_ON;
  receipt += 'CUSTOMER:\n';
  receipt += COMMANDS.BOLD_OFF;
  receipt += `${order.customer.name}\n`;
  receipt += `${order.customer.phone}\n`;

  // Delivery Address (if applicable)
  if (order.delivery_address) {
    receipt += '\n';
    receipt += COMMANDS.BOLD_ON;
    receipt += 'DELIVERY ADDRESS:\n';
    receipt += COMMANDS.BOLD_OFF;
    receipt += `${order.delivery_address.street}`;
    if (order.delivery_address.unit) {
      receipt += `, Unit ${order.delivery_address.unit}`;
    }
    receipt += '\n';
    receipt += `${order.delivery_address.city}, ${order.delivery_address.postalCode}\n`;
    if (order.delivery_address.instructions) {
      receipt += COMMANDS.BOLD_ON;
      receipt += 'INSTRUCTIONS: ';
      receipt += COMMANDS.BOLD_OFF;
      receipt += `${order.delivery_address.instructions}\n`;
    }
  }

  receipt += '\n' + COMMANDS.LINE + '\n';

  // Items Header
  receipt += COMMANDS.BOLD_ON;
  receipt += formatLine('ITEM', 'PRICE') + '\n';
  receipt += COMMANDS.BOLD_OFF;
  receipt += COMMANDS.LINE + '\n';

  // Order Items
  order.items.forEach((item) => {
    const itemTotal = item.price * item.quantity;

    // Item name with quantity
    receipt += COMMANDS.BOLD_ON;
    receipt += formatLine(
      `${item.quantity}x ${item.name}`,
      formatCurrency(itemTotal)
    ) + '\n';
    receipt += COMMANDS.BOLD_OFF;

    // Modifiers
    if (item.modifiers && item.modifiers.length > 0) {
      item.modifiers.forEach((mod) => {
        const modPrice = mod.price > 0 ? ` +${formatCurrency(mod.price)}` : '';
        receipt += `   - ${mod.name}${modPrice}\n`;
      });
    }

    // Item notes
    if (item.notes) {
      receipt += `   NOTE: ${item.notes}\n`;
    }
  });

  receipt += COMMANDS.LINE + '\n';

  // Totals
  receipt += formatLine('Subtotal:', formatCurrency(order.subtotal)) + '\n';
  receipt += formatLine('Tax:', formatCurrency(order.tax)) + '\n';

  if (order.tip && order.tip > 0) {
    receipt += formatLine('Tip:', formatCurrency(order.tip)) + '\n';
  }

  if (order.delivery_fee && order.delivery_fee > 0) {
    receipt += formatLine('Delivery Fee:', formatCurrency(order.delivery_fee)) + '\n';
  }

  receipt += COMMANDS.DOUBLE_LINE + '\n';

  // Grand Total
  receipt += COMMANDS.DOUBLE_SIZE;
  receipt += COMMANDS.BOLD_ON;
  receipt += formatLine('TOTAL:', formatCurrency(order.total)) + '\n';
  receipt += COMMANDS.BOLD_OFF;
  receipt += COMMANDS.NORMAL_SIZE;

  // Order Notes
  if (order.notes) {
    receipt += '\n' + COMMANDS.LINE + '\n';
    receipt += COMMANDS.BOLD_ON;
    receipt += 'ORDER NOTES:\n';
    receipt += COMMANDS.BOLD_OFF;
    receipt += order.notes + '\n';
  }

  // Estimated Ready Time
  if (order.estimated_ready_time) {
    receipt += '\n';
    receipt += COMMANDS.ALIGN_CENTER;
    receipt += COMMANDS.BOLD_ON;
    receipt += `Est. Ready: ${formatDateTime(order.estimated_ready_time)}\n`;
    receipt += COMMANDS.BOLD_OFF;
  }

  // Footer
  receipt += '\n';
  receipt += COMMANDS.ALIGN_CENTER;
  receipt += COMMANDS.LINE + '\n';
  receipt += 'Thank you for your order!\n';
  receipt += '\n\n\n';

  // Cut paper
  receipt += COMMANDS.CUT_PAPER;

  return receipt;
};

/**
 * Generate a simple test receipt
 */
export const generateTestReceipt = (): string => {
  let receipt = '';

  receipt += COMMANDS.INIT;
  receipt += COMMANDS.ALIGN_CENTER;
  receipt += COMMANDS.DOUBLE_SIZE;
  receipt += COMMANDS.BOLD_ON;
  receipt += 'PRINTER TEST\n';
  receipt += COMMANDS.BOLD_OFF;
  receipt += COMMANDS.NORMAL_SIZE;
  receipt += '\n';
  receipt += 'If you can read this,\n';
  receipt += 'your printer is working!\n';
  receipt += '\n';
  receipt += COMMANDS.LINE + '\n';
  receipt += '\n';
  receipt += 'Normal text\n';
  receipt += COMMANDS.BOLD_ON;
  receipt += 'Bold text\n';
  receipt += COMMANDS.BOLD_OFF;
  receipt += COMMANDS.DOUBLE_HEIGHT;
  receipt += 'Double height\n';
  receipt += COMMANDS.NORMAL_SIZE;
  receipt += COMMANDS.DOUBLE_WIDTH;
  receipt += 'Double width\n';
  receipt += COMMANDS.NORMAL_SIZE;
  receipt += '\n';
  receipt += COMMANDS.LINE + '\n';
  receipt += '\n';
  receipt += new Date().toLocaleString() + '\n';
  receipt += '\n\n\n';
  receipt += COMMANDS.CUT_PAPER;

  return receipt;
};

/**
 * Initialize the Bluetooth printer module
 */
export const initPrinter = async (): Promise<boolean> => {
  if (!BLEPrinter) {
    console.error('[PrintService] Printer library not available');
    return false;
  }
  
  try {
    await BLEPrinter.init();
    console.log('[PrintService] Printer initialized');
    return true;
  } catch (error) {
    console.error('[PrintService] Init failed:', error);
    return false;
  }
};

/**
 * Discover available Bluetooth printers
 */
export const discoverPrinters = async (): Promise<Array<{device_name: string, inner_mac_address: string}>> => {
  if (!BLEPrinter) {
    console.warn('[PrintService] Printer library not installed');
    return [];
  }

  try {
    console.log('[PrintService] Scanning for Bluetooth printers...');
    await BLEPrinter.init();
    const devices = await BLEPrinter.getDeviceList();
    console.log('[PrintService] Found devices:', devices);
    return devices || [];
  } catch (error) {
    console.error('[PrintService] Discovery failed:', error);
    return [];
  }
};

/**
 * Connect to a Bluetooth printer by MAC address
 */
export const connectPrinter = async (macAddress: string): Promise<boolean> => {
  if (!BLEPrinter) {
    console.error('[PrintService] Printer library not available');
    return false;
  }

  try {
    console.log(`[PrintService] Initializing printer module...`);
    // MUST init before connecting!
    await BLEPrinter.init();
    
    console.log(`[PrintService] Connecting to printer: ${macAddress}`);
    await BLEPrinter.connectPrinter(macAddress);
    printerConnected = true;
    connectedPrinterAddress = macAddress;
    console.log('[PrintService] Connected successfully!');
    return true;
  } catch (error) {
    console.error('[PrintService] Connection failed:', error);
    printerConnected = false;
    return false;
  }
};

/**
 * Disconnect from printer
 */
export const disconnectPrinter = async (): Promise<void> => {
  if (BLEPrinter && printerConnected) {
    try {
      await BLEPrinter.closeConn();
      printerConnected = false;
      connectedPrinterAddress = null;
      console.log('[PrintService] Disconnected');
    } catch (error) {
      console.error('[PrintService] Disconnect error:', error);
    }
  }
};

/**
 * Check if printer is connected
 */
export const isPrinterConnected = (): boolean => {
  return printerConnected;
};

/**
 * Print an order receipt
 */
export const printOrder = async (order: Order): Promise<boolean> => {
  const receiptText = generateReceiptText(order);

  // Always log for debugging
  console.log('[PrintService] Printing order:', order.order_number);

  if (!BLEPrinter || !printerConnected) {
    console.warn('[PrintService] No printer connected, logging receipt only:');
    console.log(receiptText);
    return false;
  }

  try {
    // Print using the library's text method
    await BLEPrinter.printText(receiptText, {
      encoding: 'UTF8',
      codepage: 0,
      widthtimes: 0,
      heigthtimes: 0,
      fonttype: 0,
    });
    
    // Cut paper
    await BLEPrinter.printText('\n\n\n');
    
    console.log('[PrintService] Print successful!');
    return true;
  } catch (error) {
    console.error('[PrintService] Print failed:', error);
    return false;
  }
};

/**
 * Generate receipt - plain text, wider format
 * Using 48 characters width for 80mm paper
 */
const PAPER_WIDTH = 48;

const centerText = (text: string, width: number = PAPER_WIDTH): string => {
  const trimmed = text.substring(0, width);
  const padding = Math.max(0, Math.floor((width - trimmed.length) / 2));
  return ' '.repeat(padding) + trimmed;
};

const rightAlign = (left: string, right: string, width: number = PAPER_WIDTH): string => {
  const maxLeft = width - right.length - 1;
  const leftTrimmed = left.substring(0, maxLeft);
  const spaces = width - leftTrimmed.length - right.length;
  return leftTrimmed + ' '.repeat(Math.max(1, spaces)) + right;
};

const dividerLine = (char: string = '-', width: number = PAPER_WIDTH): string => {
  return char.repeat(width);
};

// ============================================
// 🍳 KITCHEN TICKET - For the cook board
// ============================================

// Format time only (for kitchen ticket)
const formatTimeOnly = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
};

// Format scheduled time with date
const formatScheduledTime = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
};

/**
 * Generate a KITCHEN TICKET (KOT) for the cook
 * Clean, simple format optimized for readability
 * - No prices (cook doesn't need them)
 * - Large item names
 * - Clear modifiers
 * - Allergy alerts prominent
 */
const generateKitchenTicket = (order: Order): string => {
  let text = '';
  
  // Header
  text += dividerLine('=') + '\n';
  text += centerText('KITCHEN ORDER') + '\n';
  text += dividerLine('=') + '\n';
  
  // Order info
  text += `Order #: ${order.order_number}\n`;
  text += `Type: ${(order.order_type || 'PICKUP').toUpperCase()}\n`;
  text += `Customer: ${order.customer?.name || 'Guest'}\n`;
  text += `Time: ${formatTimeOnly(order.created_at)}\n`;
  
  // Scheduled time (if future order)
  if (order.estimated_ready_time) {
    const orderDate = new Date(order.created_at);
    const readyDate = new Date(order.estimated_ready_time);
    // Only show if ready time is more than 30 mins in the future
    if (readyDate.getTime() - orderDate.getTime() > 30 * 60 * 1000) {
      text += '\n' + dividerLine('-') + '\n';
      text += 'SCHEDULED FOR:\n';
      text += formatScheduledTime(order.estimated_ready_time) + '\n';
    }
  }
  
  // Items header
  text += '\n' + dividerLine('-') + '\n';
  text += 'ITEM                         QTY\n';
  text += dividerLine('-') + '\n';
  
  // Items - BIG and clear
  (order.items || []).forEach((item) => {
    const qty = item.quantity || 1;
    const itemName = item.name || 'Unknown Item';
    
    // Item line: QTYx ITEM NAME
    text += `${qty}x ${itemName}\n`;
    
    // Modifiers - indented
    (item.modifiers || []).forEach((mod) => {
      text += `  - ${mod.name}\n`;
    });
    
    // Item-specific notes
    if (item.notes) {
      text += `  >> ${item.notes}\n`;
    }
  });
  
  text += '\n' + dividerLine('-') + '\n';
  
  // Allergy alert (if any item has allergy info or notes mention allergy)
  const allergyKeywords = ['allergy', 'allergic', 'allergen', 'nut', 'gluten', 'dairy', 'shellfish', 'egg'];
  const hasAllergy = order.notes && allergyKeywords.some(k => order.notes!.toLowerCase().includes(k));
  
  if (hasAllergy) {
    text += 'ALLERGY ALERT:\n';
    text += order.notes + '\n';
    text += dividerLine('-') + '\n';
  }
  
  // General notes (if not allergy-related)
  if (order.notes && !hasAllergy) {
    text += 'NOTES:\n';
    text += order.notes + '\n';
    text += dividerLine('-') + '\n';
  }
  
  // Delivery instructions
  if (order.delivery_address?.instructions) {
    text += 'DELIVERY NOTE:\n';
    text += order.delivery_address.instructions + '\n';
    text += dividerLine('-') + '\n';
  }
  
  // Pack checklist for takeout/delivery
  if (order.order_type === 'pickup' || order.order_type === 'delivery' || order.order_type === 'takeout') {
    text += '\nPACK / CHECK:\n';
    text += '[ ] Utensils\n';
    text += '[ ] Napkins\n';
    text += '[ ] Condiments\n';
  }
  
  // Footer
  text += '\n' + dividerLine('=') + '\n';
  text += '\n\n\n';
  
  return text;
};

// ============================================
// 🧾 CUSTOMER RECEIPT - For the bag/customer
// ============================================

const generateReceiptText = (order: Order): string => {
  let text = '';
  
  // Header
  text += dividerLine('=') + '\n';
  text += centerText(`ORDER #${order.order_number}`) + '\n';
  text += dividerLine('=') + '\n';
  text += centerText(`*** ${(order.order_type || 'PICKUP').toUpperCase()} ***`) + '\n';
  text += centerText(formatDateTime(order.created_at)) + '\n';
  text += dividerLine('-') + '\n';
  
  // Customer
  text += `Customer: ${order.customer?.name || 'Guest'}\n`;
  if (order.customer?.phone) {
    text += `Phone: ${order.customer.phone}\n`;
  }
  
  // Delivery address
  if (order.delivery_address) {
    text += '\n' + centerText('DELIVER TO') + '\n';
    text += dividerLine('-') + '\n';
    if (order.delivery_address.street) {
      text += `${order.delivery_address.street}\n`;
    }
    const cityLine = [order.delivery_address.city, order.delivery_address.postalCode].filter(Boolean).join(' ');
    if (cityLine) {
      text += `${cityLine}\n`;
    }
    if (order.delivery_address.instructions) {
      text += `Note: ${order.delivery_address.instructions}\n`;
    }
  }
  
  // Items section
  text += '\n' + dividerLine('=') + '\n';
  text += centerText('ITEMS') + '\n';
  text += dividerLine('=') + '\n';
  
  // Items
  (order.items || []).forEach((item) => {
    const itemTotal = (item.price || 0) * (item.quantity || 1);
    const itemLine = `${item.quantity}x ${item.name}`;
    const priceLine = `$${itemTotal.toFixed(2)}`;
    text += rightAlign(itemLine, priceLine) + '\n';
    
    // Modifiers
    (item.modifiers || []).forEach((mod) => {
      const modPrice = mod.price > 0 ? `+$${mod.price.toFixed(2)}` : '';
      text += `  - ${mod.name} ${modPrice}\n`;
    });
    
    if (item.notes) {
      text += `  >> ${item.notes}\n`;
    }
  });
  
  // Totals
  text += dividerLine('-') + '\n';
  text += rightAlign('Subtotal:', `$${(order.subtotal || 0).toFixed(2)}`) + '\n';
  text += rightAlign('Tax:', `$${(order.tax || 0).toFixed(2)}`) + '\n';
  if (order.delivery_fee) {
    text += rightAlign('Delivery:', `$${order.delivery_fee.toFixed(2)}`) + '\n';
  }
  if (order.tip) {
    text += rightAlign('Tip:', `$${order.tip.toFixed(2)}`) + '\n';
  }
  text += dividerLine('=') + '\n';
  text += rightAlign('TOTAL:', `$${(order.total || 0).toFixed(2)}`) + '\n';
  text += dividerLine('=') + '\n';
  
  // Notes
  if (order.notes) {
    text += '\n' + centerText('ORDER NOTES') + '\n';
    text += dividerLine('-') + '\n';
    text += `${order.notes}\n`;
  }
  
  // Footer
  text += '\n' + centerText('Thank you!') + '\n';
  text += '\n\n\n';
  
  return text;
};

/**
 * Print a KITCHEN TICKET (for the cook board)
 */
export const printKitchenTicket = async (order: Order): Promise<boolean> => {
  const ticketText = generateKitchenTicket(order);

  console.log('[PrintService] Printing KITCHEN TICKET for order:', order.order_number);

  if (!BLEPrinter || !printerConnected) {
    console.warn('[PrintService] No printer connected, logging kitchen ticket:');
    console.log(ticketText);
    return false;
  }

  try {
    await BLEPrinter.printText(ticketText, {
      encoding: 'UTF8',
      codepage: 0,
      widthtimes: 0,
      heigthtimes: 0,
      fonttype: 0,
    });
    
    console.log('[PrintService] Kitchen ticket printed!');
    return true;
  } catch (error) {
    console.error('[PrintService] Kitchen ticket print failed:', error);
    return false;
  }
};

/**
 * Print a CUSTOMER RECEIPT (for the bag/customer)
 */
export const printCustomerReceipt = async (order: Order): Promise<boolean> => {
  const receiptText = generateReceiptText(order);

  console.log('[PrintService] Printing CUSTOMER RECEIPT for order:', order.order_number);

  if (!BLEPrinter || !printerConnected) {
    console.warn('[PrintService] No printer connected, logging receipt:');
    console.log(receiptText);
    return false;
  }

  try {
    await BLEPrinter.printText(receiptText, {
      encoding: 'UTF8',
      codepage: 0,
      widthtimes: 0,
      heigthtimes: 0,
      fonttype: 0,
    });
    
    console.log('[PrintService] Customer receipt printed!');
    return true;
  } catch (error) {
    console.error('[PrintService] Customer receipt print failed:', error);
    return false;
  }
};

/**
 * Print BOTH kitchen ticket and customer receipt
 */
export const printBoth = async (order: Order): Promise<boolean> => {
  console.log('[PrintService] Printing BOTH for order:', order.order_number);
  
  const kitchenResult = await printKitchenTicket(order);
  
  // Small pause between prints
  await new Promise(resolve => setTimeout(resolve, 500));
  
  const receiptResult = await printCustomerReceipt(order);
  
  return kitchenResult && receiptResult;
};

/**
 * Print a test page
 */
export const printTestPage = async (): Promise<boolean> => {
  const testText = `
${dividerLine('=')}
${centerText('PRINTER TEST')}
${dividerLine('=')}

${centerText('If you can read this,')}
${centerText('your printer is working!')}

${centerText(new Date().toLocaleString())}

${dividerLine('=')}
\n\n\n`;

  console.log('[PrintService] Printing test page');

  if (!BLEPrinter || !printerConnected) {
    console.warn('[PrintService] No printer connected');
    console.log(testText);
    return false;
  }

  try {
    await BLEPrinter.printText(testText, {});
    console.log('[PrintService] Test print successful!');
    return true;
  } catch (error) {
    console.error('[PrintService] Test print failed:', error);
    return false;
  }
};

// Alias for test print
export const printTestReceipt = printTestPage;

export default {
  // Print functions
  printOrder,           // Legacy - prints receipt format
  printKitchenTicket,   // 🍳 For the cook board
  printCustomerReceipt, // 🧾 For the customer/bag
  printBoth,            // Print both at once
  printTestPage,
  printTestReceipt,
  
  // Receipt generators
  generateReceiptData,
  generateTestReceipt,
  
  // Printer management
  discoverPrinters,
  connectPrinter,
  disconnectPrinter,
  isPrinterConnected,
};
