/* ============================================================
   PORTFOLIO DASHBOARD — script.js
   Fuentes: Rava (AR), Yahoo Finance (Global), CoinGecko (Crypto)
   Optimizado para: DPT (Días de Tenencia) y G/P por Lotes
   ============================================================ */

'use strict';

// ─── CONSTANTS ───────────────────────────────────────────────
const PROXY = '/api/proxy';
const LS_POSITIONS = 'portfolio_positions_v2';
const LS_PRICES    = 'portfolio_prices_v2';
const LS_MACRO     = 'macroData_v2';
const CACHE_TTL    = 15 * 60 * 1000;

// ─── STATE ───────────────────────────────────────────────────
let positions  = [];   // Estructura: [{ticker, type, currency, holdings: [{qty, price, date, tc}] }]
let priceCache = {};
let mepRate    = null;
let activeType = 'ar';

// ─── UTILS ───────────────────────────────────────────────────
const el = (id) => document.getElementById(id);
const colorClass = (v) => v >= 0 ? 'pos' : 'neg';

const fmt = {
  usd: v => '$' + Math.abs(v).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2}),
  ars: v => '$' + Math.abs(v).toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2}),
  pct: v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + '%',
  mep: v => '$ ' + Math.round(v).toLocaleString('es-AR'),
};

/**
 * Calcula Días Promedio de Tenencia (DPT) ponderados por cantidad.
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

// ─── DATA FETCHING ───────────────────────────────────────────
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
  let totalUSD = 0;
  const rows = [];

  positions.forEach(pos => {
    const info = prices[pos.ticker];
    if (!info) return;

    const currentPrice = info.price || 0;
    const totalQty = pos.holdings.reduce((s, h) => s + h.qty, 0);
    
    // Precio Promedio de Compra (PPC) en moneda original
    const avgPurchasePrice = pos.holdings.reduce((s, h) => s + (h.qty * h.price), 0) / totalQty;
    
    // Valor total de la posición
    const currentValLocal = currentPrice * totalQty;
    const currentValUSD = pos.type === 'ar' ? (currentValLocal / (mepRate || 1)) : currentValLocal;
    
    // Costo total en USD para P&L
    const totalCostUSD = pos.holdings.reduce((s, h) => {
        // Si es ARS, convertimos el costo histórico usando el TC de ese momento
        const costUSD = pos.type === 'ar' ? (h.price / (h.tc || mepRate || 1)) * h.qty : h.price * h.qty;
        return s + costUSD;
    }, 0);

    const gainAbs = currentValUSD - totalCostUSD;
    const dpt = calculateDPT(pos.holdings);

    totalUSD += currentValUSD;

    rows.push({
      ticker: pos.ticker,
      type: pos.type,
      currency: pos.currency,
      price: currentPrice,
      change: info.change,
      totalQty: totalQty,
      avgPurchasePrice: avgPurchasePrice,
      currentValUSD: currentValUSD,
      gainAbs: gainAbs,
      dpt: dpt
    });
  });

  return { rows, totalUSD };
}

// ─── RENDER ──────────────────────────────────────────────────
function renderTable(rows) {
  const tbody = el('posTable');
  if (!rows.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="9">Agregá tu primera posición...</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map((r, i) => `
    <tr>
      <td>${r.ticker} <span class="type-badge">${r.type}</span></td>
      <td>${r.currency === 'ARS' ? fmt.ars(r.price) : fmt.usd(r.price)}</td>
      <td class="${colorClass(r.change)}">${fmt.pct(r.change)}</td>
      <td>${r.totalQty.toFixed(2)}</td>
      <td>${r.currency === 'ARS' ? fmt.ars(r.avgPurchasePrice) : fmt.usd(r.avgPurchasePrice)}</td>
      <td>${fmt.usd(r.currentValUSD)}</td>
      <td class="${colorClass(r.gainAbs)}">${fmt.usd(r.gainAbs)}</td>
      <td><strong>${r.dpt} días</strong></td>
      <td><button class="del-btn" onclick="deletePos(${i})">✕</button></td>
    </tr>
  `).join('');
}

// ─── ACTIONS ─────────────────────────────────────────────────
async function handleAdd() {
  const ticker = el('tickerInput').value.trim().toUpperCase();
  const qty = parseFloat(el('qtyInput').value);
  const price = parseFloat(el('avgInput').value);
  const tc = parseFloat(el('tcInput').value) || null;

  if (!ticker || isNaN(qty) || isNaN(price)) return;

  const newHolding = { 
    qty, 
    price, 
    tc, 
    date: new Date().toISOString() 
  };

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
  init(); // Recargar datos sin F5 completo si es posible
}

window.deletePos = (i) => {
  positions.splice(i, 1);
  lsSet(LS_POSITIONS, positions);
  init();
};

function initTypeToggle() {
    document.querySelectorAll('.type-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeType = btn.dataset.type;
        });
    });
}

// ─── INIT ─────────────────────────────────────────────────────
async function init() {
  positions = lsGet(LS_POSITIONS) || [];
  await loadMacro();
  
  if (positions.length > 0) {
    const priceResults = await Promise.all(positions.map(p => {
      if (p.type === 'ar') return fetchArPrice(p.ticker);
      if (p.type === 'crypto') return fetchCryptoPrice(p.ticker);
      return fetchGlobalPrice(p.ticker);
    }));

    positions.forEach((p, i) => { priceCache[p.ticker] = priceResults[i]; });
  }

  const calc = calculatePortfolio(priceCache);
  el('totalVal').textContent = fmt.usd(calc.totalUSD);
  renderTable(calc.rows);
}

document.addEventListener('DOMContentLoaded', () => {
    init();
    initTypeToggle();
    el('addBtn').onclick = handleAdd;
});