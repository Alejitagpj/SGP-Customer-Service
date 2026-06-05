require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Supabase credentials not found in environment. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY or SUPABASE_URL/SUPABASE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

(async () => {
  try {
    const now = new Date();
    // compute yesterday UTC range
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
    const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);

    const startISO = start.toISOString();
    const endISO = end.toISOString();

    console.log('Aggregating orders from', startISO, 'to', endISO);

    const { data: orders, error: ordersErr } = await supabase
      .from('orders')
      .select('id,store_id,created_at, items:order_items(id,product_id,quantity)')
      .gte('created_at', startISO)
      .lt('created_at', endISO);

    if (ordersErr) throw ordersErr;
    if (!orders || orders.length === 0) {
      console.log('No orders for the range. Nothing to do.');
      process.exit(0);
    }

    const aggMap = new Map(); // key: store|date|hour|product -> qty
    const orderIds = [];

    orders.forEach(o => {
      orderIds.push(o.id);
      const created = new Date(o.created_at);
      const saleDate = created.toISOString().slice(0,10);
      const hour = created.getUTCHours();
      const items = o.items || [];
      items.forEach(it => {
        const key = `${o.store_id}|${saleDate}|${hour}|${it.product_id}`;
        const prev = aggMap.get(key) || 0;
        aggMap.set(key, prev + (it.quantity || 0));
      });
    });

    const rows = [];
    for (const [key, qty] of aggMap.entries()) {
      const [store_id, sale_date, sale_hour, product_id] = key.split('|');
      rows.push({ store_id, sale_date, sale_hour: parseInt(sale_hour,10), product_id, quantity: qty });
    }

    // Insert aggregated rows
    const { data: inserted, error: insertErr } = await supabase.from('daily_sales').insert(rows);
    if (insertErr) throw insertErr;
    console.log('Inserted', inserted?.length || rows.length, 'daily_sales rows');

    // Delete old orders and items (keep sessions)
    const { error: delItemsErr } = await supabase.from('order_items').delete().in('order_id', orderIds);
    if (delItemsErr) throw delItemsErr;
    const { error: delOrdersErr } = await supabase.from('orders').delete().in('id', orderIds);
    if (delOrdersErr) throw delOrdersErr;

    console.log('Deleted processed orders and order_items for the day');
    process.exit(0);
  } catch (err) {
    console.error('Daily aggregation failed:', err);
    process.exit(2);
  }
})();
