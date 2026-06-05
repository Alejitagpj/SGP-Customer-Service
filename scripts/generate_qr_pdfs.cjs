const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

(async () => {
  const inputPath = path.resolve(__dirname, '../qrcodes/printable_qrcodes.html');
  const outputDir = path.resolve(__dirname, '../qrcodes/pdf');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const browser = await puppeteer.launch({ args: ['--no-sandbox','--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.goto('file://' + inputPath, { waitUntil: 'networkidle0' });

  // extract page-level styles
  const styles = await page.$$eval('style', els => els.map(s => s.innerHTML).join('\n'));

  const cards = await page.$$eval('.card', (els) => els.map((el, idx) => ({ html: el.outerHTML, index: idx + 1 })));

  for (const c of cards) {
    const newPage = await browser.newPage();
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${styles}\n      body{margin:0;padding:10px;background:#fff}\n      .card{margin:0 auto}</style></head><body>${c.html}</body></html>`;
    await newPage.setContent(html, { waitUntil: 'networkidle0' });
    const outPath = path.join(outputDir, `mesa-${c.index}.pdf`);
    await newPage.pdf({ path: outPath, width: '3.2in', height: '4.4in', printBackground: true });
    console.log(`Saved ${outPath}`);
    await newPage.close();
  }

  await browser.close();
  console.log('All PDFs generated.');
})();
