/**
 * Thermal Printer Service for ESC/POS Compatible Printers
 * Uses react-native-thermal-receipt-printer-image-qr for Bluetooth printing
 * 
 * IMPORTANT: This service maintains its own connection state.
 * The app should ALWAYS call verifyConnection() before printing
 * to ensure the Bluetooth connection is actually active.
 * 
 * ⚠️ PRINT FORMAT REFERENCE:
 * See PRINT-FORMAT-REFERENCE.md for the "known good" print format.
 * DO NOT change print formatting without:
 * 1. Testing on actual thermal printer
 * 2. Updating the reference document
 * 3. Getting approval
 * 
 * Last verified working: December 17, 2025
 */

import { Order, OrderItem } from '../types';

// Import the printer library - install with:
// npm install react-native-thermal-receipt-printer-image-qr
let BLEPrinter: any = null;
let printerConnected = false;
let connectedPrinterAddress: string | null = null;
let lastConnectionAttempt: number = 0;
const CONNECTION_RETRY_DELAY = 3000; // Wait 3 seconds between reconnection attempts

// Try to import the printer library (may not be installed yet)
try {
  const printerLib = require('react-native-thermal-receipt-printer-image-qr');
  BLEPrinter = printerLib.BLEPrinter;
  console.log('[PrintService] ✓ Bluetooth printer library loaded');
} catch (e) {
  console.warn('[PrintService] ✗ Printer library not installed. Run: npm install react-native-thermal-receipt-printer-image-qr');
}

/**
 * Strip Twilio call log entries from order notes before printing.
 */
const stripTwilioLogs = (notes: string): string => {
  if (!notes) return '';
  return notes
    .split('\n')
    .filter(line => !line.includes('TWILIO_FALLBACK_CALL'))
    .join('\n')
    .replace(/\|\s*\|/g, '|')
    .replace(/^\s*\|\s*/gm, '')
    .replace(/\s*\|\s*$/gm, '')
    .trim();
};

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
  
  // Character spacing (ESC SP n) - n = dots of spacing (0-255)
  CHAR_SPACING: (n: number) => `${ESC} ${String.fromCharCode(n)}`,
  CHAR_SPACING_NORMAL: `${ESC} \x00`,
  CHAR_SPACING_WIDE: `${ESC} \x02`, // 2 dots = subtle spacing, tighter

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

