// Quote & invoice PDF generation. Pure JS (pdfkit) — no third-party document
// service, no API key, works fine in Vercel's serverless runtime.
//
// A quote is generated at sale inquiry (an offer coming in, or a checkout
// order before it's paid) and an invoice after payment — but both are really
// the same document shape: TheTechMart letterhead, a customer block, a line-
// item table, and a status note. `buildDocBuffer` + the two thin wrappers
// below cover both.
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

function fmtR(n) {
  return 'R' + Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildDocBuffer(renderFn) {
  return new Promise((resolve, reject) => {
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

module.exports = { generateQuotePdf, generateInvoicePdf, fmtR };
