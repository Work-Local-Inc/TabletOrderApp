/**
 * Thermal Printer Service for ESC/POS Compatible Printers
 *
 * This service handles printing order receipts to 80mm thermal printers
 * connected via USB or Bluetooth.
 *
 * NOTE: For actual printing, you'll need to add a native printing library.
 * Options include:
 * - react-native-thermal-receipt-printer-image-qr
 * - react-native-bluetooth-escpos-printer
 * - react-native-esc-pos-printer
 *
 * This file provides the ESC/POS formatting logic that can be used
 * with any of these libraries.
 */

import { Order, OrderItem } from '../types';

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
 * Print an order receipt
 *
 * NOTE: This is a placeholder implementation.
 * You'll need to integrate with an actual printing library like:
 * - react-native-thermal-receipt-printer-image-qr
 * - react-native-bluetooth-escpos-printer
 *
 * Example with react-native-thermal-receipt-printer-image-qr:
 * ```
 * import { USBPrinter, BLEPrinter } from 'react-native-thermal-receipt-printer-image-qr';
 *
 * export const printOrder = async (order: Order): Promise<void> => {
 *   const receiptData = generateReceiptData(order);
 *   await USBPrinter.printRaw(receiptData);
 * };
 * ```
 */
export const printOrder = async (order: Order): Promise<void> => {
  const receiptData = generateReceiptData(order);

  // Log receipt data for development
  console.log('=== RECEIPT DATA ===');
  console.log(receiptData.replace(/[\x00-\x1F]/g, '')); // Remove ESC/POS commands for logging
  console.log('===================');

  // TODO: Integrate with actual printer library
  // For now, simulate a print delay
  return new Promise((resolve) => {
    setTimeout(resolve, 1000);
  });
};

/**
 * Print a test page
 */
export const printTestPage = async (): Promise<void> => {
  const testData = generateTestReceipt();

  console.log('=== TEST RECEIPT ===');
  console.log(testData.replace(/[\x00-\x1F]/g, ''));
  console.log('====================');

  // TODO: Integrate with actual printer library
  return new Promise((resolve) => {
    setTimeout(resolve, 1000);
  });
};

/**
 * Discover available printers
 */
export const discoverPrinters = async (): Promise<string[]> => {
  // TODO: Implement printer discovery
  // This would typically scan for USB and Bluetooth printers

  console.log('Discovering printers...');

  return new Promise((resolve) => {
    setTimeout(() => {
      resolve([]);
    }, 2000);
  });
};

/**
 * Connect to a specific printer
 */
export const connectPrinter = async (printerId: string): Promise<boolean> => {
  // TODO: Implement printer connection
  console.log(`Connecting to printer: ${printerId}`);

  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(false);
    }, 1000);
  });
};

export default {
  printOrder,
  printTestPage,
  generateReceiptData,
  generateTestReceipt,
  discoverPrinters,
  connectPrinter,
};
