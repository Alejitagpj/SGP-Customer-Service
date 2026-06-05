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
    const today = new Date();
    const day = today.getUTCDate();
    if (day !== 2) {
      console.log('Cleanup script intended to run on day 2 of month. Today is', day, '— exiting.');
      process.exit(0);
    }

    console.log('Running monthly cleanup (day 2) — removing transactional data older than 1 month');
    const cutoff = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth()-1, today.getUTCDate()));
    const cutoffISO = cutoff.toISOString();

    // Delete order_items and orders older than cutoff
    const { data: oldOrders } = await supabase.from('orders').select('id').lt('created_at', cutoffISO);
    const oldOrderIds = (oldOrders || []).map(o => o.id);
    if (oldOrderIds.length > 0) {
      const { error: delItemsErr } = await supabase.from('order_items').delete().in('order_id', oldOrderIds);
      if (delItemsErr) console.warn('Error deleting old order_items:', delItemsErr.message || delItemsErr);
      const { error: delOrdersErr } = await supabase.from('orders').delete().in('id', oldOrderIds);
      if (delOrdersErr) console.warn('Error deleting old orders:', delOrdersErr.message || delOrdersErr);
      console.log('Deleted', oldOrderIds.length, 'orders older than cutoff');
    } else {
      console.log('No old orders to delete');
    }

    // Delete table_sessions older than cutoff
    const { error: delSessionsErr } = await supabase.from('table_sessions').delete().lt('created_at', cutoffISO);
    if (delSessionsErr) console.warn('Error deleting old sessions:', delSessionsErr.message || delSessionsErr);

    // Delete daily_sales older than 2 months
    const cutoff2 = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth()-2, today.getUTCDate())).toISOString().slice(0,10);
    const { error: delDailyErr } = await supabase.from('daily_sales').delete().lt('sale_date', cutoff2);
    if (delDailyErr) console.warn('Error deleting old daily_sales:', delDailyErr.message || delDailyErr);

    console.log('Monthly cleanup finished.');
    process.exit(0);
  } catch (err) {
    console.error('Monthly cleanup failed:', err);
    process.exit(2);
  }
})();
