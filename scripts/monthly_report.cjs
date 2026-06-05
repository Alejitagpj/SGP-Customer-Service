require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts } = require('pdf-lib');

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
    // target previous month
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const monthLabel = monthStart.toISOString().slice(0,7);

    console.log('Generating monthly report for', monthLabel);

    // fetch aggregated daily sales in range
    const { data, error } = await supabase
      .from('daily_sales')
      .select('store_id, sale_date, sale_hour, product_id, quantity')
      .gte('sale_date', monthStart.toISOString().slice(0,10))
      .lt('sale_date', monthEnd.toISOString().slice(0,10));

    if (error) throw error;
    if (!data || data.length === 0) {
      console.log('No daily sales for month, nothing to report.');
      process.exit(0);
    }

    // aggregate totals per store/product
    const storeMap = new Map(); // store -> product -> qty

    for (const row of data) {
      const store = row.store_id;
      const prod = row.product_id;
      const qty = row.quantity || 0;
      if (!storeMap.has(store)) storeMap.set(store, new Map());
      const prodMap = storeMap.get(store);
      prodMap.set(prod, (prodMap.get(prod) || 0) + qty);
    }

    // prepare CSV and JSON report
    const reportsDir = path.resolve(__dirname, '../qrcodes/reports');
    if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
    const csvPath = path.join(reportsDir, `monthly_report_${monthLabel}.csv`);
    const csvLines = ['store_id,product_id,total_quantity'];

    const reportJson = {};

    for (const [store, prodMap] of storeMap.entries()) {
      reportJson[store] = [];
      for (const [prod, qty] of Array.from(prodMap.entries()).sort((a,b)=>b[1]-a[1])) {
        csvLines.push(`${store},${prod},${qty}`);
        reportJson[store].push({ product_id: prod, total: qty });
      }
    }

    fs.writeFileSync(csvPath, csvLines.join('\n'));
    console.log('Wrote CSV to', csvPath);

    // create a simple PDF summary
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([600, 800]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    let y = 760;
    page.drawText(`Reporte Mensual — ${monthLabel}`, { x: 40, y, size: 18, font });
    y -= 30;

    for (const [store, items] of Object.entries(reportJson)) {
      page.drawText(`Tienda: ${store}`, { x: 40, y, size: 12, font });
      y -= 18;
      for (const it of items.slice(0, 20)) {
        page.drawText(`- ${it.product_id}: ${it.total}`, { x: 60, y, size: 11, font });
        y -= 14;
        if (y < 60) {
          // new page
          y = 760;
          page = pdfDoc.addPage([600, 800]);
        }
      }
      y -= 10;
    }

    const pdfBytes = await pdfDoc.save();
    const pdfPath = path.join(reportsDir, `monthly_report_${monthLabel}.pdf`);
    fs.writeFileSync(pdfPath, pdfBytes);
    console.log('Wrote PDF to', pdfPath);

    // persist JSON summary into monthly_reports table for retention
    for (const [store, items] of Object.entries(reportJson)) {
      const { error: insertErr } = await supabase.from('monthly_reports').insert({ month_start: monthStart.toISOString().slice(0,10), store_id: store, report_json: JSON.stringify({ items }) });
      if (insertErr) console.warn('Failed to insert monthly_reports row for store', store, insertErr.message || insertErr);
    }

    console.log('Monthly report generation complete.');
    process.exit(0);
  } catch (err) {
    console.error('Monthly report failed:', err);
    process.exit(2);
  }
})();
