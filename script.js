/* ============================================================
   PORTFOLIO DASHBOARD — script.js (Refactorizado para DPT)
   Ecosistema Enképhalos - Amygdalé
   ============================================================ */

'use strict';

// ─── CONSTANTS ───────────────────────────────────────────────
const PROXY = '/api/proxy';
const LS_POSITIONS = 'portfolio_positions_v2';
const LS_PRICES    = 'portfolio_prices_v2';
const LS_MACRO     = 'macroData_v2';
const CACHE_TTL    = 15 * 60 * 1000;
const MACRO_TTL    = 24 * 60 * 60 * 1000;
const PIE_COLORS   = ['#378ADD','#1D9E75','#E8A838','#E05C5C','#8B5CF6','#F472B6','#34D399','#FB923C','#60A5FA','#A78BFA'];

// ─── STATE ───────────────────────────────────────────────────
let positions  = [];   // Estructura: [{ticker, type, currency, holdings: [{qty, price, date, tc}] }]
let priceCache = {};
let mepRate    = null;
let lineChart  = null;
let pieChart   = null;
let currentRange = '1M';
let activeType   = 'ar';

// ─── UTILS ───────────────────────────────────────────────────
const fmt = {
  usd: v => '$' + Math.abs(v).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2}),
  ars: v => '$' + Math.abs(v).toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2}),
  pct: v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + '%',
  mep: v => '$ ' + Math.round(v).toLocaleString('es-AR'),
};

const el = (id) => document.getElementById(id);
const colorClass = (v) => v >= 0 ? 'pos' : 'neg';

/**
 * Calcula los Días Promedio de Tenencia (DPT) ponderados por cantidad.
 */
function calculateDPT(holdings) {
  if (!holdings || holdings.length === 0) return 0;
  const now = new Date();
  let totalQty = 0;
  let weightedDays = 0;

  holdings.forEach(h => {
    const diffTime = Math.abs(now - new Date(h.date));
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    weightedDays += (diffDays * h.qty);
    totalQty += h.qty;
  });

  return totalQty > 0 ? Math.round(weightedDays / totalQty) : 0;
}

// ─── LOCAL STORAGE ───────────────────────────────────────────
function lsGet(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
function lsSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

// ─── DATA FETCHING (RAVA/YAHOO/COINGECKO) ────────────────────
async function fetchViaProxy(url) {
  const res = await fetch(`${PROXY}?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

async function fetchArPrice(ticker) {
  const yt = ticker.includes('.') ? ticker : `${ticker}.BA`;
  const data = await fetchViaProxy(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yt)}?interval=1d&range=2d`);
  const meta = data?.chart?.result?.[0]?.meta;
  const price = meta.regularMarketPrice;
  const prev = meta.chartPreviousClose || meta.previousClose || price;
  return { price, change: ((price - prev) / prev) * 100, changeAbs: price - prev };
}

// ... (fetchGlobalPrice y fetchCryptoPrice se mantienen igual que en tu original)
async function fetchGlobalPrice(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=2d`;
  const data = await fetchViaProxy(url);
  const meta = data.chart.result[0].meta;
  const price = meta.regularMarketPrice;
  const prev = meta.chartPreviousClose || meta.previousClose || price;
  return { price, change: ((price - prev) / prev) * 100, changeAbs: price - prev };
}

const COINGECKO_MAP = { BTC:'bitcoin', ETH:'ethereum', SOL:'solana', USDT:'tether' };
async function fetchCryptoPrice(ticker) {
  const id = COINGECKO_MAP[ticker.toUpperCase()] || ticker.toLowerCase();
  const data = await fetchViaProxy(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true`);
  const info = data[id];
  const price = info.usd;
  return { price, change: info.usd_24h_change || 0, changeAbs: (price * (info.usd_24h_change || 0)) / 100 };
}

// ─── CORE LOGIC ──────────────────────────────────────────────
async function loadMacro() {
  try {
    const d = await fetchViaProxy('https://dolarapi.com/v1/dolares/bolsa');
    if (d && d.venta) {
      mepRate = parseFloat(d.venta);
      el('sourceRow').innerHTML = `Dólar MEP: ${fmt.mep(mepRate)}`;
    }
  } catch (e) { console.error("Error Macro:", e); }
}

