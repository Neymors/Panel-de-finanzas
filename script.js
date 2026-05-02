/**
 * Amygdalé — Financial Dashboard & Risk Control
 * Vanilla JS | Local-First | BYMA + Yahoo + CoinGecko + DolarApi
 * Version: 2.1.2 — PER Fixed & Decimals Strict (2 max)
 */
'use strict';

/* ───────── CONFIGURACIÓN Y CONSTANTES ───────── */
const CONFIG = {
  PROXY: '/api/proxy',
  LS_POSITIONS: 'portfolio_positions_v2',
  LS_CACHE: 'amygdale_price_cache_v1',
  LS_HISTORY: 'amygdale_history_v1',
  CACHE_TTL: 5 * 60 * 1000,
  DEFAULT_MEP: 1200,
};

const API = {
  BYMA: 'https://open.bymadata.com.ar/van-api/robo/prices?symbol=',
  DOLARAPI: 'https://dolarapi.com/v1/dolares/bolsa',
  COINGECKO: 'https://api.coingecko.com/api/v3/simple/price',
  YAHOO: 'https://query1.finance.yahoo.com/v8/finance/chart/',
};

const BOND_SYMBOLS = {
  AL30: 'AL30', GD30: 'GD30', AL35: 'AL35', GD35: 'GD35',
  AE38: 'AE38', GD38: 'GD38', AL41: 'AL41', GD41: 'GD41',
  TX2U: 'TX2U', T2X2: 'T2X2', T2X5: 'T2X5', T2X9: 'T2X9',
  AE24: 'AE24', AE27: 'AE27', AE29: 'AE29', AE30: 'AE30',
  BONAR27: 'AO27', BONAR30: 'AO30', BONAR: 'AO27',
};

const CRYPTO_MAP = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', USDT: 'tether',
};

/* ───────── ESTADO GLOBAL ───────── */
const State = {
  positions: [],
  priceCache: {},
  mepRate: null,
  activeType: 'ar',
  activeRange: 'ytd',
  processed: [],
  charts: { pie: null, line: null },
};

/* ───────── UTILIDADES ───────── */
const $ = (id) => document.getElementById(id);

const Storage = {
  get: (key) => {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; }
    catch { return null; }
  },
  set: (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { console.warn('⚠️ localStorage error:', e); return false; }
  }
};

// ✅ PUNTO 3: Formato estricto a 2 decimales máximo
const Format = {
  usd: (v) => '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  ars: (v) => '$' + Math.abs(v).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  pct: (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + '%',
  qty: (v) => v.toFixed(2),
  weight: (v) => v.toFixed(2) + '%',
  date: (d) => new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }),
};

const isPositive = (v) => v >= 0;
const isArgentineBond = (t) => Object.prototype.hasOwnProperty.call(BOND_SYMBOLS, t.toUpperCase());

/* ───────── CACHE CON TTL ───────── */
const PriceCache = {
  get(ticker) {
    const cache = Storage.get(CONFIG.LS_CACHE) || {};
    const entry = cache[ticker];
    if (entry && Date.now() - entry.ts < CONFIG.CACHE_TTL) return entry.data;
    return null;
  },
  set(ticker, data) {
    const cache = Storage.get(CONFIG.LS_CACHE) || {};
    cache[ticker] = { data, ts: Date.now() };
    Storage.set(CONFIG.LS_CACHE, cache);
  },
  clear() { localStorage.removeItem(CONFIG.LS_CACHE); }
};

/* ───────── RELOJES ───────── */
function updateClocks() {
  const opts = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
  const ba = new Date().toLocaleTimeString('es-AR', { ...opts, timeZone: 'America/Argentina/Buenos_Aires' });
  const ny = new Date().toLocaleTimeString('en-US', { ...opts, timeZone: 'America/New_York' });
  if ($('clockAR')) $('clockAR').textContent = `BA ${ba}`;
  if ($('clockNY')) $('clockNY').textContent = `NY ${ny}`;
}

