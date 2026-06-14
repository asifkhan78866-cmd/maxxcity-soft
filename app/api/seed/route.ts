import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Product } from '@/types';

const DEMO_PRODUCTS: Partial<Product>[] = [
  { name: 'Wireless Earbuds Pro', barcode: '8901234567890', category: 'Electronics', hsn_code: '8518', gst_rate: 18, price: 149, stock_qty: 45, low_stock_threshold: 20, is_active: true },
  { name: 'Phone Stand Holder', barcode: '8901234567891', category: 'Electronics', hsn_code: '8518', gst_rate: 18, price: 149, stock_qty: 30, low_stock_threshold: 20, is_active: true },
  { name: 'Kitchen Organizer Box', barcode: '8901234567892', category: 'Home & Kitchen', hsn_code: '3924', gst_rate: 12, price: 149, stock_qty: 60, low_stock_threshold: 20, is_active: true },
  { name: 'Stainless Steel Bottle', barcode: '8901234567893', category: 'Home & Kitchen', hsn_code: '7323', gst_rate: 12, price: 149, stock_qty: 80, low_stock_threshold: 20, is_active: true },
  { name: 'Cotton T-Shirt Basic', barcode: '8901234567894', category: 'Clothing', hsn_code: '6109', gst_rate: 5, price: 149, stock_qty: 2, low_stock_threshold: 20, is_active: true },
  { name: 'Handkerchief Set (3pc)', barcode: '8901234567895', category: 'Clothing', hsn_code: '6213', gst_rate: 5, price: 149, stock_qty: 50, low_stock_threshold: 20, is_active: true },
  { name: 'LED Desk Lamp Mini', barcode: '8901234567896', category: 'Electronics', hsn_code: '9405', gst_rate: 18, price: 149, stock_qty: 25, low_stock_threshold: 20, is_active: true },
  { name: 'Kids Toy Car Set', barcode: '8901234567899', category: 'Toys', hsn_code: '9503', gst_rate: 12, price: 149, stock_qty: 55, low_stock_threshold: 20, is_active: true },
  { name: 'Notebook A5 Pack', barcode: '8901234567900', category: 'Stationery', hsn_code: '4820', gst_rate: 12, price: 149, stock_qty: 90, low_stock_threshold: 20, is_active: true },
  { name: 'Face Wash Gel 100ml', barcode: '8901234567901', category: 'Personal Care', hsn_code: '3401', gst_rate: 18, price: 149, stock_qty: 70, low_stock_threshold: 20, is_active: true },
  { name: 'Diwali Lights (10m)', barcode: '8901234567902', category: 'Others', hsn_code: '9405', gst_rate: 18, price: 149, stock_qty: 15, low_stock_threshold: 20, is_active: true },
];

export async function POST() {
  try {
    const { createServiceRoleClient } = await import('@/lib/database');
    const supabase = createServiceRoleClient();

    // Upsert demo products by barcode to avoid duplicates
    const { data, error } = await supabase
      .from('products')
      .upsert(DEMO_PRODUCTS, { onConflict: 'barcode', ignoreDuplicates: true })
      .select();

    if (error) throw error;

    return NextResponse.json({ success: true, message: 'Database seeded with demo products successfully', data });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
