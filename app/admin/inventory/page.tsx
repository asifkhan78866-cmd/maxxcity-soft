'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatINR } from '@/lib/gst';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Search,
  Package,
  Plus,
  Upload,
  Download,
  Edit,
  AlertTriangle,
  Filter,
} from 'lucide-react';
import { toast } from 'sonner';

const PRODUCTS = [
  { id: 'p1', name: 'Wireless Earbuds Pro', barcode: '8901234567890', category: 'Electronics', hsn_code: '8518', gst_rate: 18, price: 149, stock_qty: 45, low_stock_threshold: 20 },
  { id: 'p2', name: 'Phone Stand Holder', barcode: '8901234567891', category: 'Electronics', hsn_code: '8518', gst_rate: 18, price: 149, stock_qty: 30, low_stock_threshold: 20 },
  { id: 'p3', name: 'Kitchen Organizer Box', barcode: '8901234567892', category: 'Home & Kitchen', hsn_code: '3924', gst_rate: 12, price: 149, stock_qty: 60, low_stock_threshold: 20 },
  { id: 'p4', name: 'Stainless Steel Bottle', barcode: '8901234567893', category: 'Home & Kitchen', hsn_code: '7323', gst_rate: 12, price: 149, stock_qty: 80, low_stock_threshold: 20 },
  { id: 'p5', name: 'Cotton T-Shirt Basic', barcode: '8901234567894', category: 'Clothing', hsn_code: '6109', gst_rate: 5, price: 149, stock_qty: 100, low_stock_threshold: 20 },
  { id: 'p6', name: 'Handkerchief Set (3pc)', barcode: '8901234567895', category: 'Clothing', hsn_code: '6213', gst_rate: 5, price: 149, stock_qty: 50, low_stock_threshold: 20 },
  { id: 'p7', name: 'LED Desk Lamp Mini', barcode: '8901234567896', category: 'Electronics', hsn_code: '9405', gst_rate: 18, price: 149, stock_qty: 25, low_stock_threshold: 20 },
  { id: 'p8', name: 'Wall Clock Modern', barcode: '8901234567897', category: 'Home & Kitchen', hsn_code: '9105', gst_rate: 12, price: 149, stock_qty: 35, low_stock_threshold: 20 },
  { id: 'p9', name: 'Sunglasses UV Protection', barcode: '8901234567898', category: 'Accessories', hsn_code: '9004', gst_rate: 12, price: 149, stock_qty: 40, low_stock_threshold: 20 },
  { id: 'p10', name: 'Kids Toy Car Set', barcode: '8901234567899', category: 'Toys', hsn_code: '9503', gst_rate: 12, price: 149, stock_qty: 55, low_stock_threshold: 20 },
  { id: 'p11', name: 'Notebook A5 Pack', barcode: '8901234567900', category: 'Stationery', hsn_code: '4820', gst_rate: 12, price: 149, stock_qty: 90, low_stock_threshold: 20 },
  { id: 'p12', name: 'Face Wash Gel 100ml', barcode: '8901234567901', category: 'Personal Care', hsn_code: '3401', gst_rate: 18, price: 149, stock_qty: 70, low_stock_threshold: 20 },
  { id: 'p13', name: 'USB Type-C Cable', barcode: '8901234567902', category: 'Electronics', hsn_code: '8544', gst_rate: 18, price: 149, stock_qty: 15, low_stock_threshold: 20 },
  { id: 'p14', name: 'Ceramic Mug Set', barcode: '8901234567903', category: 'Home & Kitchen', hsn_code: '6912', gst_rate: 12, price: 149, stock_qty: 8, low_stock_threshold: 20 },
  { id: 'p15', name: 'Hair Clips Combo', barcode: '8901234567904', category: 'Accessories', hsn_code: '9615', gst_rate: 12, price: 149, stock_qty: 120, low_stock_threshold: 20 },
];

const CATEGORIES = ['All', 'Electronics', 'Home & Kitchen', 'Clothing', 'Accessories', 'Toys', 'Stationery', 'Personal Care'];