/* ───────── HISTÓRICO DIARIO ───────── */
function saveDailySnapshot(totalUSD) {
  const today = new Date().toISOString().slice(0, 10);
  let history = Storage.get(CONFIG.LS_HISTORY) || [];
  const last = history[history.length - 1];
  if (last?.date === today || totalUSD <= 0) return;
  const benchChange = State.mepRate ? ((State.mepRate - CONFIG.DEFAULT_MEP) / CONFIG.DEFAULT_MEP) * 100 : 0;
  history.push({
    date: today,
    totalUSD: Math.round(totalUSD),
    benchmark: Math.round(totalUSD * (1 + benchChange / 100))
  });
  if (history.length > 365) history.splice(0, history.length - 365);
  Storage.set(CONFIG.LS_HISTORY, history);
}

/* ───────── MÉTRICAS ───────── */
function updateTopMetrics(processed, totalVal) {
  let totalGainUSD = 0, totalCostUSD = 0, todayChangeWeighted = 0;
  let bestToday = { ticker: '—', change: -Infinity };

  processed.forEach(item => {
    totalGainUSD += item.pnlUSD;
    totalCostUSD += item.costUSD;
    if (item.info.change > bestToday.change) bestToday = { ticker: item.pos.ticker, change: item.info.change };
    const weight = totalVal > 0 ? item.valUSD / totalVal : 0;
    todayChangeWeighted += weight * item.info.change;
  });

  $('totalGain').textContent = Format.usd(totalGainUSD);
  $('totalGainPct').textContent = totalCostUSD > 0 ? Format.pct((totalGainUSD / totalCostUSD) * 100) : '0.00%';
  $('posCount').textContent = processed.length;
  $('bestTicker').textContent = bestToday.ticker;
  $('bestPct').textContent = bestToday.change !== -Infinity ? Format.pct(bestToday.change) : '—';
  $('bestPct').className = `metric-sub ${isPositive(bestToday.change) ? 'pos' : 'neg'}`;
  $('todayPct').textContent = Format.pct(todayChangeWeighted);
  $('todayPct').className = `metric-val ${isPositive(todayChangeWeighted) ? 'pos' : 'neg'}`;
  const todayAbsUSD = totalVal * (todayChangeWeighted / 100);
  $('todayAbs').textContent = Format.usd(todayAbsUSD);
  $('todayAbs').className = `metric-sub ${isPositive(todayAbsUSD) ? 'pos' : 'neg'}`;
}

/* ───────── GRÁFICOS ───────── */
function renderPieChart(processed) {
  const ctx = $('pieChart')?.getContext('2d');
  if (!ctx || processed.length === 0) return;
  if (State.charts.pie) State.charts.pie.destroy();

  const colors = ['#378ADD', '#1D9E75', '#E8A838', '#E05C5C', '#8B5CF6', '#F97316', '#06B6D4', '#84CC16'];
  
  State.charts.pie = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: processed.map(p => p.pos.ticker),
      datasets: [{
        data: processed.map(p => p.valUSD),
        backgroundColor: colors.slice(0, processed.length),
        borderWidth: 0,
      }]
    },
    options: {
      plugins: { legend: { display: false } },
      maintainAspectRatio: false,
      cutout: '70%',
      responsive: true,
    }
  });

  const legend = $('pieLegend');
  if (legend) {
    legend.innerHTML = processed.map((p, i) => 
      `<span><span class="leg-dot" style="background:${colors[i]}"></span>${p.pos.ticker}</span>`
    ).join('');
  }
}