// Format date/time - ASCII only to avoid printer issues
const formatDateTime = (dateString: string): string => {
  const date = new Date(dateString);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[date.getMonth()];
  const day = date.getDate();
  const year = date.getFullYear();
  let hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  return `${month} ${day}, ${year}, ${hours}:${minutes} ${ampm}`;
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

    // Modifiers - grouped by group_name, with placement and price
    if (item.modifiers && item.modifiers.length > 0) {
      const groups = groupModifiers(item.modifiers);
      groups.forEach((group) => {
        if (group.groupName) {
          receipt += `   ${group.groupName.toUpperCase()}:\n`;
        }
        group.modifiers.forEach((mod) => {
          const modPrice = mod.price > 0 ? ` +${formatCurrency(mod.price)}` : '';
          let placementText = '';
          if (mod.placement && mod.placement !== 'whole') {
            placementText = mod.placement === 'left' ? ' (LEFT)' : ' (RIGHT)';
          }
          receipt += `   - ${mod.name}${placementText}${modPrice}\n`;
        });
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

  // Order Notes (strip Twilio call logs)
  const cleanedNotes = order.notes ? stripTwilioLogs(order.notes) : '';
  if (cleanedNotes) {
    receipt += '\n' + COMMANDS.LINE + '\n';
    receipt += COMMANDS.BOLD_ON;
    receipt += 'ORDER NOTES:\n';
    receipt += COMMANDS.BOLD_OFF;
    receipt += cleanedNotes + '\n';
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
    console.error('[PrintService] ✗ Printer library not available');
    return false;
  }
  
  try {
    await BLEPrinter.init();
    console.log('[PrintService] ✓ Printer module initialized');
    return true;
  } catch (error) {
    console.error('[PrintService] ✗ Init failed:', error);
    return false;
  }
};

/**
 * Discover available Bluetooth printers
 */
export const discoverPrinters = async (): Promise<Array<{device_name: string, inner_mac_address: string}>> => {
  if (!BLEPrinter) {
    console.warn('[PrintService] ✗ Printer library not installed');
    return [];
  }

  try {
    console.log('[PrintService] 🔍 Scanning for Bluetooth printers...');
    await BLEPrinter.init();
    const devices = await BLEPrinter.getDeviceList();
    console.log('[PrintService] ✓ Found devices:', devices?.length || 0);
    return devices || [];
  } catch (error) {
    console.error('[PrintService] ✗ Discovery failed:', error);
    return [];
  }
};

/**
 * Connect to a Bluetooth printer by MAC address
 * @returns {Promise<boolean>} true if connection was successful
 */
export const connectPrinter = async (macAddress: string): Promise<boolean> => {
  console.log('[PrintService] 🔗 connectPrinter called with:', macAddress);
  
  if (!BLEPrinter) {
    console.error('[PrintService] ✗ Printer library not available - BLEPrinter is null');
    return false;
  }

  // Rate limit connection attempts - but always return false if we need to wait
  const now = Date.now();
  if (now - lastConnectionAttempt < CONNECTION_RETRY_DELAY) {
    console.log('[PrintService] ⏳ Rate limited - must wait before retry');
    return false; // Don't return cached state - be conservative
  }
  lastConnectionAttempt = now;

  // Reset state before connecting
  printerConnected = false;
  connectedPrinterAddress = null;

  try {
    console.log(`[PrintService] 🔄 Step 1: Initializing printer module...`);
    await BLEPrinter.init();
    console.log(`[PrintService] ✓ Init complete`);
    
    console.log(`[PrintService] 🔗 Step 2: Connecting to printer: ${macAddress}`);
    await BLEPrinter.connectPrinter(macAddress);
    console.log(`[PrintService] ✓ connectPrinter() returned`);
    
    // Mark as connected
    printerConnected = true;
    connectedPrinterAddress = macAddress;
    console.log('[PrintService] ✓ Connection state set - printerConnected:', printerConnected);
    
    return true;
  } catch (error: any) {
    console.error('[PrintService] ✗ Connection failed:', error?.message || error);
    console.error('[PrintService] Full error:', JSON.stringify(error));
    printerConnected = false;
    connectedPrinterAddress = null;
    return false;
  }
};

/**
 * Disconnect from printer
 */
export const disconnectPrinter = async (): Promise<void> => {
  console.log('[PrintService] 🔌 Disconnecting printer...');
  printerConnected = false;
  connectedPrinterAddress = null;
  
  if (BLEPrinter) {
    try {
      await BLEPrinter.closeConn();
      console.log('[PrintService] ✓ Disconnected');
    } catch (error) {
      console.error('[PrintService] Disconnect error (ignored):', error);
    }
  }
};

/**
 * Check if printer is connected (based on local state)
 */
export const isPrinterConnected = (): boolean => {
  return printerConnected && BLEPrinter !== null;
};

/**
 * Get the currently connected printer address
 */
export const getConnectedPrinterAddress = (): string | null => {
  return printerConnected ? connectedPrinterAddress : null;
};

/**
 * Verify printer connection is actually working
 * Uses simple state check - actual verification happens on print attempt
 * @returns {Promise<boolean>} true if we believe printer is connected
 */
export const verifyConnection = async (): Promise<boolean> => {
  if (!BLEPrinter) {
    console.log('[PrintService] ❌ Printer library not loaded');
    return false;
  }
  
  if (!connectedPrinterAddress) {
    console.log('[PrintService] ❌ No printer address stored');
    printerConnected = false;
    return false;
  }

  // Return current state - don't disconnect to test!
  // Disconnecting causes race conditions with print operations
  console.log(`[PrintService] 🔍 Connection state: ${printerConnected ? 'connected' : 'disconnected'}`);
  return printerConnected;
};

/**
 * Ensure printer is connected before printing
 * Will attempt reconnection if necessary
 * @param macAddress - The printer MAC address to connect to
 * @returns {Promise<boolean>} true if printer is ready to print
 */
export const ensureConnected = async (macAddress?: string): Promise<boolean> => {
  // Already connected and verified?
  if (await verifyConnection()) {
    return true;
  }

  // Try to reconnect if we have an address
  const addressToUse = macAddress || connectedPrinterAddress;
  if (addressToUse) {
    console.log('[PrintService] 🔄 Reconnecting to printer...');
    return await connectPrinter(addressToUse);
  }

  console.log('[PrintService] ❌ No printer address available for reconnection');
  return false;
};

/**
 * Print an order receipt
 * @returns {Promise<boolean>} true ONLY if print was actually sent to printer
 */
export const printOrder = async (order: Order): Promise<boolean> => {
  const receiptText = generateReceiptText(order);

  console.log('[PrintService] 🖨️ Printing order:', order.order_number);

  // CRITICAL: Verify actual connection, not just stored state
  if (!BLEPrinter) {
    console.error('[PrintService] ❌ Printer library not available');
    return false;
  }

  if (!printerConnected || !connectedPrinterAddress) {
    console.error('[PrintService] ❌ No printer connected - printerConnected:', printerConnected);
    return false;
  }

  try {
    // Print using the library's text method
    // Note: Feed and cut commands are now included in generateReceiptText()
    await BLEPrinter.printText(receiptText, {
      encoding: 'UTF8',
      codepage: 0,
      widthtimes: 0,
      heigthtimes: 0,
      fonttype: 0,
    });
    
    console.log('[PrintService] ✓ Print successful for order', order.order_number);
    return true;
  } catch (error: any) {
    console.error('[PrintService] ❌ Print FAILED:', error?.message || error);
    // Mark as disconnected since print failed
    printerConnected = false;
    return false;
  }
};

/**
 * Generate receipt - plain text format for 80mm paper
 * Effective width is 46 chars (48 - 2 char left margin) at normal size
 * Effective width is 23 chars (24 - 1 char left margin) for double-size text
 * The 2-char left margin is built into helpers to prevent edge clipping
 */
const PAPER_WIDTH = 42;        // Reduced from 46 to leave right margin
const PAPER_WIDTH_DOUBLE = 21; // Half of 42 for double-size text
const LEFT_MARGIN = '  ';      // 2 spaces for left margin

const centerText = (text: string, width: number = PAPER_WIDTH): string => {
  const trimmed = text.substring(0, width);
  const padding = Math.max(0, Math.floor((width - trimmed.length) / 2));
  return LEFT_MARGIN + ' '.repeat(padding) + trimmed;
};

const rightAlign = (left: string, right: string, width: number = PAPER_WIDTH): string => {
  const maxLeft = width - right.length - 1;
  const leftTrimmed = left.substring(0, maxLeft);
  const spaces = width - leftTrimmed.length - right.length;
  return LEFT_MARGIN + leftTrimmed + ' '.repeat(Math.max(1, spaces)) + right;
};

const dividerLine = (char: string = '-', width: number = PAPER_WIDTH): string => {
  return LEFT_MARGIN + char.repeat(width);
};

/**
 * Add left margin to a single line of text
 */
const marginLine = (text: string): string => {
  return LEFT_MARGIN + text;
};

// ============================================
// 🍳 KITCHEN TICKET - For the cook board
// ============================================

/**
 * Sanitize text for thermal printer - convert special chars to ASCII
 * Thermal printers often can't handle Unicode/UTF-8 special characters
 * This function aggressively removes all non-ASCII to prevent Chinese/Unicode character issues
 */
const sanitizeForPrinter = (text: string): string => {
  if (!text) return '';
  // First, try to normalize Unicode characters
  let sanitized = text
    // Curly quotes and apostrophes → straight versions
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")  // ' ' ‚ ‛ → '
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')  // " " „ ‟ → "
    // Dashes
    .replace(/[\u2013\u2014\u2015]/g, '-')        // – — ― → -
    // Ellipsis
    .replace(/\u2026/g, '...')                     // … → ...
    // Spaces
    .replace(/[\u00A0\u2002\u2003\u2009]/g, ' ')  // non-breaking, en, em, thin space → space
    // Common accented characters → ASCII
    .replace(/[àáâãäå]/gi, 'a')
    .replace(/[èéêë]/gi, 'e')
    .replace(/[ìíîï]/gi, 'i')
    .replace(/[òóôõö]/gi, 'o')
    .replace(/[ùúûü]/gi, 'u')
    .replace(/[ñ]/gi, 'n')
    .replace(/[ç]/gi, 'c');
  
  // Aggressively remove ALL remaining non-ASCII characters (including Chinese, emojis, etc.)
  // This ensures thermal printers only receive ASCII-safe characters
  sanitized = sanitized.replace(/[^\x00-\x7F]/g, '');
  
  // Remove any control characters except newlines, tabs, and carriage returns
  sanitized = sanitized.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');
  
  return sanitized;
};

/**
 * Group modifiers by their group_name field.
 * Returns an array of { groupName, modifiers } in insertion order.
 * Modifiers with no group_name (null/undefined) go into a group with groupName = null.
 */
const groupModifiers = (modifiers: Array<{ name: string; price: number; quantity?: number; placement?: string | null; group_name?: string | null }>): Array<{ groupName: string | null; modifiers: typeof modifiers }> => {
  const groups: Map<string | null, typeof modifiers> = new Map();
  for (const mod of modifiers) {
    const key = mod.group_name ?? null;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(mod);
  }
  return Array.from(groups.entries()).map(([groupName, mods]) => ({ groupName, modifiers: mods }));
};

/**
 * Word-wrap text to fit within a maximum width
 * Returns array of lines
 */
const wrapText = (text: string, maxWidth: number): string[] => {
  if (!text) return [];
  const sanitized = sanitizeForPrinter(text);
  const words = sanitized.split(' ');
  const lines: string[] = [];
  let currentLine = '';
  
  words.forEach(word => {
    if (currentLine.length + word.length + 1 <= maxWidth) {
      currentLine += (currentLine ? ' ' : '') + word;
    } else {
      if (currentLine) lines.push(currentLine);
      // If word itself is longer than maxWidth, split it
      if (word.length > maxWidth) {
        while (word.length > maxWidth) {
          lines.push(word.substring(0, maxWidth));
          word = word.substring(maxWidth);
        }
        currentLine = word;
      } else {
        currentLine = word;
      }
    }
  });
  if (currentLine) lines.push(currentLine);
  return lines;
};

// Format time only (for kitchen ticket) - ASCII only to avoid printer issues
const formatTimeOnly = (dateString: string): string => {
  const date = new Date(dateString);
  let hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12; // 0 becomes 12
  return `${hours}:${minutes} ${ampm}`;
};

// Format scheduled time with date - ASCII only to avoid printer issues
const formatScheduledTime = (dateString: string): string => {
  const date = new Date(dateString);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[date.getMonth()];
  const day = date.getDate().toString().padStart(2, '0');
  const year = date.getFullYear();
  let hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12; // 0 becomes 12
  return `${month} ${day}, ${year}, ${hours}:${minutes} ${ampm}`;
};

/**
 * Generate a KITCHEN TICKET (KOT) for the cook
 * Clean, simple format optimized for readability
 * - No prices (cook doesn't need them)
 * - Large item names with ESC/POS formatting
 * - Clear modifiers
 * - Allergy alerts prominent with DOUBLE_SIZE
 * 
 * ESC/POS Formatting Used:
 * - Customer Name: DOUBLE_SIZE + BOLD (~24 chars wide)
 * - Item Names: DOUBLE_HEIGHT + BOLD (~48 chars wide)
 * - Allergy Header: DOUBLE_SIZE + BOLD (~24 chars wide)
 * - Allergy Text: DOUBLE_HEIGHT (~48 chars wide)
 * - Everything else: Normal size (~48 chars wide)
 */
const generateKitchenTicket = (order: Order): string => {
  // DEBUG: Log what notes we're receiving
  console.log('[KitchenTicket] Order notes:', order.notes || 'NONE');
  console.log('[KitchenTicket] Items with notes:', (order.items || []).filter(i => i.notes).map(i => `${i.name}: ${i.notes}`));
  
  let text = '';
  
  // Initialize printer to reset any previous formatting
  text += COMMANDS.INIT;
  
  // Extract short order number (last 5 digits only for easy call-outs)
  const fullOrderNum = order.order_number || '';
  const shortOrderNum = fullOrderNum.replace(/\D/g, '').slice(-5) || fullOrderNum.slice(-5);
  
  // Header with BIG short order number for call-outs (MANUALLY CENTERED)
  // DOUBLE_SIZE = half width, so center within PAPER_WIDTH_DOUBLE chars
  const orderNumText = `#${shortOrderNum}`;
  const orderNumPadding = Math.max(0, Math.floor((PAPER_WIDTH_DOUBLE - orderNumText.length) / 2));
  const centeredOrderNum = ' '.repeat(orderNumPadding) + orderNumText;
  
  text += dividerLine('=') + '\n';
  text += COMMANDS.DOUBLE_SIZE;
  text += COMMANDS.BOLD_ON;
  text += centeredOrderNum + '\n';
  text += COMMANDS.BOLD_OFF;
  text += COMMANDS.NORMAL_SIZE;
  text += dividerLine('=') + '\n';
  
  // Order info - Normal size
  text += marginLine(`Type: ${(order.order_type || 'PICKUP').toUpperCase()}`) + '\n';
  text += marginLine(`Time: ${formatTimeOnly(order.created_at)}`) + '\n';
  
  // Customer phone - Normal size, shown above name for quick contact
  const customerPhone = sanitizeForPrinter(order.customer?.phone || '');
  if (customerPhone) {
    text += '\n';
    text += marginLine(`Phone: ${customerPhone}`) + '\n';
  }
  
  // Customer name - DOUBLE_SIZE + BOLD for maximum visibility
  // If no real name, use order number for identification
  text += customerPhone ? '' : '\n'; // Only add newline if no phone was printed
  text += COMMANDS.DOUBLE_SIZE;
  text += COMMANDS.BOLD_ON;
  const rawName = sanitizeForPrinter(order.customer?.name || '');
  const isValidName = rawName && rawName.toLowerCase() !== 'guest' && rawName.toLowerCase() !== 'customer' && rawName.trim() !== '';
  const displayName = isValidName ? rawName : `#${order.order_number.slice(-6)}`;
  text += LEFT_MARGIN + displayName.substring(0, PAPER_WIDTH_DOUBLE) + '\n';
  text += COMMANDS.BOLD_OFF;
  text += COMMANDS.NORMAL_SIZE;
  
  // 📅 SCHEDULED ORDER DETECTION
  // Check both estimated_ready_time field AND notes for scheduled info
  let scheduledTime: string | null = null;
  let scheduledFromNotes = false;
  
  // Check estimated_ready_time field first
  if (order.estimated_ready_time) {
    const orderDate = new Date(order.created_at);
    const readyDate = new Date(order.estimated_ready_time);
    // Only show if ready time is more than 30 mins in the future
    if (readyDate.getTime() - orderDate.getTime() > 30 * 60 * 1000) {
      scheduledTime = formatScheduledTime(order.estimated_ready_time);
    }
  }
  
  // Also check notes for "Scheduled for:" pattern (from Replit API)
  const scheduledMatch = order.notes?.match(/Scheduled\s*for:\s*(\d{4}-\d{2}-\d{2}T[\d:\.]+Z?)/i);
  if (scheduledMatch && scheduledMatch[1]) {
    const matchedTime = formatScheduledTime(scheduledMatch[1]);
    if (matchedTime) {
      scheduledTime = matchedTime;
      scheduledFromNotes = true;
    }
  }
  
  // Display scheduled time prominently if found
  if (scheduledTime) {
    text += '\n';
    // Use normal size for asterisks (not double) so they're not too wide
    text += dividerLine('*') + '\n';
    text += COMMANDS.DOUBLE_SIZE;
    text += COMMANDS.BOLD_ON;
    text += centerText('SCHEDULED ORDER', PAPER_WIDTH_DOUBLE) + '\n';
    text += COMMANDS.BOLD_OFF;
    text += COMMANDS.NORMAL_SIZE;
    text += COMMANDS.BOLD_ON;
    // Sanitize scheduled time to remove any non-ASCII characters
    const sanitizedScheduledTime = sanitizeForPrinter(scheduledTime);
    text += centerText(sanitizedScheduledTime, PAPER_WIDTH) + '\n';
    text += COMMANDS.BOLD_OFF;
    text += dividerLine('*') + '\n'; // Normal width after reset
  }
  
  // Items header with count (FOOD FIRST - most important for kitchen!)
  const itemCount = (order.items || []).reduce((sum, item) => sum + (item.quantity || 1), 0);
  text += '\n' + dividerLine('-') + '\n';
  text += COMMANDS.BOLD_ON;
  text += marginLine(`ITEMS: (${itemCount} item${itemCount !== 1 ? 's' : ''})`) + '\n';
  text += COMMANDS.BOLD_OFF;
  text += dividerLine('-') + '\n';
  
  // Items - DOUBLE_HEIGHT + BOLD for easy scanning
  const items = order.items || [];
  items.forEach((item, index) => {
    const qty = item.quantity || 1;
    const itemName = sanitizeForPrinter(item.name || 'Unknown Item').substring(0, PAPER_WIDTH - 4); // Leave room for "Nx "
    
    // Quantity and item name in DOUBLE_HEIGHT + BOLD + wider spacing
    text += COMMANDS.DOUBLE_HEIGHT;
    text += COMMANDS.BOLD_ON;
    text += COMMANDS.CHAR_SPACING_WIDE; // ~15% wider letter spacing
    text += LEFT_MARGIN + `${qty}x ${itemName}` + '\n';
    text += COMMANDS.CHAR_SPACING_NORMAL; // Reset spacing
    text += COMMANDS.BOLD_OFF;
    text += COMMANDS.NORMAL_SIZE;
    
    // Modifiers - grouped by group_name, with placement and quantity
    if (item.modifiers && item.modifiers.length > 0) {
      const groups = groupModifiers(item.modifiers);
      groups.forEach((group) => {
        // Print group header if it has a name
        if (group.groupName) {
          text += LEFT_MARGIN + '   ' + COMMANDS.BOLD_ON + sanitizeForPrinter(group.groupName).toUpperCase() + ':' + COMMANDS.BOLD_OFF + '\n';
        }
        group.modifiers.forEach((mod) => {
          let placementText = '';
          if (mod.placement && mod.placement !== 'whole') {
            placementText = mod.placement === 'left' ? ' (LEFT)' : ' (RIGHT)';
          }
          const modName = sanitizeForPrinter(mod.name);
          const hasQuantity = mod.quantity && mod.quantity > 1;
          const modQuantity = hasQuantity ? ` x${mod.quantity}` : '';
          
          text += LEFT_MARGIN + '   - ' + modName;
          if (hasQuantity) {
            text += COMMANDS.BOLD_ON;
            text += modQuantity;
            text += COMMANDS.BOLD_OFF;
          }
          text += placementText + '\n';
        });
      });
    }
    
    // Item-specific notes - Normal size, indented, with word wrap
    if (item.notes) {
      const noteLines = wrapText(item.notes, PAPER_WIDTH - 6); // Account for "   >> " prefix
      noteLines.forEach((line, idx) => {
        text += marginLine(idx === 0 ? `   >> ${line}` : `      ${line}`) + '\n';
      });
    }
    
    // Add separator between items (but not after the last item)
    if (index < items.length - 1) {
      text += '\n'; // Blank line between items for readability
    }
  });
  
  text += '\n' + dividerLine('-') + '\n';
  
  // ============================================
  // 🚨 SMART ALERT DETECTION SYSTEM
  // Scans order notes and item notes for keywords
  // ============================================
  
  // Helper: Check if any keywords exist in text
  const containsKeyword = (text: string | undefined, keywords: string[]): boolean => {
    if (!text) return false;
    const lowerText = text.toLowerCase();
    return keywords.some(k => lowerText.includes(k.toLowerCase()));
  };
  
  // Helper: Collect matching notes from items
  const collectItemNotes = (keywords: string[]): string[] => {
    const matches: string[] = [];
    (order.items || []).forEach((item) => {
      if (containsKeyword(item.notes, keywords)) {
        matches.push(`${item.name}: ${item.notes}`);
      }
    });
    return matches;
  };
  
  // ----------------------------------------
  // 🚨 URGENT / RUSH ORDER DETECTION
  // ----------------------------------------
  const urgentKeywords = ['urgent', 'rush', 'asap', 'hurry', 'priority', 'fast', 'quickly', 'emergency'];
  const orderHasUrgent = containsKeyword(order.notes, urgentKeywords);
  const itemUrgentNotes = collectItemNotes(urgentKeywords);
  const isUrgent = orderHasUrgent || itemUrgentNotes.length > 0;
  
  if (isUrgent) {
    text += '\n';
    text += COMMANDS.DOUBLE_SIZE;
    text += COMMANDS.BOLD_ON;
    text += LEFT_MARGIN + '>>> URGENT <<<' + '\n';
    text += COMMANDS.BOLD_OFF;
    text += COMMANDS.NORMAL_SIZE;
    
    // Show the reason so kitchen can judge if it's legit
    const alertWidth = PAPER_WIDTH_DOUBLE - 2;
    text += COMMANDS.DOUBLE_HEIGHT;
    if (orderHasUrgent && order.notes) {
      const lines = wrapText(order.notes, alertWidth);
      lines.forEach(line => {
        text += LEFT_MARGIN + line + '\n';
      });
    }
    itemUrgentNotes.forEach((note) => {
      const lines = wrapText(note, alertWidth);
      lines.forEach(line => {
        text += LEFT_MARGIN + line + '\n';
      });
    });
    text += COMMANDS.NORMAL_SIZE;
    text += dividerLine('-') + '\n';
  }
  
  // ----------------------------------------
  // 🚨 ALLERGY ALERT DETECTION (TRUE ALLERGIES ONLY)
  // ----------------------------------------
  // Include all tenses AND common misspellings (single "l" versions)
  const allergyKeywords = [
    // Proper spelling - all forms
    'allergy', 'allergies', 'allergic', 'allergen', 'allergens',
    // Misspellings with single "l" - for the spelling-challenged among us 😄
    'alergy', 'alergies', 'alergic', 'alergen', 'alergens', 'alergi',
    // Specific allergies
    'nut allergy', 'peanut', 'tree nut', 'shellfish', 'seafood allergy', 
    'egg allergy', 'soy allergy', 'wheat allergy', 'milk allergy', 
    'dairy allergy', 'fish allergy', 'sesame', 'mustard allergy',
    // Severe reactions
    'anaphylactic', 'anaphylaxis', 'epipen', 'epi-pen', 'epi pen'
  ];
  
  const orderHasAllergy = containsKeyword(order.notes, allergyKeywords);
  const itemAllergyNotes = collectItemNotes(allergyKeywords);
  const hasAllergy = orderHasAllergy || itemAllergyNotes.length > 0;
  
  if (hasAllergy) {
    text += '\n';
    text += COMMANDS.DOUBLE_SIZE;
    text += COMMANDS.BOLD_ON;
    text += LEFT_MARGIN + '!! ALLERGY !!' + '\n';
    text += COMMANDS.BOLD_OFF;
    text += COMMANDS.NORMAL_SIZE;
    
    // DOUBLE_HEIGHT text is twice as wide per char, so use half the width
    const alertWidth = PAPER_WIDTH_DOUBLE - 2; // Account for margin
    text += COMMANDS.DOUBLE_HEIGHT;
    if (orderHasAllergy && order.notes) {
      const lines = wrapText(order.notes, alertWidth);
      lines.forEach(line => {
        text += LEFT_MARGIN + line + '\n';
      });
    }
    itemAllergyNotes.forEach((note) => {
      const lines = wrapText(note, alertWidth);
      lines.forEach(line => {
        text += LEFT_MARGIN + line + '\n';
      });
    });
    text += COMMANDS.NORMAL_SIZE;
    text += dividerLine('-') + '\n';
  }
  
  // ----------------------------------------
  // 🌿 DIETARY RESTRICTION DETECTION
  // (Religious/lifestyle dietary needs)
  // ----------------------------------------
  const dietaryKeywords = ['vegetarian', 'vegan', 'plant-based', 'plant based', 'no meat',
                           'gluten-free', 'gluten free', 'celiac', 'gf',
                           'halal', 'kosher', 'dairy-free', 'dairy free', 'lactose'];
  
  const orderHasDietary = containsKeyword(order.notes, dietaryKeywords);
  const itemDietaryNotes = collectItemNotes(dietaryKeywords);
  const hasDietary = orderHasDietary || itemDietaryNotes.length > 0;
  
  // Show dietary section independently (each category shows its own matching items)
  if (hasDietary) {
    text += '\n';
    text += COMMANDS.DOUBLE_SIZE;
    text += COMMANDS.BOLD_ON;
    text += LEFT_MARGIN + '** DIETARY **' + '\n';
    text += COMMANDS.BOLD_OFF;
    text += COMMANDS.NORMAL_SIZE;
    
    // DOUBLE_HEIGHT text is twice as wide per char, so use half the width
    const alertWidth = PAPER_WIDTH_DOUBLE - 2; // Account for margin
    text += COMMANDS.DOUBLE_HEIGHT;
    // Only show order notes if they contain dietary keywords (not allergy keywords)
    if (orderHasDietary && order.notes && !orderHasAllergy) {
      const lines = wrapText(order.notes, alertWidth);
      lines.forEach(line => {
        text += LEFT_MARGIN + line + '\n';
      });
    }
    itemDietaryNotes.forEach((note) => {
      const lines = wrapText(note, alertWidth);
      lines.forEach(line => {
        text += LEFT_MARGIN + line + '\n';
      });
    });
    text += COMMANDS.NORMAL_SIZE;
    text += dividerLine('-') + '\n';
  }
  
  // ----------------------------------------
  // ⚠️ IMPORTANT - Health conditions & special requests
  // (Not allergies, but kitchen should be aware)
  // ----------------------------------------
  const importantKeywords = ['diabetic', 'diabetes', 'sugar-free', 'sugar free', 'no sugar',
                             'low sodium', 'low salt', 'heart', 'pregnant', 'pregnancy',
                             'chemo', 'immune', 'medical', 'health condition'];
  
  const orderHasImportant = containsKeyword(order.notes, importantKeywords);
  const itemImportantNotes = collectItemNotes(importantKeywords);
  const hasImportant = orderHasImportant || itemImportantNotes.length > 0;
  
  // Show important section independently (each category shows its own matching items)
  if (hasImportant) {
    text += '\n';
    text += COMMANDS.DOUBLE_SIZE;
    text += COMMANDS.BOLD_ON;
    text += LEFT_MARGIN + '* IMPORTANT *' + '\n';
    text += COMMANDS.BOLD_OFF;
    text += COMMANDS.NORMAL_SIZE;
    
    // DOUBLE_HEIGHT text is twice as wide per char, so use half the width
    const alertWidth = PAPER_WIDTH_DOUBLE - 2; // Account for margin
    text += COMMANDS.DOUBLE_HEIGHT;
    // Only show order notes if they contain important keywords (not already shown)
    if (orderHasImportant && order.notes && !orderHasAllergy && !orderHasDietary) {
      const lines = wrapText(order.notes, alertWidth);
      lines.forEach(line => {
        text += LEFT_MARGIN + line + '\n';
      });
    }
    itemImportantNotes.forEach((note) => {
      const lines = wrapText(note, alertWidth);
      lines.forEach(line => {
        text += LEFT_MARGIN + line + '\n';
      });
    });
    text += COMMANDS.NORMAL_SIZE;
    text += dividerLine('-') + '\n';
  }
  
  // General notes (if order notes exist but are not allergy-related) - Normal size
  // SKIP if this is a delivery order AND the notes are the same as delivery instructions (avoid duplicates)
  const deliveryInstructions = order.delivery_address?.instructions || 
                               order.delivery_address?.delivery_instructions || '';
  const notesAreSameAsDelivery = order.order_type === 'delivery' && 
                                  deliveryInstructions && 
                                  order.notes?.toLowerCase().includes(deliveryInstructions.toLowerCase().substring(0, 20));
  
  if (order.notes && !orderHasAllergy && !notesAreSameAsDelivery) {
    // Strip scheduled time and Twilio logs from notes
    let notesToDisplay = stripTwilioLogs(order.notes);
    if (scheduledFromNotes) {
      // Remove "Scheduled for: ..." and any surrounding pipes/separators
      notesToDisplay = notesToDisplay
        .replace(/\|\s*Scheduled\s*for:\s*\d{4}-\d{2}-\d{2}T[\d:\.]+Z?\s*/gi, '')
        .replace(/Scheduled\s*for:\s*\d{4}-\d{2}-\d{2}T[\d:\.]+Z?\s*\|?\s*/gi, '')
        .trim();
    }
    
    // Only show NOTES section if there's content left after stripping
    if (notesToDisplay) {
      text += COMMANDS.BOLD_ON;
      text += marginLine('NOTES:') + '\n';
      text += COMMANDS.BOLD_OFF;
      const noteLines = wrapText(notesToDisplay, PAPER_WIDTH - 2);
      noteLines.forEach(line => {
        text += marginLine(line) + '\n';
      });
      text += dividerLine('-') + '\n';
    }
  }
  
  // ============================================
  // 🚚 DELIVERY INFO (for delivery orders only)
  // Grouped together at bottom - address + instructions
  // ============================================
  if (order.order_type === 'delivery' && order.delivery_address) {
    text += '\n';
    text += COMMANDS.BOLD_ON;
    text += marginLine('DELIVER TO:') + '\n';
    text += COMMANDS.BOLD_OFF;
    
    // Street address (check multiple possible field names)
    const street = order.delivery_address.street || 
                   (order.delivery_address as any).address || 
                   (order.delivery_address as any).street_address ||
                   (order.delivery_address as any).line1 || '';
    if (street) {
      text += marginLine(sanitizeForPrinter(street)) + '\n';
    }
    
    // Unit/Apt (if separate field)
    const unit = order.delivery_address.unit || 
                 (order.delivery_address as any).apt || 
                 (order.delivery_address as any).suite ||
                 (order.delivery_address as any).line2 || '';
    if (unit) {
      text += marginLine(sanitizeForPrinter(`Unit ${unit}`)) + '\n';
    }
    
    // City, Province, Postal Code
    const city = order.delivery_address.city || '';
    const province = order.delivery_address.province || 
                     (order.delivery_address as any).state || 
                     (order.delivery_address as any).region || '';
    const postalCode = order.delivery_address.postal_code || 
                       order.delivery_address.postalCode || 
                       (order.delivery_address as any).zip || 
                       (order.delivery_address as any).zipcode || '';
    
    const cityLine = [city, province, postalCode].filter(Boolean).join(', ');
    if (cityLine) {
      text += marginLine(sanitizeForPrinter(cityLine)) + '\n';
    }
    
    text += dividerLine('-') + '\n';
    
    // Delivery instructions as separate section
    const instructions = order.delivery_address.instructions || 
                         order.delivery_address.delivery_instructions ||
                         (order.delivery_address as any).notes || '';
    if (instructions) {
      text += COMMANDS.BOLD_ON;
      text += marginLine('DELIVERY NOTE:') + '\n';
      text += COMMANDS.BOLD_OFF;
      const instructionLines = wrapText(instructions, PAPER_WIDTH - 2);
      instructionLines.forEach(line => {
        text += marginLine(sanitizeForPrinter(line)) + '\n';
      });
      text += dividerLine('-') + '\n';
    }
  }
  
  // Pack checklist for takeout/delivery - Normal size
  if (order.order_type === 'pickup' || order.order_type === 'delivery' || order.order_type === 'takeout') {
    text += '\n' + marginLine('PACK / CHECK:') + '\n';
    text += marginLine('[ ] Utensils') + '\n';
    text += marginLine('[ ] Napkins') + '\n';
    text += marginLine('[ ] Condiments') + '\n';
  }
  
  // Footer - Reset to normal, add paper feed (8 lines) and cut
  text += COMMANDS.NORMAL_SIZE;
  text += '\n' + dividerLine('=') + '\n';
  text += COMMANDS.FEED_LINES(8);
  text += COMMANDS.CUT_PAPER;
  
  return text;
};

// ============================================
// 🧾 CUSTOMER RECEIPT - For the bag/customer
// ============================================

const generateReceiptText = (order: Order): string => {
  let text = '';
  
  // Extract short order number for pickup call-out
  const fullOrderNum = order.order_number || '';
  const shortOrderNum = fullOrderNum.replace(/\D/g, '').slice(-5) || fullOrderNum.slice(-5);
  
  // ========== HEADER ==========
  text += dividerLine('=') + '\n';
  text += centerText('YOUR ORDER') + '\n';
  text += dividerLine('=') + '\n';
  
  // Big short order number for pickup call-out (MANUALLY CENTERED)
  const orderNumText = `#${shortOrderNum}`;
  const orderNumPadding = Math.max(0, Math.floor((PAPER_WIDTH_DOUBLE - orderNumText.length) / 2));
  const centeredOrderNum = ' '.repeat(orderNumPadding) + orderNumText;
  
  text += COMMANDS.DOUBLE_SIZE;
  text += COMMANDS.BOLD_ON;
  text += centeredOrderNum + '\n';
  text += COMMANDS.BOLD_OFF;
  text += COMMANDS.NORMAL_SIZE;
  
  text += dividerLine('=') + '\n';
  text += centerText(`*** ${(order.order_type || 'PICKUP').toUpperCase()} ***`) + '\n';
  text += centerText(formatDateTime(order.created_at)) + '\n';
  text += dividerLine('-') + '\n';
  
  // ========== CUSTOMER INFO ==========
  const customerName = sanitizeForPrinter(order.customer?.name || 'Guest');
  text += marginLine(`Customer: ${customerName}`) + '\n';
  if (order.customer?.phone) {
    text += marginLine(`Phone: ${sanitizeForPrinter(order.customer.phone)}`) + '\n';
  }
  
  // ========== 📅 SCHEDULED ORDER DETECTION ==========
  let scheduledTimeReceipt: string | null = null;
  let scheduledFromNotesReceipt = false;
  
  // Check estimated_ready_time field first
  if (order.estimated_ready_time) {
    const orderDate = new Date(order.created_at);
    const readyDate = new Date(order.estimated_ready_time);
    if (readyDate.getTime() - orderDate.getTime() > 30 * 60 * 1000) {
      scheduledTimeReceipt = formatScheduledTime(order.estimated_ready_time);
    }
  }
  
  // Also check notes for "Scheduled for:" pattern (from Replit API)
  const scheduledMatchReceipt = order.notes?.match(/Scheduled\s*for:\s*(\d{4}-\d{2}-\d{2}T[\d:\.]+Z?)/i);
  if (scheduledMatchReceipt && scheduledMatchReceipt[1]) {
    const matchedTime = formatScheduledTime(scheduledMatchReceipt[1]);
    if (matchedTime) {
      scheduledTimeReceipt = matchedTime;
      scheduledFromNotesReceipt = true;
    }
  }
  
  // Display scheduled time prominently if found
  if (scheduledTimeReceipt) {
    text += '\n';
    text += dividerLine('*') + '\n'; // Normal width (not in DOUBLE_SIZE mode here)
    text += COMMANDS.BOLD_ON;
    text += centerText('SCHEDULED ORDER') + '\n';
    // Sanitize scheduled time to remove any non-ASCII characters
    const sanitizedScheduledTimeReceipt = sanitizeForPrinter(scheduledTimeReceipt);
    text += centerText(sanitizedScheduledTimeReceipt) + '\n';
    text += COMMANDS.BOLD_OFF;
    text += dividerLine('*') + '\n';
  }
  
  // ========== DELIVERY ADDRESS ==========
  if (order.order_type === 'delivery' && order.delivery_address) {
    text += dividerLine('-') + '\n';
    text += COMMANDS.BOLD_ON;
    text += marginLine('DELIVER TO:') + '\n';
    text += COMMANDS.BOLD_OFF;
    
    // Street
    const street = order.delivery_address.street || 
                   (order.delivery_address as any).address || '';
    if (street) {
      text += marginLine(sanitizeForPrinter(street)) + '\n';
    }
    
    // Unit
    const unit = order.delivery_address.unit || '';
    if (unit) {
      text += marginLine(sanitizeForPrinter(`Unit ${unit}`)) + '\n';
    }
    
    // City, Province, Postal Code
    const city = order.delivery_address.city || '';
    const province = order.delivery_address.province || '';
    const postalCode = order.delivery_address.postal_code || 
                       order.delivery_address.postalCode || '';
    const cityLine = [city, province, postalCode].filter(Boolean).join(', ');
    if (cityLine) {
      text += marginLine(sanitizeForPrinter(cityLine)) + '\n';
    }
    
    text += dividerLine('-') + '\n';
    
    // Delivery instructions as separate section
    const instructions = order.delivery_address.instructions || 
                         order.delivery_address.delivery_instructions || '';
    if (instructions) {
      text += COMMANDS.BOLD_ON;
      text += marginLine('DELIVERY NOTE:') + '\n';
      text += COMMANDS.BOLD_OFF;
      const instructionLines = wrapText(instructions, PAPER_WIDTH - 2);
      instructionLines.forEach(line => {
        text += marginLine(sanitizeForPrinter(line)) + '\n';
      });
      text += dividerLine('-') + '\n';
    }
  }
  
  // ========== ITEMS ==========
  const itemCount = (order.items || []).reduce((sum, item) => sum + (item.quantity || 1), 0);
  text += '\n' + dividerLine('=') + '\n';
  text += centerText(`ITEMS (${itemCount})`) + '\n';
  text += dividerLine('=') + '\n';
  
  // Items with prices
  const items = order.items || [];
  items.forEach((item, index) => {
    const itemTotal = (item.price || 0) * (item.quantity || 1);
    const itemName = sanitizeForPrinter(item.name || 'Item');
    const itemLine = `${item.quantity}x ${itemName}`;
    const priceLine = `$${itemTotal.toFixed(2)}`;
    text += rightAlign(itemLine, priceLine) + '\n';
    
    // Modifiers - grouped by group_name, with placement, quantity, and price
    if (item.modifiers && item.modifiers.length > 0) {
      const groups = groupModifiers(item.modifiers);
      groups.forEach((group) => {
        if (group.groupName) {
          text += LEFT_MARGIN + '   ' + COMMANDS.BOLD_ON + sanitizeForPrinter(group.groupName).toUpperCase() + ':' + COMMANDS.BOLD_OFF + '\n';
        }
        group.modifiers.forEach((mod) => {
          const modPrice = mod.price > 0 ? `+$${mod.price.toFixed(2)}` : '';
          let placementText = '';
          if (mod.placement && mod.placement !== 'whole') {
            placementText = mod.placement === 'left' ? ' (L)' : ' (R)';
          }
          const modName = sanitizeForPrinter(mod.name);
          const hasQuantity = mod.quantity && mod.quantity > 1;
          const modQuantity = hasQuantity ? ` x${mod.quantity}` : '';
          
          text += LEFT_MARGIN + '   - ' + modName;
          if (hasQuantity) {
            text += COMMANDS.BOLD_ON;
            text += modQuantity;
            text += COMMANDS.BOLD_OFF;
          }
          text += placementText + ' ' + modPrice + '\n';
        });
      });
    }
    
    // Item notes with word wrap
    if (item.notes) {
      const noteLines = wrapText(item.notes, PAPER_WIDTH - 6);
      noteLines.forEach((line, idx) => {
        text += marginLine(idx === 0 ? `   >> ${line}` : `      ${line}`) + '\n';
      });
    }
    
    // Separator between items
    if (index < items.length - 1) {
      text += '\n';
    }
  });
  
  // ========== TOTALS ==========
  text += dividerLine('-') + '\n';
  text += rightAlign('Subtotal:', `$${(order.subtotal || 0).toFixed(2)}`) + '\n';
  text += rightAlign('Tax:', `$${(order.tax || 0).toFixed(2)}`) + '\n';
  if (order.delivery_fee && order.delivery_fee > 0) {
    text += rightAlign('Delivery:', `$${order.delivery_fee.toFixed(2)}`) + '\n';
  }
  if (order.tip && order.tip > 0) {
    text += rightAlign('Tip:', `$${order.tip.toFixed(2)}`) + '\n';
  }
  text += dividerLine('=') + '\n';
  
  // Grand total - slightly larger
  text += COMMANDS.BOLD_ON;
  text += rightAlign('TOTAL:', `$${(order.total || 0).toFixed(2)}`) + '\n';
  text += COMMANDS.BOLD_OFF;
  
  // Payment status
  text += centerText('--- PAID ---') + '\n';
  text += dividerLine('=') + '\n';
  
  // ========== ORDER NOTES ==========
  // Skip if delivery order AND notes are same as delivery instructions (avoid duplicates)
  const custDeliveryInstructions = order.delivery_address?.instructions || 
                                   order.delivery_address?.delivery_instructions || '';
  const custNotesAreSameAsDelivery = order.order_type === 'delivery' && 
                                      custDeliveryInstructions && 
                                      order.notes?.toLowerCase().includes(custDeliveryInstructions.toLowerCase().substring(0, 20));
  
  if (order.notes && !custNotesAreSameAsDelivery) {
    // Strip scheduled time and Twilio logs from notes
    let notesToDisplayReceipt = stripTwilioLogs(order.notes);
    if (scheduledFromNotesReceipt) {
      notesToDisplayReceipt = notesToDisplayReceipt
        .replace(/\|\s*Scheduled\s*for:\s*\d{4}-\d{2}-\d{2}T[\d:\.]+Z?\s*/gi, '')
        .replace(/Scheduled\s*for:\s*\d{4}-\d{2}-\d{2}T[\d:\.]+Z?\s*\|?\s*/gi, '')
        .trim();
    }
    
    // Only show notes section if there's content left after stripping
    if (notesToDisplayReceipt) {
      text += '\n';
      text += COMMANDS.BOLD_ON;
      text += marginLine('ORDER NOTES:') + '\n';
      text += COMMANDS.BOLD_OFF;
      const noteLines = wrapText(notesToDisplayReceipt, PAPER_WIDTH - 2);
      noteLines.forEach(line => {
        text += marginLine(sanitizeForPrinter(line)) + '\n';
      });
      text += dividerLine('-') + '\n';
    }
  }
  
  // ========== FOOTER ==========
  text += '\n';
  text += centerText('Thank you for your order!') + '\n';
  text += centerText('We appreciate your business.') + '\n';
  text += '\n';
  text += centerText(`Ref: ${fullOrderNum}`) + '\n';
  text += '\n' + dividerLine('=') + '\n';
  text += COMMANDS.FEED_LINES(8);
  text += COMMANDS.CUT_PAPER;
  
  return text;
};

// Track recently printed orders to prevent duplicates (order_id -> timestamp)
const recentlyPrintedKitchen: Map<string, number> = new Map();
const DUPLICATE_PREVENTION_WINDOW_MS = 10000; // 10 seconds

/**
 * Print a KITCHEN TICKET (for the cook board)
 * @returns {Promise<boolean>} true ONLY if print was actually sent to printer
 */
export const printKitchenTicket = async (order: Order): Promise<boolean> => {
  // DUPLICATE PREVENTION: Check if this order was printed in the last 10 seconds
  const lastPrintTime = recentlyPrintedKitchen.get(order.id);
  if (lastPrintTime && Date.now() - lastPrintTime < DUPLICATE_PREVENTION_WINDOW_MS) {
    console.warn('[PrintService] ⚠️ DUPLICATE BLOCKED - Kitchen ticket for', order.order_number, 'was printed', Math.round((Date.now() - lastPrintTime) / 1000), 'seconds ago');
    return true; // Return true to prevent retry loops
  }
  
  const ticketText = generateKitchenTicket(order);

  console.log('[PrintService] 🍳 Printing KITCHEN TICKET for order:', order.order_number);

  // CRITICAL: Verify actual connection, not just stored state
  if (!BLEPrinter) {
    console.error('[PrintService] ❌ Printer library not available - CANNOT PRINT');
    return false;
  }

  if (!printerConnected || !connectedPrinterAddress) {
    console.error('[PrintService] ❌ No printer connected - printerConnected:', printerConnected, 'address:', connectedPrinterAddress);
    return false;
  }

  try {
    console.log('[PrintService] 📤 Sending to printer...');
    await BLEPrinter.printText(ticketText, {
      encoding: 'UTF8',
      codepage: 0,
      widthtimes: 0,
      heigthtimes: 0,
      fonttype: 0,
    });
    
    // Track this print to prevent duplicates
    recentlyPrintedKitchen.set(order.id, Date.now());
    
    // Cleanup old entries (older than 1 minute)
    const oneMinuteAgo = Date.now() - 60000;
    recentlyPrintedKitchen.forEach((time, id) => {
      if (time < oneMinuteAgo) recentlyPrintedKitchen.delete(id);
    });
    
    console.log('[PrintService] ✓ Kitchen ticket PRINTED for order', order.order_number);
    return true;
  } catch (error: any) {
    console.error('[PrintService] ❌ Kitchen ticket print FAILED:', error?.message || error);
    // Mark as disconnected since print failed
    printerConnected = false;
    return false;
  }
};

// Track recently printed receipts to prevent duplicates
const recentlyPrintedReceipt: Map<string, number> = new Map();

/**
 * Print a CUSTOMER RECEIPT (for the bag/customer)
 * @returns {Promise<boolean>} true ONLY if print was actually sent to printer
 */
export const printCustomerReceipt = async (order: Order): Promise<boolean> => {
  // DUPLICATE PREVENTION: Check if this order was printed in the last 10 seconds
  const lastPrintTime = recentlyPrintedReceipt.get(order.id);
  if (lastPrintTime && Date.now() - lastPrintTime < DUPLICATE_PREVENTION_WINDOW_MS) {
    console.warn('[PrintService] ⚠️ DUPLICATE BLOCKED - Customer receipt for', order.order_number, 'was printed', Math.round((Date.now() - lastPrintTime) / 1000), 'seconds ago');
    return true; // Return true to prevent retry loops
  }
  
  const receiptText = generateReceiptText(order);

  console.log('[PrintService] 🧾 Printing CUSTOMER RECEIPT for order:', order.order_number);

  // CRITICAL: Verify actual connection, not just stored state
  if (!BLEPrinter) {
    console.error('[PrintService] ❌ Printer library not available - CANNOT PRINT');
    return false;
  }

  if (!printerConnected || !connectedPrinterAddress) {
    console.error('[PrintService] ❌ No printer connected - printerConnected:', printerConnected, 'address:', connectedPrinterAddress);
    return false;
  }

  try {
    console.log('[PrintService] 📤 Sending to printer...');
    await BLEPrinter.printText(receiptText, {
      encoding: 'UTF8',
      codepage: 0,
      widthtimes: 0,
      heigthtimes: 0,
      fonttype: 0,
    });
    
    // Track this print to prevent duplicates
    recentlyPrintedReceipt.set(order.id, Date.now());
    
    // Cleanup old entries (older than 1 minute)
    const oneMinuteAgo = Date.now() - 60000;
    recentlyPrintedReceipt.forEach((time, id) => {
      if (time < oneMinuteAgo) recentlyPrintedReceipt.delete(id);
    });
    
    console.log('[PrintService] ✓ Customer receipt PRINTED for order', order.order_number);
    return true;
  } catch (error: any) {
    console.error('[PrintService] ❌ Customer receipt print FAILED:', error?.message || error);
    // Mark as disconnected since print failed
    printerConnected = false;
    return false;
  }
};

/**
 * Print BOTH kitchen ticket and customer receipt
 * @returns {Promise<boolean>} true ONLY if BOTH prints succeeded
 */
export const printBoth = async (order: Order): Promise<boolean> => {
  console.log('[PrintService] 📋 Printing BOTH for order:', order.order_number);
  
  // Pre-check connection before attempting either print
  if (!BLEPrinter || !printerConnected || !connectedPrinterAddress) {
    console.error('[PrintService] ❌ Cannot print - no printer connected');
    return false;
  }
  
  const kitchenResult = await printKitchenTicket(order);
  
  if (!kitchenResult) {
    console.error('[PrintService] ❌ Kitchen ticket failed, skipping customer receipt');
    return false;
  }
  
  // Small pause between prints
  await new Promise(resolve => setTimeout(resolve, 500));
  
  const receiptResult = await printCustomerReceipt(order);
  
  const bothSucceeded = kitchenResult && receiptResult;
  console.log('[PrintService]', bothSucceeded ? '✓ Both prints succeeded' : '❌ One or more prints failed');
  
  return bothSucceeded;
};

/**
 * Print a test page
 * @returns {Promise<boolean>} true ONLY if test print was actually sent
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

  console.log('[PrintService] 🧪 Printing test page...');
  console.log('[PrintService] State check - BLEPrinter:', !!BLEPrinter, 'printerConnected:', printerConnected, 'address:', connectedPrinterAddress);

  // CRITICAL: Verify actual connection
  if (!BLEPrinter) {
    console.error('[PrintService] ❌ Printer library not available');
    return false;
  }

  if (!printerConnected || !connectedPrinterAddress) {
    console.error('[PrintService] ❌ No printer connected for test print - need to reconnect');
    return false;
  }

  try {
    // Re-initialize before printing to ensure connection is fresh
    console.log('[PrintService] 🔄 Re-initializing printer before test...');
    await BLEPrinter.init();
    
    console.log('[PrintService] 📤 Sending test text to printer...');
    await BLEPrinter.printText(testText, {});
    console.log('[PrintService] ✓ Test print command sent!');
    return true;
  } catch (error: any) {
    console.error('[PrintService] ❌ Test print FAILED:', error?.message || error);
    // Mark as disconnected since print failed
    printerConnected = false;
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
  getConnectedPrinterAddress,
  verifyConnection,
  ensureConnected,
};
