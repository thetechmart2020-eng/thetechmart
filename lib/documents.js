// Quote & invoice PDF generation. Pure JS (pdfkit) — no third-party document
// service, no API key, works fine in Vercel's serverless runtime.
//
// A quote is generated at sale inquiry (an offer coming in, or a checkout
// order before it's paid) and an invoice after payment — but both are really
// the same document shape: TheTechMart letterhead, a customer block, a line-
// item table, and a status note. `buildDocBuffer` + the two thin wrappers
// below cover both.
// pdfkit is loaded lazily (inside the functions that need it) so the serverless
// function boots faster for the many requests that never generate a PDF.
const getPDFDocument = () => require('pdfkit');
const fs = require('fs');
const path = require('path');

function fmtR(n) {
  return 'R' + Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildDocBuffer(renderFn) {
  return new Promise((resolve, reject) => {
    const PDFDocument = getPDFDocument();
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    renderFn(doc);
    doc.end();
  });
}

function drawHeader(doc, kind, number, cfg) {
  const logoPath = path.join(__dirname, '..', 'public', 'img', 'logo.png');
  try { doc.image(logoPath, 50, 45, { height: 32 }); } catch (e) { /* logo optional */ }

  doc.fontSize(20).fillColor('#111111').text(kind, 300, 48, { width: 245, align: 'right' });
  doc.fontSize(10).fillColor('#555555')
    .text(`#${number}`, 300, 72, { width: 245, align: 'right' })
    .text(new Date().toLocaleDateString('en-ZA', { year: 'numeric', month: 'long', day: 'numeric' }), 300, 86, { width: 245, align: 'right' });

  doc.fontSize(9).fillColor('#777777')
    .text(`${cfg.storeName || 'TheTechMart'}  ·  WhatsApp ${cfg.whatsappNumber || ''}  ·  ${cfg.contactEmail || ''}`, 50, 110);
  doc.moveTo(50, 128).lineTo(545, 128).strokeColor('#dddddd').stroke();
}

function drawCustomer(doc, y, { name, phone, email, address }) {
  doc.fontSize(9).fillColor('#999999').text('BILLED TO', 50, y);
  doc.fontSize(12).fillColor('#111111').text(name || '—', 50, y + 14);
  doc.fontSize(9).fillColor('#555555');
  let line = y + 32;
  if (phone) { doc.text(phone, 50, line); line += 13; }
  if (email) { doc.text(email, 50, line); line += 13; }
  if (address) { doc.text(address, 50, line, { width: 260 }); line += 26; }
  return line + 10;
}

// Returns the y-position just below the table so the caller can keep laying
// out content underneath it.
function drawLineItems(doc, y, items) {
  doc.fontSize(9).fillColor('#999999');
  doc.text('ITEM', 50, y);
  doc.text('AMOUNT', 420, y, { width: 125, align: 'right' });
  doc.moveTo(50, y + 14).lineTo(545, y + 14).strokeColor('#dddddd').stroke();

  let cursor = y + 24;
  let total = 0;
  items.forEach((item) => {
    doc.fontSize(10.5).fillColor('#111111').text(item.label, 50, cursor, { width: 350 });
    doc.text(fmtR(item.amount), 420, cursor, { width: 125, align: 'right' });
    total += Number(item.amount || 0);
    cursor += 22;
  });

  doc.moveTo(50, cursor + 4).lineTo(545, cursor + 4).strokeColor('#dddddd').stroke();
  doc.fontSize(12).fillColor('#111111').text('TOTAL', 350, cursor + 16);
  doc.fontSize(12).fillColor('#111111').text(fmtR(total), 420, cursor + 16, { width: 125, align: 'right' });

  return cursor + 50;
}

async function generateQuotePdf({ number, cfg, customer, items, note }) {
  return buildDocBuffer((doc) => {
    drawHeader(doc, 'QUOTE', number, cfg);
    const afterCustomer = drawCustomer(doc, 145, customer);
    const afterItems = drawLineItems(doc, Math.max(afterCustomer, 210), items);
    doc.fontSize(9).fillColor('#888888').text(
      'This quote is valid for 7 days from the date above and doesn\'t reserve stock — prices and availability ' +
      'can change until it\'s confirmed. All devices are pre-owned and sold as described; message us on WhatsApp ' +
      'with any questions before going ahead.',
      50, afterItems, { width: 495, lineGap: 2 }
    );
    if (note) doc.moveDown(1.2).fontSize(9).fillColor('#555555').text(`Note: ${note}`, 50, undefined, { width: 495 });
  });
}

async function generateInvoicePdf({ number, cfg, customer, items, paymentStatus, paymentMethod, fulfillment, note }) {
  return buildDocBuffer((doc) => {
    drawHeader(doc, 'INVOICE', number, cfg);
    const afterCustomer = drawCustomer(doc, 145, customer);
    const afterItems = drawLineItems(doc, Math.max(afterCustomer, 210), items);

    doc.fontSize(10.5).fillColor('#111111').text(
      `Payment status: ${(paymentStatus === 'paid' ? 'PAID' : (paymentStatus || 'pending').toUpperCase())}`,
      50, afterItems
    );
    if (paymentMethod) doc.fontSize(9).fillColor('#555555').text(`Payment method: ${paymentMethod}`, 50, afterItems + 16);
    if (fulfillment) doc.fontSize(9).fillColor('#555555').text(`Fulfillment: ${fulfillment}`, 50, afterItems + 30);

    doc.fontSize(9).fillColor('#888888').text(
      'Thank you for your business at TheTechMart — please keep this invoice for your records.',
      50, afterItems + 56, { width: 495, lineGap: 2 }
    );
    if (note) doc.moveDown(1.2).fontSize(9).fillColor('#555555').text(`Note: ${note}`, 50, undefined, { width: 495 });
  });
}


// ---------- Public price list (downloadable PDF) ----------
// Built on demand from the live catalogue, so the PDF always matches the website.
const CATEGORY_ORDER = ['Phones', 'Laptops', 'Tablets', 'Consoles', 'Audio', 'Accessories'];

function generatePriceListPdf({ products, cfg, isDeal }) {
  return new Promise((resolve, reject) => {
    const PDFDocument = getPDFDocument();
    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const L = 40, R = 555, PAGE_BOTTOM = 790;
    const cols = { device: L, storage: 285, cond: 355, price: 440 };
    const green = '#14a83a';

    const drawTop = () => {
      const logoPath = path.join(__dirname, '..', 'public', 'img', 'logo.png');
      try { doc.image(logoPath, L, 36, { height: 40 }); } catch (e) { /* logo optional */ }
      doc.font('Helvetica-Bold').fontSize(20).fillColor('#111111').text('Price list', 300, 40, { width: R - 300, align: 'right' });
      doc.font('Helvetica').fontSize(9.5).fillColor('#555555')
        .text(new Date().toLocaleDateString('en-ZA', { year: 'numeric', month: 'long', day: 'numeric' }), 300, 64, { width: R - 300, align: 'right' });
    };

    drawTop();
    let y = 92;
    doc.font('Helvetica').fontSize(9.5).fillColor('#333333').text(
      'Grade A-B pre-owned devices unless marked otherwise in the Condition column. Standard-price devices: 3-month repair or replacement warranty. ' +
      'Negotiated devices: 21-day replacement warranty. Delivery R100 flat via The Courier Guy, about 2 days. Prices are list prices and every price is open to an offer: message us on WhatsApp ' +
      `${cfg.whatsappDisplay || '071 662 3565'} to buy or make an offer.`,
      L, y, { width: R - L, lineGap: 2 }
    );
    y = doc.y + 14;

    const rowHeader = () => {
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#888888');
      doc.text('DEVICE', cols.device, y);
      doc.text('STORAGE', cols.storage, y);
      doc.text('CONDITION', cols.cond, y);
      doc.text('PRICE', cols.price, y, { width: R - cols.price, align: 'right' });
      doc.moveTo(L, y + 13).lineTo(R, y + 13).strokeColor('#dddddd').lineWidth(0.7).stroke();
      y += 20;
    };

    const ensureSpace = (needed) => {
      if (y + needed > PAGE_BOTTOM) {
        doc.addPage();
        y = 40;
      }
    };

    const byCat = new Map();
    for (const p of products) {
      const c = p.category || 'Phones';
      if (!byCat.has(c)) byCat.set(c, []);
      byCat.get(c).push(p);
    }
    const cats = [...CATEGORY_ORDER.filter((c) => byCat.has(c)), ...[...byCat.keys()].filter((c) => !CATEGORY_ORDER.includes(c))];

    let anyDeal = false;
    for (const cat of cats) {
      const list = byCat.get(cat).sort((a, b) => a.brand.localeCompare(b.brand) || a.price - b.price);
      ensureSpace(70);
      doc.font('Helvetica-Bold').fontSize(13).fillColor(green).text(cat.toUpperCase(), L, y);
      y += 20;
      rowHeader();
      for (const p of list) {
        ensureSpace(20);
        const deal = isDeal && isDeal(p);
        if (deal) anyDeal = true;
        doc.font('Helvetica').fontSize(10).fillColor('#111111');
        doc.text(`${p.brand} ${p.model}${deal ? ' *' : ''}`, cols.device, y, { width: cols.storage - cols.device - 8, lineBreak: false, ellipsis: true });
        doc.fillColor('#444444').text(p.storage || '-', cols.storage, y, { width: 65, lineBreak: false, ellipsis: true });
        doc.text(p.condition || '-', cols.cond, y, { width: 80, lineBreak: false, ellipsis: true });
        doc.font('Helvetica-Bold').fillColor('#111111').text(fmtR0(p.price), cols.price, y, { width: R - cols.price, align: 'right' });
        doc.moveTo(L, y + 14).lineTo(R, y + 14).strokeColor('#eeeeee').lineWidth(0.5).stroke();
        y += 19;
      }
      y += 10;
    }

    if (anyDeal) {
      ensureSpace(24);
      doc.font('Helvetica').fontSize(9).fillColor('#555555').text('* Negotiated (special-price) device: 21-day replacement warranty.', L, y);
    }

    // Footer on every page: contact line + page numbers.
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      // The footer sits inside the bottom margin; zero it so pdfkit does not add a blank page for it.
      doc.page.margins.bottom = 0;
      doc.font('Helvetica').fontSize(8.5).fillColor('#888888').text(
        `thetechmart.co.za  |  WhatsApp ${cfg.whatsappDisplay || '071 662 3565'}  |  ${cfg.contactEmail || ''}`,
        L, 812, { width: R - L - 60, lineBreak: false }
      );
      doc.text(`Page ${i + 1} of ${range.count}`, R - 80, 812, { width: 80, align: 'right', lineBreak: false });
    }
    doc.end();
  });
}

function fmtR0(n) {
  return 'R' + Number(n || 0).toLocaleString('en-ZA', { maximumFractionDigits: 0 });
}

module.exports = { generateQuotePdf, generateInvoicePdf, generatePriceListPdf, fmtR };