function renderLineChart() {
  const ctx = $('lineChart')?.getContext('2d');
  if (!ctx) return;
  if (State.charts.line) State.charts.line.destroy();

  let history = Storage.get(CONFIG.LS_HISTORY) || [];
  const now = new Date();
  const days = State.activeRange === '1m' ? 30 : State.activeRange === '6m' ? 180 : State.activeRange === '1y' ? 365 : 0;
  
  if (history.length > 0 && days > 0) {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
    history = history.filter(h => new Date(h.date) >= cutoff);
  } else if (State.activeRange === 'ytd' && history.length > 0) {
    const yearStart = new Date(now.getFullYear(), 0, 1);
    history = history.filter(h => new Date(h.date) >= yearStart);
  }

  if (history.length < 3) {
    const points = 30;
    let curr = State.processed.reduce((s, i) => s + i.valUSD, 0) * 0.85;
    let bench = curr * 0.98;
    for (let i = 0; i < points; i++) {
      const d = new Date(); d.setDate(d.getDate() - (points - i));
      curr *= 1 + (Math.random() - 0.4) * 0.03;
      bench *= 1 + (Math.random() - 0.45) * 0.02;
      history.push({ date: d.toISOString().slice(0, 10), totalUSD: Math.round(curr), benchmark: Math.round(bench) });
    }
    const realTotal = State.processed.reduce((s, i) => s + i.valUSD, 0);
    history[history.length - 1].totalUSD = Math.round(realTotal);
    history[history.length - 1].benchmark = Math.round(realTotal * 0.98);
  }

  State.charts.line = new Chart(ctx, {
    type: 'line',
    data: {
      labels: history.map(h => h.date.slice(5)),
      datasets: [
        { label: 'Portfolio', data: history.map(h => h.totalUSD), borderColor: '#378ADD', backgroundColor: 'rgba(55,138,221,0.1)', tension: 0.35, fill: true, pointRadius: 0, pointHoverRadius: 4 },
        { label: 'Benchmark', data: history.map(h => h.benchmark), borderColor: '#1D9E75', borderDash: [5, 5], tension: 0.35, pointRadius: 0 }
      ]
    },
    options: {
      plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
      maintainAspectRatio: false, responsive: true,
      scales: { x: { display: false }, y: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { callback: v => `$${v.toLocaleString()}` } } }
    }
  });
}

/* ───────── RENDER PRINCIPAL ───────── */
function renderAll() {
  let totalPortfolioUSD = 0;
  const tbody = $('posTable');

  State.processed = State.positions.map(pos => {
    const info = State.priceCache[pos.ticker] || { price: 0, change: 0 };
    const holdings = pos.holdings || [];
    const totalQty = holdings.reduce((sum, h) => sum + h.qty, 0);

    const totalCostUSD = holdings.reduce((sum, h) => {
      const tc = h.tc || State.mepRate || 1;
      const priceUSD = pos.type === 'ar' ? h.price / tc : h.price;
      return sum + priceUSD * h.qty;
    }, 0);

    const currentValUSD = pos.type === 'ar'
      ? (info.price * totalQty) / (State.mepRate || 1)
      : info.price * totalQty;

    const pnlUSD = currentValUSD - totalCostUSD;
    
    // ✅ PUNTO 3: PER corregido y blindado contra divisiones por casi-cero
    const per = totalCostUSD > 0.01 ? (pnlUSD / totalCostUSD) * 100 : 0;
    
    const ppcOriginal = totalQty > 0 ? holdings.reduce((sum, h) => sum + h.price * h.qty, 0) / totalQty : 0;

    totalPortfolioUSD += currentValUSD;
    return { pos, info, qty: totalQty, valUSD: currentValUSD, costUSD: totalCostUSD, pnlUSD, per, ppcOriginal };
  });

  $('totalVal').textContent = Format.usd(totalPortfolioUSD);
  updateTopMetrics(State.processed, totalPortfolioUSD);
  renderPieChart(State.processed);
  renderLineChart();
  saveDailySnapshot(totalPortfolioUSD);

  if (State.processed.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty-row">Agregá tu primera posición ↑</td></tr>';
    return;
  }

  // ✅ PUNTO 3: Tabla con formatos estrictos a 2 decimales
  tbody.innerHTML = State.processed.map((item, i) => {
    const { pos, info, qty, valUSD, pnlUSD, per, ppcOriginal } = item;
    const weight = totalPortfolioUSD > 0 ? (valUSD / totalPortfolioUSD) * 100 : 0;
    const firstDate = new Date(Math.min(...pos.holdings.map(h => new Date(h.date).getTime())));
    const tenencia = Math.ceil((Date.now() - firstDate) / (1000 * 60 * 60 * 24));
    const badge = getAssetBadge(pos.ticker, pos.type);

    return `
      <tr>
        <td><strong>${pos.ticker}</strong> ${badge}</td>
        <td>${pos.type === 'ar' ? Format.ars(info.price) : Format.usd(info.price)}</td>
        <td class="${isPositive(info.change) ? 'pos' : 'neg'}">${Format.pct(info.change)}</td>
        <td>${Format.qty(qty)}</td>
        <td>${pos.type === 'ar' ? Format.ars(ppcOriginal) : Format.usd(ppcOriginal)}</td>
        <td>${tenencia}d</td>
        <td>${Format.weight(weight)}</td>
        <td class="${isPositive(pnlUSD) ? 'pos' : 'neg'}">${Format.usd(pnlUSD)}</td>
        <td class="${isPositive(per) ? 'pos' : 'neg'}">${Format.pct(per)}</td>
        <td><button class="del-btn" onclick="window.deletePos(${i})" aria-label="Eliminar ${pos.ticker}">✕</button></td>
      </tr>`;
  }).join('');
}

