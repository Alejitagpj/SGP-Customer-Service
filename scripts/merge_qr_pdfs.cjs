const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');

(async () => {
  const dir = path.resolve(__dirname, '../qrcodes/pdf');
  const out = path.resolve(__dirname, '../qrcodes/qrcodes_all.pdf');
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.pdf'))
    .sort((a,b) => {
      const na = parseInt(a.match(/mesa-(\d+)\.pdf/)?.[1] || '0',10);
      const nb = parseInt(b.match(/mesa-(\d+)\.pdf/)?.[1] || '0',10);
      return na - nb;
    })
    .map(f => path.join(dir,f));

  if (files.length === 0) {
    console.error('No PDF files found to merge.');
    process.exit(1);
  }

  const mergedPdf = await PDFDocument.create();

  for (const file of files) {
    const bytes = fs.readFileSync(file);
    const pdf = await PDFDocument.load(bytes);
    const copied = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
    copied.forEach(p => mergedPdf.addPage(p));
    console.log('Merged', file);
  }

  const mergedBytes = await mergedPdf.save();
  fs.writeFileSync(out, mergedBytes);
  console.log('Wrote merged PDF to', out);
})();
