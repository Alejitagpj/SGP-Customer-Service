import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../../context/AppContext';
import sgpApi from '../../../lib/supabase';
import type { Order, Store } from '../../../types';
import { LogOut, Layers, Download, Clock, BarChart3, QrCode, X, Copy } from 'lucide-react';
import notificationService from '../../../services/notifications';

const formatCurrency = (value: number) => `$${value.toFixed(2)}`;

const isSameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

const isCurrentMonth = (date: Date) => {
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
};

const buildCsv = (rows: any[][]) => {
  const separator = ',';
  const quoted = rows.map(row =>
    row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(separator)
  );
  return `sep=${separator}\n${quoted.join('\n')}`;
};

const downloadCsv = (filename: string, rows: any[][]) => {
  const csv = buildCsv(rows);
  const blob = new Blob([csv], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const AdminDashboard: React.FC = () => {
  const navigate = useNavigate();
  const { staffRole, logoutStaff } = useApp();
  const [stores, setStores] = useState<Store[]>([]);
  const [storeOrders, setStoreOrders] = useState<Record<string, Order[]>>({});
  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null);
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [showQRModal, setShowQRModal] = useState(false);
  const [qrCodes, setQrCodes] = useState<any[]>([]);
  const [generatingQR, setGeneratingQR] = useState(false);

  useEffect(() => {
    if (!staffRole || staffRole !== 'admin') {
      navigate('/login');
    }
  }, [staffRole, navigate]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      const { data: storesData } = await sgpApi.getStores();
      if (!mounted) return;
      const items = storesData || [];
      setStores(items);
      if (items.length > 0) {
        setSelectedBrandId(items[0].brand_id || items[0].id);
      }

      const map: Record<string, Order[]> = {};
      await Promise.all(
        items.map(async store => {
          const { data: orders } = await sgpApi.getStoreOrders(store.id);
          map[store.id] = orders || [];
        })
      );

      if (!mounted) return;
      setStoreOrders(map);
      setLoading(false);
    };

    load();
    return () => {
      mounted = false;
    };
  }, []);

  const brands = useMemo(() => {
    const grouped = new Map<string, { brandId: string; brandName: string; stores: Store[] }>();
    stores.forEach(store => {
      const brandId = store.brand_id || store.id;
      const brandName = store.brand_name || store.name;
      if (!grouped.has(brandId)) {
        grouped.set(brandId, { brandId, brandName, stores: [] });
      }
      grouped.get(brandId)!.stores.push(store);
    });
    return Array.from(grouped.values());
  }, [stores]);

  const currentBrand = useMemo(() => {
    return brands.find(brand => brand.brandId === selectedBrandId) || brands[0] || null;
  }, [brands, selectedBrandId]);

  const currentStores = currentBrand ? currentBrand.stores : stores;

  const selectedStore = currentStores.find(s => s.id === selectedStoreId) || null;

  const visibleStores = selectedStore ? [selectedStore] : currentStores;

  const allOrders = useMemo(() => {
    return visibleStores.flatMap(store => storeOrders[store.id] || []);
  }, [visibleStores, storeOrders]);

  const todayOrders = useMemo(() => {
    return allOrders.filter(order => isSameDay(new Date(order.created_at), new Date()));
  }, [allOrders]);

  const monthOrders = useMemo(() => {
    return allOrders.filter(order => isCurrentMonth(new Date(order.created_at)));
  }, [allOrders]);

  const dailyHours = useMemo(() => {
    const counts: Record<number, number> = {};
    todayOrders.forEach(order => {
      const hour = new Date(order.created_at).getHours();
      counts[hour] = (counts[hour] || 0) + 1;
    });
    return Array.from({ length: 24 }, (_, hour) => ({ hour, count: counts[hour] || 0 }));
  }, [todayOrders]);

  const summary = useMemo(() => {
    const totalOrders = monthOrders.length;
    const totalRevenue = monthOrders.reduce((sum, order) => sum + (order.total_amount || 0), 0);
    const avgTicket = totalOrders ? totalRevenue / totalOrders : 0;
    
    // Calculate average wait times for delivered orders
    const deliveredOrders = monthOrders.filter(o => o.delivered_at);
    const avgWaitTime = deliveredOrders.length > 0 
      ? deliveredOrders.reduce((sum, order) => {
          const created = new Date(order.created_at).getTime();
          const delivered = new Date(order.delivered_at!).getTime();
          return sum + (delivered - created);
        }, 0) / deliveredOrders.length / 60000 // convert to minutes
      : 0;

    // Top products
    const productCounts: Record<string, { name: string; count: number; revenue: number }> = {};
    monthOrders.forEach(order => {
      order.items?.forEach(item => {
        const key = item.product_id;
        if (!productCounts[key]) {
          productCounts[key] = { name: item.product_name || 'Producto', count: 0, revenue: 0 };
        }
        productCounts[key].count += item.quantity;
        productCounts[key].revenue += item.unit_price * item.quantity;
      });
    });
    
    const topProducts = Object.values(productCounts)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    return { 
      totalOrders, 
      totalRevenue, 
      avgTicket,
      avgWaitTime: Math.round(avgWaitTime),
      topProducts,
      deliveredCount: deliveredOrders.length
    };
  }, [monthOrders]);

  const handleExport = () => {
    setExporting(true);
    const now = new Date();
    const rows: any[][] = [
      ['Restaurante', 'Sucursal', 'Orden ID', 'Fecha', 'Hora', 'Mesa', 'Estado', 'Total', 'Items', 'Notas']
    ];

    monthOrders.forEach(order => {
      const store = visibleStores.find(store => store.id === order.store_id);
      const itemText = order.items?.map(item => `${item.quantity}x ${item.product_name || item.product_id}`).join('; ') || '';
      rows.push([
        store?.brand_name || store?.name || 'Sin nombre',
        store?.name || 'Sucursal',
        order.id,
        new Date(order.created_at).toLocaleDateString(),
        new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        order.table_name || 'Mesa',
        order.status,
        formatCurrency(order.total_amount || 0),
        itemText,
        order.notes || ''
      ]);
    });

    downloadCsv(`reporte-mensual-${now.getFullYear()}-${now.getMonth() + 1}.csv`, rows);
    notificationService.playChime('success');
    setExporting(false);
  };

  const handleGenerateQRCodes = async () => {
    if (!selectedStore) return;
    setGeneratingQR(true);
    try {
      const baseUrl = window.location.origin;
      const { data, error } = await sgpApi.generateQRCodes(selectedStore.id, baseUrl);
      if (error) {
        notificationService.sendDesktopNotification('Error', 'No se pudieron generar los códigos QR');
      } else {
        setQrCodes(data || []);
        setShowQRModal(true);
        notificationService.playChime('success');
      }
    } catch (err) {
      console.error('Error generating QR codes:', err);
    } finally {
      setGeneratingQR(false);
    }
  };

  const downloadQRsAsHTML = () => {
    if (!selectedStore || qrCodes.length === 0) return;

    const now = new Date();
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Códigos QR - ${selectedStore.name}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 { text-align: center; color: #333; }
    .qr-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; margin-top: 30px; }
    .qr-card { background: white; border: 2px solid #ddd; border-radius: 10px; padding: 20px; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .qr-card h3 { margin: 0 0 10px 0; color: #333; font-size: 18px; }
    .qr-code { width: 200px; height: 200px; margin: 0 auto 15px; }
    .passcode { font-size: 24px; font-weight: bold; color: #007bff; margin: 10px 0; font-family: monospace; }
    .url { font-size: 12px; color: #666; word-break: break-all; margin-top: 10px; }
    .footer { text-align: center; margin-top: 40px; font-size: 12px; color: #999; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Códigos QR - ${selectedStore.name}</h1>
    <p style="text-align: center; color: #666;">Generado: ${now.toLocaleString()}</p>
    <div class="qr-grid">
      ${qrCodes.map(qr => {
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qr.qr_url)}`;
        return `
      <div class="qr-card">
        <h3>Mesa ${qr.table_id.split('-')[1]}</h3>
        <img src="${qrUrl}" alt="QR Code" class="qr-code">
        <div class="passcode">${qr.passcode}</div>
        <div class="url">${qr.qr_url}</div>
      </div>
        `;
      }).join('')}
    </div>
    <div class="footer">
      <p>Imprime esta página para obtener los códigos QR de las mesas.</p>
    </div>
  </div>
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `qr-codes-${selectedStore.id}-${now.getTime()}.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (!staffRole || staffRole !== 'admin') return null;

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
        <div className="rounded-3xl border border-neutral-800 bg-neutral-900 p-8 text-center">
          <div className="mb-4 text-brand-400">Cargando datos del administrador...</div>
          <div className="h-2 w-48 rounded-full bg-neutral-800 animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <header className="bg-neutral-900 border-b border-neutral-800 px-6 py-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Layers className="w-5 h-5 text-brand-400" />
            Panel de Administrador Multi-Tienda
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Revisa restaurantes, sucursales, órdenes del día y genera el informe mensual descargable.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            onClick={handleExport}
            disabled={exporting || monthOrders.length === 0}
            className="inline-flex items-center gap-2 rounded-2xl bg-brand-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            {exporting ? 'Exportando...' : 'Excel'}
          </button>
          {selectedStore && (
            <button
              onClick={handleGenerateQRCodes}
              disabled={generatingQR}
              className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <QrCode className="w-4 h-4" />
              {generatingQR ? 'Generando...' : 'Generar QR'}
            </button>
          )}
          <button
            onClick={() => { logoutStaff(); navigate('/login'); }}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-800 bg-neutral-900 px-4 py-2 text-sm text-slate-300 hover:border-slate-700 hover:text-white"
          >
            <LogOut className="w-4 h-4" />
            Cerrar sesión
          </button>
        </div>
      </header>

      <main className="flex-1 p-6 overflow-x-hidden">
        <div className="grid gap-6 xl:grid-cols-[280px_1fr]">
          <aside className="space-y-6">
            <section className="rounded-3xl border border-neutral-800 bg-neutral-900 p-5">
              <h2 className="text-sm font-semibold text-slate-200 mb-4">Restaurantes</h2>
              <div className="space-y-3">
                {brands.map(brand => (
                  <button
                    key={brand.brandId}
                    onClick={() => { setSelectedBrandId(brand.brandId); setSelectedStoreId(null); }}
                    className={`w-full text-left rounded-2xl px-4 py-3 transition ${brand.brandId === selectedBrandId ? 'bg-brand-500/10 border border-brand-500 text-brand-200' : 'border border-neutral-800 hover:border-neutral-700'}`}
                  >
                    <p className="text-sm font-semibold">{brand.brandName}</p>
                    <p className="text-xs text-slate-400">Sucursales: {brand.stores.length}</p>
                  </button>
                ))}
              </div>
            </section>

            {currentBrand && (
              <section className="rounded-3xl border border-neutral-800 bg-neutral-900 p-5">
                <h2 className="text-sm font-semibold text-slate-200 mb-4">Sucursales de {currentBrand.brandName}</h2>
                <div className="space-y-3">
                  {currentStores.map(store => (
                    <button
                      key={store.id}
                      onClick={() => setSelectedStoreId(store.id)}
                      className={`w-full text-left rounded-2xl px-4 py-3 transition ${store.id === selectedStoreId ? 'bg-slate-800 border border-slate-600 text-white' : 'border border-neutral-800 hover:border-neutral-700 text-slate-300'}`}
                    >
                      <p className="text-sm font-semibold">{store.name}</p>
                      <p className="text-xs text-slate-400">PIN: {store.pin_code}</p>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </aside>

          <section className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-3xl border border-neutral-800 bg-neutral-900 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Órdenes este mes</p>
                <p className="mt-3 text-3xl font-bold text-white">{summary.totalOrders}</p>
              </div>
              <div className="rounded-3xl border border-neutral-800 bg-neutral-900 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Ingresos mes</p>
                <p className="mt-3 text-3xl font-bold text-emerald-400">{formatCurrency(summary.totalRevenue)}</p>
              </div>
              <div className="rounded-3xl border border-neutral-800 bg-neutral-900 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Ticket promedio</p>
                <p className="mt-3 text-3xl font-bold text-slate-100">{formatCurrency(summary.avgTicket)}</p>
              </div>
              <div className="rounded-3xl border border-neutral-800 bg-neutral-900 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Espera promedio</p>
                <p className="mt-3 text-3xl font-bold text-blue-400">{summary.avgWaitTime} min</p>
              </div>
              <div className="rounded-3xl border border-neutral-800 bg-neutral-900 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Órdenes entregadas</p>
                <p className="mt-3 text-3xl font-bold text-cyan-400">{summary.deliveredCount}</p>
              </div>
            </div>

            <div className="rounded-3xl border border-neutral-800 bg-neutral-900 p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-base font-semibold text-white">Productos Top 5</h3>
                  <p className="text-xs text-slate-500 mt-1">Más vendidos este mes (por ingresos)</p>
                </div>
                <BarChart3 className="w-5 h-5 text-slate-400" />
              </div>
              <div className="space-y-3">
                {summary.topProducts.length > 0 ? (
                  summary.topProducts.map((product, idx) => (
                    <div key={idx} className="flex items-center gap-3 text-xs text-slate-400">
                      <span className="w-6 font-bold text-brand-400">#{idx + 1}</span>
                      <span className="flex-1">{product.name}</span>
                      <div className="text-right">
                        <div className="font-bold text-white">{formatCurrency(product.revenue)}</div>
                        <div className="text-[10px] text-slate-500">{product.count} unidades</div>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-slate-500">Sin datos de productos</p>
                )}
              </div>
            </div>

            <div className="rounded-3xl border border-neutral-800 bg-neutral-900 p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-base font-semibold text-white">Horas más activas</h3>
                  <p className="text-xs text-slate-500 mt-1">Pedidos del día agrupados por hora</p>
                </div>
                <Clock className="w-5 h-5 text-slate-400" />
              </div>
              <div className="space-y-3">
                {dailyHours.map(hour => (
                  <div key={hour.hour} className="flex items-center gap-3 text-xs text-slate-400">
                    <span className="w-14">{hour.hour}:00</span>
                    <div className="h-2.5 flex-1 rounded-full bg-neutral-800 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-brand-500"
                        style={{ width: `${Math.min(100, hour.count * 12)}%` }}
                      />
                    </div>
                    <span className="w-8 text-right text-slate-300">{hour.count}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-neutral-800 bg-neutral-900 p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-base font-semibold text-white">Órdenes recientes</h3>
                  <p className="text-xs text-slate-500 mt-1">Últimas 15 órdenes de las sucursales seleccionadas</p>
                </div>
                <BarChart3 className="w-5 h-5 text-slate-400" />
              </div>

              <div className="space-y-3">
                {allOrders.slice(0, 15).map(order => (
                  <div key={order.id} className="rounded-2xl border border-neutral-800 bg-slate-950 p-4">
                    <div className="flex justify-between gap-3 items-start">
                      <div>
                        <p className="text-sm font-semibold text-white">Orden {order.id.slice(0, 8)}</p>
                        <p className="text-[11px] text-slate-500 mt-1">{order.table_name || 'Mesa'} · {new Date(order.created_at).toLocaleString()}</p>
                      </div>
                      <span className="text-xs font-semibold text-slate-300 uppercase">{order.status}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-400">
                      <span>Total: {formatCurrency(order.total_amount || 0)}</span>
                      <span>Items: {order.items?.length || 0}</span>
                      <span>Sucursal: {stores.find(s => s.id === order.store_id)?.name || 'N/A'}</span>
                    </div>
                  </div>
                ))}

                {allOrders.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-neutral-700 bg-neutral-950 p-6 text-center text-sm text-slate-500">
                    No hay órdenes registradas para esta selección.
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      </main>

      {/* QR Codes Modal */}
      {showQRModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 flex items-center justify-between p-6 border-b border-neutral-800 bg-neutral-900">
              <h2 className="text-lg font-bold text-white">Códigos QR generados</h2>
              <button onClick={() => setShowQRModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6">
              <p className="text-sm text-slate-300 mb-6">
                Se han generado {qrCodes.length} códigos QR para <strong>{selectedStore?.name}</strong>. 
                Descarga la página HTML para imprimir.
              </p>

              <div className="space-y-3 max-h-[400px] overflow-y-auto mb-6">
                {qrCodes.map((qr, idx) => (
                  <div key={idx} className="flex items-center gap-3 rounded-lg bg-slate-950 p-3">
                    <div>
                      <p className="text-sm font-semibold text-white">Código QR #{idx + 1}</p>
                      <p className="text-xs text-slate-400">Passcode: <code className="bg-neutral-800 px-2 py-1 rounded">{qr.passcode}</code></p>
                    </div>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(qr.qr_url);
                        notificationService.playChime('success');
                      }}
                      className="ml-auto flex items-center gap-2 text-xs text-brand-400 hover:text-brand-300"
                    >
                      <Copy className="w-4 h-4" />
                      Copiar URL
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={downloadQRsAsHTML}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-brand-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-brand-400"
                >
                  <Download className="w-4 h-4" />
                  Descargar HTML para Imprimir
                </button>
                <button
                  onClick={() => setShowQRModal(false)}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-800 bg-neutral-900 px-4 py-3 text-sm text-slate-300 hover:border-slate-700 hover:text-white"
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;