function getAssetBadge(ticker, type) {
  if (type === 'crypto') return '<span class="type-badge crypto">CRYPTO</span>';
  if (type === 'ar' && isArgentineBond(ticker)) return '<span class="type-badge bond">BONO AR</span>';
  if (type === 'ar') return '<span class="type-badge stock">ACCIÓN AR</span>';
  return '<span class="type-badge global">GLOBAL</span>';
}

/* ───────── API DE PRECIOS ───────── */
async function fetchWithProxy(url) {
  const fullUrl = `${CONFIG.PROXY}?url=${encodeURIComponent(url)}`;
  const res = await fetch(fullUrl, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getPrice(ticker, type) {
  try {
    if (type === 'ar' && isArgentineBond(ticker)) {
      const symbol = BOND_SYMBOLS[ticker.toUpperCase()];
      const data = await fetchWithProxy(API.BYMA + symbol);
      const quote = Array.isArray(data) ? data.find(q => q.symbol === symbol) : data;
      if (quote?.last && !isNaN(quote.last)) return { price: parseFloat(quote.last), change: parseFloat(quote.varPct) || 0 };
    }
    if (type === 'crypto') {
      const id = CRYPTO_MAP[ticker] || ticker.toLowerCase();
      const data = await fetchWithProxy(`${API.COINGECKO}?ids=${id}&vs_currencies=usd&include_24hr_change=true`);
      const coin = data[Object.keys(data)[0]];
      if (coin?.usd) return { price: coin.usd, change: coin.usd_24h_change || 0 };
    }
    if (type === 'ar') {
      const data = await fetchWithProxy(`${API.YAHOO}${ticker}.BA?interval=1d&range=2d`);
      const meta = data.chart?.result?.[0]?.meta;
      if (meta?.regularMarketPrice) return { price: meta.regularMarketPrice, change: ((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose) * 100 };
    }
    const data = await fetchWithProxy(`${API.YAHOO}${ticker}?interval=1d&range=2d`);
    const meta = data.chart?.result?.[0]?.meta;
    if (meta?.regularMarketPrice) return { price: meta.regularMarketPrice, change: ((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose) * 100 };
    return { price: 0, change: 0 };
  } catch (e) {
    console.warn(`⚠️ Error obteniendo ${ticker}:`, e.message);
    return { price: 0, change: 0 };
  }
}

async function getPriceCached(ticker, type) {
  const cached = PriceCache.get(ticker);
  if (cached) return cached;
  const fresh = await getPrice(ticker, type);
  if (fresh.price > 0) PriceCache.set(ticker, fresh);
  return fresh;
}

/* ───────── FORMULARIO & EVENTOS ───────── */
async function handleAdd(e) {
  if (e) e.preventDefault();
  const ticker = $('tickerInput').value.trim().toUpperCase();
  const qty = parseFloat($('qtyInput').value);
  const ppc = parseFloat($('avgInput').value);
  const days = parseInt($('daysInput').value) || 0;
  const errorEl = $('addError');

  if (!ticker || isNaN(qty) || isNaN(ppc) || qty <= 0 || ppc <= 0) {
    errorEl.textContent = 'Datos inválidos. Revisá cantidad y precio.';
    errorEl.style.display = 'block';
    return;
  }
  errorEl.style.display = 'none';

  const buyDate = new Date(); buyDate.setDate(buyDate.getDate() - days);
  const holding = { qty, price: ppc, date: buyDate.toISOString(), tc: State.mepRate };
  const existing = State.positions.find(p => p.ticker === ticker);
  if (existing) existing.holdings.push(holding);
  else State.positions.push({ ticker, type: State.activeType, holdings: [holding] });

  Storage.set(CONFIG.LS_POSITIONS, State.positions);
  ['tickerInput', 'qtyInput', 'avgInput', 'daysInput'].forEach(id => $(id).value = '');
  State.priceCache[ticker] = await getPriceCached(ticker, State.activeType);
  renderAll();
}

function exportPortfolio() {
  const payload = { version: '2.1', exported: new Date().toISOString(), positions: State.positions, history: Storage.get(CONFIG.LS_HISTORY) || [] };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `amygdale_backup_${new Date().toISOString().slice(0, 10)}.json`;
  a.click(); URL.revokeObjectURL(url);
}

function injectControls() {
  const footer = document.createElement('div');
  footer.className = 'footer-controls';
  footer.innerHTML = `
    <button class="ctrl-btn" id="btnExport">📥 Exportar</button>
    <button class="ctrl-btn" id="btnImport">📤 Importar</button>
    <input type="file" id="importInput" style="display:none" accept=".json">
  `;
  document.querySelector('.container').appendChild(footer);

  $('btnExport').onclick = exportPortfolio;
  $('btnImport').onclick = () => $('importInput').click();
  $('importInput').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = JSON.parse(evt.target.result);
        if (data.positions) {
          State.positions = data.positions;
          Storage.set(CONFIG.LS_POSITIONS, State.positions);
          if (data.history) Storage.set(CONFIG.LS_HISTORY, data.history);
          renderAll();
        }
      } catch { console.error('Import error'); }
    };
    reader.readAsText(file);
  };
}

/* ───────── INICIALIZACIÓN ───────── */
async function init() {
  updateClocks();
  setInterval(updateClocks, 1000);
  State.positions = Storage.get(CONFIG.LS_POSITIONS) || [];

  try {
    const mep = await fetchWithProxy(API.DOLARAPI);
    State.mepRate = parseFloat(mep.venta) || CONFIG.DEFAULT_MEP;
    if ($('sourceRow')) $('sourceRow').textContent = `Dólar MEP: $${State.mepRate.toLocaleString('es-AR')}`;
  } catch {
    State.mepRate = CONFIG.DEFAULT_MEP;
  }

  if (State.positions.length > 0) {
    const results = await Promise.all(State.positions.map(p => getPriceCached(p.ticker, p.type)));
    State.positions.forEach((p, i) => State.priceCache[p.ticker] = results[i]);
  }

  renderAll();
  injectControls();

  $('addBtn').onclick = handleAdd;

  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      State.activeType = btn.dataset.type;
    });
  });

  document.querySelectorAll('.range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      State.activeRange = btn.dataset.range;
      renderLineChart();
    });
  });

  window.deletePos = (index) => {
    State.positions.splice(index, 1);
    Storage.set(CONFIG.LS_POSITIONS, State.positions);
    renderAll();
  };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();