function calculatePortfolio(prices) {
  let totalUSD = 0, totalCostUSD = 0, todayAbsUSD = 0;
  const rows = [];

  positions.forEach(pos => {
    const info = prices[pos.ticker];
    if (!info) return;

    const price = info.price || 0;
    const dpt = calculateDPT(pos.holdings);
    
    // Agregados de holdings
    const totalQty = pos.holdings.reduce((s, h) => s + h.qty, 0);
    const totalCostARS = pos.holdings.reduce((s, h) => s + (h.qty * h.price * (h.tc || 1)), 0);
    const totalCostUSD_pos = pos.holdings.reduce((s, h) => s + (h.qty * h.price), 0); // Asumimos avgInput es USD

    const currentValLocal = price * totalQty;
    const currentValUSD = pos.type === 'ar' ? (currentValLocal / (mepRate || 1)) : currentValLocal;
    
    const gainAbs = currentValUSD - totalCostUSD_pos;
    const gainPct = totalCostUSD_pos > 0 ? (gainAbs / totalCostUSD_pos) * 100 : 0;

    totalUSD += currentValUSD;
    totalCostUSD += totalCostUSD_pos;
    todayAbsUSD += (info.changeAbs * totalQty) / (pos.type === 'ar' ? (mepRate || 1) : 1);

    rows.push({
      ...pos,
      price,
      dpt,
      totalQty,
      currentValLocal,
      gainAbs,
      gainPct,
      change: info.change
    });
  });

  return { rows, totalUSD, totalGainUSD: totalUSD - totalCostUSD, todayPct: (todayAbsUSD / totalUSD) * 100, todayAbsUSD };
}

// ─── RENDER ──────────────────────────────────────────────────
function renderTable(rows) {
  const tbody = el('posTable');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="11">No hay posiciones</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map((r, i) => `
    <tr>
      <td>${r.ticker} <span class="type-badge">${r.type}</span></td>
      <td>${r.currency === 'ARS' ? fmt.ars(r.price) : fmt.usd(r.price)}</td>
      <td class="${colorClass(r.change)}">${fmt.pct(r.change)}</td>
      <td>${r.totalQty}</td>
      <td><strong>${r.dpt} días</strong></td>
      <td>${fmt.usd(r.gainAbs)}</td>
      <td class="${colorClass(r.gainPct)}">${fmt.pct(r.gainPct)}</td>
      <td><button onclick="deletePos(${i})">✕</button></td>
    </tr>
  `).join('');
}

// ─── ACTIONS ─────────────────────────────────────────────────
async function handleAdd() {
  const ticker = el('tickerInput').value.trim().toUpperCase();
  const qty = parseFloat(el('qtyInput').value);
  const price = parseFloat(el('avgInput').value);
  const tc = parseFloat(el('tcInput').value) || null;

  if (!ticker || isNaN(qty)) return;

  const newHolding = { qty, price, tc, date: new Date().toISOString() };
  const existing = positions.find(p => p.ticker === ticker);

  if (existing) {
    existing.holdings.push(newHolding);
  } else {
    positions.push({
      ticker,
      type: activeType,
      currency: activeType === 'ar' ? 'ARS' : 'USD',
      holdings: [newHolding]
    });
  }

  lsSet(LS_POSITIONS, positions);
  location.reload(); // Refrescar para recalcular todo
}

window.deletePos = (i) => {
  positions.splice(i, 1);
  lsSet(LS_POSITIONS, positions);
  location.reload();
};

// ─── INIT ────────────────────────────────────────────────────
async function init() {
  positions = lsGet(LS_POSITIONS) || [];
  await loadMacro();
  
  const tickers = positions.map(p => p.ticker);
  const priceResults = await Promise.all(positions.map(p => {
    if (p.type === 'ar') return fetchArPrice(p.ticker);
    if (p.type === 'crypto') return fetchCryptoPrice(p.ticker);
    return fetchGlobalPrice(p.ticker);
  }));

  tickers.forEach((t, i) => { priceCache[t] = priceResults[i]; });

  const calc = calculatePortfolio(priceCache);
  el('totalVal').textContent = fmt.usd(calc.totalUSD);
  renderTable(calc.rows);

  el('addBtn').onclick = handleAdd;
}

document.addEventListener('DOMContentLoaded', init);