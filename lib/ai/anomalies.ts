// ═══════════════════════════════════════
// Anomaly Detection Engine
// ═══════════════════════════════════════
// Pure logic engine to flag unusual retail activity

export interface AnomalyAlert {
  type: 'VOID_RATE' | 'CASH_VARIANCE' | 'UNUSUAL_SCAN' | 'REVENUE_DROP' | 'INVENTORY_DISCREPANCY';
  severity: 'WARNING' | 'CRITICAL';
  description: string;
  shift_id?: string;
  cashier_id?: string;
}

export function detectShiftAnomalies(
  shift: any,
  sales: any[],
  historicalSales: any[]
): AnomalyAlert[] {
  const anomalies: AnomalyAlert[] = [];
  const shiftId = shift.id;
  const cashierId = shift.cashier_id;

  // 1. VOID RATE ANOMALY
  // Normal: < 1 void per 50 transactions
  const voidSales = sales.filter(s => s.status === 'VOID');
  if (voidSales.length > 3) {
    anomalies.push({
      type: 'VOID_RATE',
      severity: voidSales.length >= 6 ? 'CRITICAL' : 'WARNING',
      description: `High void rate detected: ${voidSales.length} voided transactions in this shift.`,
      shift_id: shiftId,
      cashier_id: cashierId,
    });
  }

  // 2. CASH VARIANCE ANOMALY
  // Normal: exact match or small rounding diff
  if (shift.discrepancy !== null && shift.discrepancy !== undefined) {
    const variance = Math.abs(Number(shift.discrepancy));
    if (variance > 50) {
      anomalies.push({
        type: 'CASH_VARIANCE',
        severity: variance > 200 ? 'CRITICAL' : 'WARNING',
        description: `Closing cash variance of ₹${variance.toLocaleString('en-IN')}. Expected: ₹${shift.expected_cash}, Actual: ₹${shift.closing_cash}.`,
        shift_id: shiftId,
        cashier_id: cashierId,
      });
    }
  }

  // 3. UNUSUAL SCAN PATTERN
  // Normal: max 5-10 of same item. >15 is suspicious (phantom sales)
  sales.forEach(sale => {
    if (sale.sale_items) {
      sale.sale_items.forEach((item: any) => {
        if (item.qty > 15) {
          anomalies.push({
            type: 'UNUSUAL_SCAN',
            severity: 'WARNING',
            description: `Suspicious quantity: ${item.qty} units of "${item.product_name}" in a single transaction (Invoice: ${sale.invoice_number}).`,
            shift_id: shiftId,
            cashier_id: cashierId,
          });
        }
      });
    }
  });

  // 4. REVENUE ANOMALY (vs Historical Average for this shift time)
  // Check if hourly revenue drops > 60% compared to last week
  if (shift.total_sales > 0 && historicalSales.length > 0) {
    // simplified check: just compare shift total to average shift total from history
    const histAvg = historicalSales.reduce((sum, s) => sum + Number(s.grand_total), 0) / Math.max(1, historicalSales.length);
    // Assuming historicalSales passed here are from similar shifts
    if (histAvg > 5000 && shift.total_sales < histAvg * 0.4) {
      anomalies.push({
        type: 'REVENUE_DROP',
        severity: 'WARNING',
        description: `Shift revenue (₹${shift.total_sales}) is >60% below the historical average (₹${histAvg.toFixed(2)}) for similar periods.`,
        shift_id: shiftId,
        cashier_id: cashierId,
      });
    }
  }

  return anomalies;
}

export function detectInventoryAnomalies(
  products: any[],
  nightlyAuditResults: any[] // e.g., [{ product_id, expected, actual }]
): AnomalyAlert[] {
  const anomalies: AnomalyAlert[] = [];

  nightlyAuditResults.forEach(audit => {
    const product = products.find(p => p.id === audit.product_id);
    if (!product) return;

    if (audit.expected > 0) {
      const discrepancyPct = Math.abs(audit.expected - audit.actual) / audit.expected;
      if (discrepancyPct > 0.05) {
        anomalies.push({
          type: 'INVENTORY_DISCREPANCY',
          severity: discrepancyPct > 0.1 ? 'CRITICAL' : 'WARNING',
          description: `Inventory mismatch for "${product.name}". Expected: ${audit.expected}, Actual: ${audit.actual}.`,
        });
      }
    }
  });

  return anomalies;
}