export default function InventoryPage() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [showLowStock, setShowLowStock] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showStockDialog, setShowStockDialog] = useState<string | null>(null);
  const [stockAdjust, setStockAdjust] = useState('');

  const filtered = PRODUCTS.filter((p) => {
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.barcode.includes(search);
    const matchCategory = category === 'All' || p.category === category;
    const matchStock = !showLowStock || p.stock_qty <= p.low_stock_threshold;
    return matchSearch && matchCategory && matchStock;
  });

  const lowStockCount = PRODUCTS.filter((p) => p.stock_qty <= p.low_stock_threshold).length;
  const totalStock = PRODUCTS.reduce((sum, p) => sum + p.stock_qty, 0);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Inventory Management</h1>
          <p className="text-muted-foreground text-sm">
            {PRODUCTS.length} SKUs • {totalStock} total units • {lowStockCount} low stock
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-1.5">
            <Upload className="w-4 h-4" />
            Import CSV
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5">
            <Download className="w-4 h-4" />
            Export
          </Button>
          <Button size="sm" className="gap-1.5" onClick={() => setShowAddDialog(true)}>
            <Plus className="w-4 h-4" />
            Add Product
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Total SKUs</p>
          <p className="text-2xl font-bold mt-1">{PRODUCTS.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Total Stock</p>
          <p className="text-2xl font-bold mt-1">{totalStock}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Stock Value</p>
          <p className="text-2xl font-bold mt-1">{formatINR(totalStock * 149)}</p>
        </Card>
        <Card className="p-4 border-destructive/20">
          <p className="text-sm text-muted-foreground flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5 text-destructive" /> Low Stock
          </p>
          <p className="text-2xl font-bold mt-1 text-destructive">{lowStockCount}</p>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search products or scan barcode..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex gap-1.5">
          {CATEGORIES.map((cat) => (
            <Button
              key={cat}
              size="sm"
              variant={category === cat ? 'default' : 'outline'}
              className="text-xs h-8"
              onClick={() => setCategory(cat)}
            >
              {cat}
            </Button>
          ))}
        </div>
        <Button
          size="sm"
          variant={showLowStock ? 'destructive' : 'outline'}
          className="gap-1 text-xs h-8"
          onClick={() => setShowLowStock(!showLowStock)}
        >
          <Filter className="w-3 h-3" />
          Low Stock
        </Button>
      </div>

      {/* Products Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>Barcode</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>HSN</TableHead>
              <TableHead className="text-center">GST</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-center">Stock</TableHead>
              <TableHead className="text-center">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((product) => (
              <TableRow key={product.id} className={product.stock_qty <= product.low_stock_threshold ? 'bg-destructive/5' : ''}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Package className="w-4 h-4 text-muted-foreground" />
                    <span className="font-medium">{product.name}</span>
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs">{product.barcode}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-xs">{product.category}</Badge>
                </TableCell>
                <TableCell className="text-xs">{product.hsn_code}</TableCell>
                <TableCell className="text-center">
                  <Badge variant="secondary" className="text-xs">{product.gst_rate}%</Badge>
                </TableCell>
                <TableCell className="text-right font-medium">{formatINR(product.price)}</TableCell>
                <TableCell className="text-center">
                  <Badge variant={product.stock_qty <= product.low_stock_threshold ? 'destructive' : 'default'} className="min-w-[3rem]">
                    {product.stock_qty}
                  </Badge>
                </TableCell>
                <TableCell className="text-center">
                  <div className="flex items-center justify-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2"
                      onClick={() => { setShowStockDialog(product.id); setStockAdjust(''); }}
                    >
                      <Edit className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* Add Product Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Product</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-4">
            <div className="col-span-2">
              <Label>Product Name</Label>
              <Input placeholder="Enter product name..." className="mt-1" />
            </div>
            <div>
              <Label>Barcode</Label>
              <Input placeholder="Scan or enter..." className="mt-1" />
            </div>
            <div>
              <Label>Category</Label>
              <Input placeholder="Select category..." className="mt-1" />
            </div>
            <div>
              <Label>HSN Code</Label>
              <Input placeholder="Enter HSN..." className="mt-1" />
            </div>
            <div>
              <Label>GST Rate (%)</Label>
              <Input type="number" placeholder="12" className="mt-1" />
            </div>
            <div>
              <Label>Initial Stock</Label>
              <Input type="number" placeholder="0" className="mt-1" />
            </div>
            <div>
              <Label>Low Stock Threshold</Label>
              <Input type="number" placeholder="20" className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
            <Button onClick={() => { setShowAddDialog(false); toast.success('Product added!'); }}>
              Add Product
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Stock Adjustment Dialog */}
      <Dialog open={!!showStockDialog} onOpenChange={() => setShowStockDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Adjust Stock</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div>
              <Label>Adjustment (+ to add, - to remove)</Label>
              <Input
                type="number"
                placeholder="+50 or -10"
                value={stockAdjust}
                onChange={(e) => setStockAdjust(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowStockDialog(null)}>Cancel</Button>
            <Button onClick={() => { setShowStockDialog(null); toast.success('Stock updated!'); }}>
              Update Stock
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
