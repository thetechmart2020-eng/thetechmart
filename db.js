const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'data', 'db.json');

const DEFAULT_DB = {
  config: {
    storeName: 'TheTechMart',
    whatsappNumber: '27716623565', // 071 662 3565 in international format (South Africa, country code 27, leading 0 dropped)
    adminPassword: 'admin123' // CHANGE THIS immediately after first login (Admin > Settings)
  },
  products: [],
  offers: [],
  tradeins: []
};

function readDB() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT_DB, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
}

function writeDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

module.exports = { readDB, writeDB };
