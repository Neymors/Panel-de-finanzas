/**
Amygdalé — Financial Dashboard & Risk Control
Vanilla JS | Local-First | Amygdalé API + Yahoo + CoinGecko + DolarApi
Version: 3.1 — Robust Yahoo Fallback & Retry Logic
*/
'use strict';

/* ═══════════════════════════════════════════════
CONFIGURACIÓN Y CONSTANTES
═══════════════════════════════════════════════ */
const CONFIG = {
  PROXY: '/api/proxy',
  LS_POSITIONS: 'portfolio_positions_v2',
  LS_CACHE: 'amygdale_price_cache_v1',
  LS_HISTORY: 'amygdale_history_v1',
  CACHE_TTL: 5 * 60 * 1000,      // 5 minutos
  DEFAULT_MEP: 1200,
  HISTORY_MAX: 365,
  NOTIFICATION_MAX_VISIBLE: 5,
  AUTO_DISMISS: {
    success: 4500,
    error: 7000,
    warning: 8000,
    info: 5000
  }
};

const API = {
  BONDS_DATA: '/api/bonds',
  BONDS_TOP_TIR: '/api/top/tir',
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

/* ═══════════════════════════════════════════════
NOTIFICATION SYSTEM (Institutional Overlay)
═══════════════════════════════════════════════ */
const NotificationManager = {
  stackElement: null,
  init() {
    this.stackElement = document.getElementById('notification-stack');
    if (!this.stackElement) console.warn('Notification stack container missing');
  },
  show(type, title, message, duration = null) {
    if (!this.stackElement) this.init();
    if (!this.stackElement) return;

    const autoClose = duration !== null ? duration : CONFIG.AUTO_DISMISS[type] || 5000;
    const notif = document.createElement('div');
    notif.className = `notification-card ${type}`;
    notif.setAttribute('role', 'alert');
    notif.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');

    const iconMap = { success: '✓', error: '✗', warning: '⚠', info: 'ℹ' };
    const icon = iconMap[type] || '●';

    notif.innerHTML = `
      <div class="notification-icon">${icon}</div>
      <div class="notification-content">
        <div class="notification-title">${escapeHtml(title)}</div>
        <div class="notification-message">${escapeHtml(message)}</div>
        <div class="notification-time">${new Date().toLocaleTimeString()}</div>
      </div>
      <button class="notification-dismiss" aria-label="Cerrar">✕</button>
    `;

    notif.querySelector('.notification-dismiss').addEventListener('click', () => this.dismiss(notif));

    const currentChildren = Array.from(this.stackElement.children);
    if (currentChildren.length >= CONFIG.NOTIFICATION_MAX_VISIBLE) {
      this.dismiss(currentChildren[0]);
    }

    this.stackElement.appendChild(notif);

    if (autoClose > 0) {
      notif.timeoutId = setTimeout(() => {
        if (notif.isConnected) this.dismiss(notif);
      }, autoClose);
    }
    return notif;
  },
  dismiss(notificationElement) {
    if (!notificationElement || !notificationElement.isConnected) return;
    if (notificationElement.timeoutId) clearTimeout(notificationElement.timeoutId);
    notificationElement.classList.add('removing');
    notificationElement.addEventListener('animationend', () => {
      if (notificationElement.isConnected) notificationElement.remove();
    }, { once: true });
  },
  clearAll() {
    if (this.stackElement) {
      Array.from(this.stackElement.children).forEach(child => this.dismiss(child));
    }
  }
};

// Helper seguro contra XSS
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[m]);
}
window.showNotification = (type, title, message, duration) => NotificationManager.show(type, title, message, duration);

/* ═══════════════════════════════════════════════
ESTADO GLOBAL
═══════════════════════════════════════════════ */
const State = {
  positions: [],
  priceCache: {},
  marketBonds: [],
  mepRate: null,
  activeType: 'ar',
  activeRange: 'ytd',
  processed: [],
  charts: { pie: null, line: null },
};

/* ═══════════════════════════════════════════════
UTILIDADES BASE
═══════════════════════════════════════════════ */
const $ = (id) => document.getElementById(id);
const Storage = {
  get: (key) => {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } 
    catch { return null; }
  },
  set: (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } 
    catch (e) { console.warn('⚠️ localStorage error:', e); return false; }
  },
  remove: (key) => localStorage.removeItem(key),
};
const Format = {
  usd: (v) => '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  ars: (v) => '$' + Math.abs(v).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  pct: (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + '%',
  qty: (v) => v.toFixed(2),
  weight: (v) => v.toFixed(1) + '%',
  date: (d) => new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }),
};
const isPositive = (v) => v >= 0;
const isArgentineBond = (t) => Object.prototype.hasOwnProperty.call(BOND_SYMBOLS, t.toUpperCase());

/* ═══════════════════════════════════════════════
CACHE CON TTL
═══════════════════════════════════════════════ */
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
  clear() { Storage.remove(CONFIG.LS_CACHE); },
};

/* ═══════════════════════════════════════════════
RETRY UTIL (Exponential Backoff)
═══════════════════════════════════════════════ */
async function fetchWithRetry(url, retries = 2, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fetchWithProxy(url);
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(res => setTimeout(res, delay * Math.pow(2, i)));
    }
  }
}

/* ═══════════════════════════════════════════════
RELOJES
═══════════════════════════════════════════════ */
function updateClocks() {
  const opts = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
  const ba = new Date().toLocaleTimeString('es-AR', { ...opts, timeZone: 'America/Argentina/Buenos_Aires' });
  const ny = new Date().toLocaleTimeString('en-US', { ...opts, timeZone: 'America/New_York' });
  if ($('clockAR')) $('clockAR').textContent = `BA ${ba}`;
  if ($('clockNY')) $('clockNY').textContent = `NY ${ny}`;
}

/* ═══════════════════════════════════════════════
HISTÓRICO DIARIO
═══════════════════════════════════════════════ */
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
  if (history.length > CONFIG.HISTORY_MAX) history.splice(0, history.length - CONFIG.HISTORY_MAX);
  Storage.set(CONFIG.LS_HISTORY, history);
}

/* ═══════════════════════════════════════════════
MÉTRICAS
═══════════════════════════════════════════════ */
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

/* ═══════════════════════════════════════════════
GRÁFICOS
═══════════════════════════════════════════════ */
function renderPieChart(processed) {
  const ctx = $('pieChart')?.getContext('2d');
  if (!ctx || processed.length === 0) return;
  if (State.charts.pie) State.charts.pie.destroy();
  const colors = ['#378ADD', '#1D9E75', '#E8A838', '#E05C5C', '#8B5CF6', '#F97316', '#06B6D4', '#84CC16'];
  State.charts.pie = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: processed.map(p => p.pos.ticker),
      datasets: [{ data: processed.map(p => p.valUSD), backgroundColor: colors.slice(0, processed.length), borderWidth: 0 }]
    },
    options: { plugins: { legend: { display: false } }, maintainAspectRatio: false, cutout: '70%', responsive: true }
  });
  const legend = $('pieLegend');
  if (legend) legend.innerHTML = processed.map((p, i) => `<span><span class="leg-dot" style="background:${colors[i]}"></span>${p.pos.ticker}</span>`).join('');
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
    const points = 30; let curr = State.processed.reduce((s, i) => s + i.valUSD, 0) * 0.85; let bench = curr * 0.98;
    for (let i = 0; i < points; i++) {
      const d = new Date(); d.setDate(d.getDate() - (points - i));
      curr *= 1 + (Math.random() - 0.4) * 0.03; bench *= 1 + (Math.random() - 0.45) * 0.02;
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
    options: { plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } }, maintainAspectRatio: false, responsive: true, scales: { x: { display: false }, y: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { callback: v => `$${v.toLocaleString()}` } } } }
  });
}

/* ═══════════════════════════════════════════════
SINCRONIZACIÓN DE MERCADO
═══════════════════════════════════════════════ */
async function fetchBondsMarketData() {
  try {
    const res = await fetch(API.BONDS_DATA);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const result = await res.json();
    if (result.success && Array.isArray(result.data)) {
      State.marketBonds = result.data;
      result.data.forEach(bond => {
        State.priceCache[bond.symbol.toUpperCase()] = { price: bond.price, change: parseFloat(bond.change) || 0, source: 'Amygdalé API' };
      });
      NotificationManager.show('info', 'Mercado sincronizado', `${result.count} bonos actualizados.`, 3000);
    } else { throw new Error('Formato inválido'); }
  } catch (e) {
    console.error('[Fetch Error] Fallo sincronización bonos:', e.message);
    NotificationManager.show('error', 'Error de sincronización', `No se cargaron bonos: ${e.message}`, 6000);
    State.marketBonds = [];
  }
}

async function renderBondsInsightWidget() {
  const container = $('bondsInsightContainer');
  if (!container) return;
  try {
    const res = await fetch(API.BONDS_TOP_TIR);
    if (!res.ok) throw new Error();
    const result = await res.json();
    if (!result.success || !Array.isArray(result.data) || result.data.length === 0) {
      container.innerHTML = '<div class="empty-row">Métricas de TIR no disponibles</div>';
      return;
    }
    container.innerHTML = '';
    result.data.slice(0, 5).forEach(bond => {
      const row = document.createElement('div'); row.className = 'insight-row';
      row.innerHTML = `<span class="insight-symbol">${bond.symbol}</span><span class="insight-details">u$s ${bond.price.toFixed(2)} | TIR: ${bond.tir.toFixed(1)}% | Par: ${bond.paridad.toFixed(1)}%</span>`;
      container.appendChild(row);
    });
  } catch { container.innerHTML = '<div class="error-msg">Error de conexión con análisis</div>'; }
}

/* ═══════════════════════════════════════════════
RIESGO DE CARTERA
═══════════════════════════════════════════════ */
function checkPortfolioRisk(processed, totalVal) {
  if (!processed.length || totalVal <= 0) return;
  const highWeight = processed.find(item => (item.valUSD / totalVal) * 100 > 40);
  if (highWeight) NotificationManager.show('warning', 'Riesgo de concentración', `${highWeight.pos.ticker} >40% cartera. Diversifique.`, 8000);
  
  const todayChangeWeighted = processed.reduce((acc, item) => acc + (item.valUSD / totalVal) * item.info.change, 0);
  if (todayChangeWeighted < -3) NotificationManager.show('warning', 'Caída significativa', `Rendimiento: ${Format.pct(todayChangeWeighted)}. Revise exposición.`, 7000);
  
  const bestPerformer = processed.reduce((best, item) => item.info.change > best.change ? { ticker: item.pos.ticker, change: item.info.change } : best, { ticker: '', change: -Infinity });
  if (bestPerformer.change > 5) NotificationManager.show('info', 'Oportunidad táctica', `${bestPerformer.ticker} +${bestPerformer.change.toFixed(2)}%. Revise fundamentales.`, 6000);
}

/* ═══════════════════════════════════════════════
RENDER PRINCIPAL
═══════════════════════════════════════════════ */
function renderAll() {
  let totalPortfolioUSD = 0;
  const tbody = $('posTable');
  State.processed = State.positions.map(pos => {
    const info = State.priceCache[pos.ticker.toUpperCase()] || { price: 0, change: 0 };
    const holdings = pos.holdings || [];
    const totalQty = holdings.reduce((sum, h) => sum + h.qty, 0);
    const totalCostUSD = holdings.reduce((sum, h) => {
      const tc = h.tc || State.mepRate || 1;
      const priceUSD = pos.type === 'ar' ? h.price / tc : h.price;
      return sum + priceUSD * h.qty;
    }, 0);
    const currentValUSD = pos.type === 'ar' ? (info.price * totalQty) / (State.mepRate || 1) : info.price * totalQty;
    const pnlUSD = currentValUSD - totalCostUSD;
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
  checkPortfolioRisk(State.processed, totalPortfolioUSD);
  
  if (State.processed.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty-row">Agregá tu primera posición ↑</td></tr>';
    return;
  }
  tbody.innerHTML = State.processed.map((item, i) => {
    const { pos, info, qty, valUSD, pnlUSD, per, ppcOriginal } = item;
    const weight = totalPortfolioUSD > 0 ? (valUSD / totalPortfolioUSD) * 100 : 0;
    const firstDate = new Date(Math.min(...pos.holdings.map(h => new Date(h.date).getTime())));
    const tenencia = Math.ceil((Date.now() - firstDate) / (1000 * 60 * 60 * 24));
    const badge = getAssetBadge(pos.ticker, pos.type);
    return `<tr><td><strong>${pos.ticker}</strong> ${badge}</td><td>${pos.type === 'ar' ? Format.ars(info.price) : Format.usd(info.price)}</td><td class="${isPositive(info.change) ? 'pos' : 'neg'}">${Format.pct(info.change)}</td><td>${Format.qty(qty)}</td><td>${pos.type === 'ar' ? Format.ars(ppcOriginal) : Format.usd(ppcOriginal)}</td><td>${tenencia}d</td><td>${Format.weight(weight)}</td><td class="${isPositive(pnlUSD) ? 'pos' : 'neg'}">${Format.usd(pnlUSD)}</td><td class="${isPositive(per) ? 'pos' : 'neg'}">${Format.pct(per)}</td><td><button class="del-btn" onclick="window.deletePos(${i})">✕</button></td></tr>`;
  }).join('');
}

function getAssetBadge(ticker, type) {
  if (type === 'crypto') return '<span class="type-badge crypto">CRYPTO</span>';
  if (type === 'ar' && isArgentineBond(ticker)) return '<span class="type-badge bond">BONO AR</span>';
  if (type === 'ar') return '<span class="type-badge stock">ACCIÓN AR</span>';
  return '<span class="type-badge global">GLOBAL</span>';
}

/* ═══════════════════════════════════════════════
API DE PRECIOS (MEJORADA)
═══════════════════════════════════════════════ */
async function fetchWithProxy(url) {
  const fullUrl = `${CONFIG.PROXY}?url=${encodeURIComponent(url)}`;
  const res = await fetch(fullUrl, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getPrice(ticker, type) {
  const uppercaseTicker = ticker.toUpperCase();

  // 1️⃣ Bonos AR -> API interna
  if (type === 'ar' && isArgentineBond(uppercaseTicker)) {
    const symbol = BOND_SYMBOLS[uppercaseTicker] || uppercaseTicker;
    let localBond = State.marketBonds.find(b => b.symbol.toUpperCase() === symbol);
    if (!localBond) {
      await fetchBondsMarketData();
      localBond = State.marketBonds.find(b => b.symbol.toUpperCase() === symbol);
    }
    if (localBond) return { price: localBond.price, change: localBond.change || 0, source: 'Amygdalé API' };
  }

  // 2️⃣ Crypto -> CoinGecko
  if (type === 'crypto') {
    const id = CRYPTO_MAP[uppercaseTicker] || ticker.toLowerCase();
    try {
      const data = await fetchWithRetry(`${API.COINGECKO}?ids=${id}&vs_currencies=usd&include_24hr_change=true`);
      const coin = data[Object.keys(data)[0]];
      if (coin?.usd) return { price: coin.usd, change: coin.usd_24h_change || 0, source: 'CoinGecko' };
    } catch { console.warn(`⚠️ CoinGecko falló para ${ticker}`); }
  }

  // 3️⃣ Yahoo Finance -> Retry + Fallback
  const yahooUrls = [];
  if (type === 'ar') yahooUrls.push(`${API.YAHOO}${uppercaseTicker}.BA?interval=1d&range=2d`);
  else yahooUrls.push(`${API.YAHOO}${uppercaseTicker}?interval=1d&range=2d`);

  for (const url of yahooUrls) {
    try {
      const data = await fetchWithRetry(url);
      const meta = data?.chart?.result?.[0]?.meta;
      if (meta?.regularMarketPrice && meta.regularMarketPrice > 0) {
        const prev = meta.chartPreviousClose || meta.previousClose || meta.regularMarketPrice;
        const change = ((meta.regularMarketPrice - prev) / prev) * 100;
        return { price: meta.regularMarketPrice, change, source: 'Yahoo' };
      }
    } catch (e) { console.warn(`⚠️ Yahoo falló en ${url}: ${e.message}`); }
  }

  // 4️⃣ Fallback: Caché stale (mejor que precio 0)
  const staleCache = Storage.get(CONFIG.LS_CACHE)?.[uppercaseTicker]?.data;
  if (staleCache && staleCache.price > 0) {
    console.log(`🔄 Usando caché stale para ${uppercaseTicker}`);
    return { ...staleCache, source: 'Cache (stale)' };
  }

  // 5️⃣ Último recurso
  return { price: 0, change: 0, source: 'N/A' };
}

async function getPriceCached(ticker, type) {
  const uppercaseTicker = ticker.toUpperCase();
  const cached = PriceCache.get(uppercaseTicker);
  if (cached) return cached;
  const fresh = await getPrice(uppercaseTicker, type);
  if (fresh.price > 0) PriceCache.set(uppercaseTicker, fresh);
  return fresh;
}

/* ═══════════════════════════════════════════════
FORMULARIO & EVENTOS
═══════════════════════════════════════════════ */
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
    NotificationManager.show('error', 'Error al agregar', 'Cantidad o precio inválidos.', 4000);
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
  if ($('bondsInsightContainer')) await renderBondsInsightWidget();
  NotificationManager.show('success', 'Posición agregada', `${qty} ${ticker} añadido.`, 4000);
}

/* ═══════════════════════════════════════════════
EXPORT / IMPORT JSON
═══════════════════════════════════════════════ */
function exportPortfolio() {
  try {
    const payload = { version: '2.2', exported: new Date().toISOString(), positions: State.positions, history: Storage.get(CONFIG.LS_HISTORY) || [] };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `amygdale_backup_${new Date().toISOString().slice(0, 10)}.json`; a.click();
    URL.revokeObjectURL(url);
    NotificationManager.show('success', 'Exportación completa', 'Backup generado.', 3500);
  } catch (err) { NotificationManager.show('error', 'Error al exportar', err.message, 5000); }
}

function injectControls() {
  const container = $('controlsContainer');
  if (!container || $('btnExport')) return;
  const fileInput = document.createElement('input'); fileInput.type = 'file'; fileInput.accept = '.json'; fileInput.style.display = 'none'; fileInput.id = 'importInput';
  document.body.appendChild(fileInput);
  
  const controls = document.createElement('div'); controls.className = 'footer-controls';
  controls.innerHTML = `<button class="ctrl-btn" id="btnExport">📥 Exportar</button><button class="ctrl-btn" id="btnImport">📤 Importar</button>`;
  container.appendChild(controls);
  
  $('btnExport').onclick = exportPortfolio;
  $('btnImport').onclick = () => $('importInput').click();
  $('importInput').onchange = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = JSON.parse(evt.target.result);
        if (data.positions) {
          State.positions = data.positions; Storage.set(CONFIG.LS_POSITIONS, State.positions);
          if (data.history) Storage.set(CONFIG.LS_HISTORY, data.history);
          init(); NotificationManager.show('success', 'Importación exitosa', 'Portafolio restaurado.', 4000);
        } else throw new Error('Archivo inválido');
      } catch (err) { NotificationManager.show('error', 'Error de importación', 'Archivo corrupto o inválido.', 6000); }
    };
    reader.readAsText(file);
  };
}

/* ═══════════════════════════════════════════════
INICIALIZACIÓN
═══════════════════════════════════════════════ */
async function init() {
  updateClocks();
  if (window.clockInterval) clearInterval(window.clockInterval);
  window.clockInterval = setInterval(updateClocks, 1000);
  
  State.positions = Storage.get(CONFIG.LS_POSITIONS) || [];
  try {
    const mep = await fetchWithProxy(API.DOLARAPI);
    State.mepRate = parseFloat(mep.venta) || CONFIG.DEFAULT_MEP;
    if ($('sourceRow')) $('sourceRow').textContent = `Dólar MEP: $${State.mepRate.toLocaleString('es-AR')}`;
    NotificationManager.show('info', 'Tipo de cambio actualizado', `MEP: $${State.mepRate.toLocaleString('es-AR')}`, 4000);
  } catch {
    State.mepRate = CONFIG.DEFAULT_MEP;
    NotificationManager.show('error', 'Error MEP', 'Usando valor por defecto.', 5000);
  }
  
  await fetchBondsMarketData();
  if (State.positions.length > 0) {
    const results = await Promise.allSettled(State.positions.map(p => getPriceCached(p.ticker, p.type)));
    State.positions.forEach((p, i) => {
      if (results[i].status === 'fulfilled') State.priceCache[p.ticker.toUpperCase()] = results[i].value;
    });
  }
  renderAll();
  injectControls();
  if ($('bondsInsightContainer')) await renderBondsInsightWidget();
  
  $('addBtn').onclick = handleAdd;
  document.querySelectorAll('.type-btn').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active'); State.activeType = btn.dataset.type;
  }));
  document.querySelectorAll('.range-btn').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active'); State.activeRange = btn.dataset.range; renderLineChart();
  }));
  
  window.deletePos = (index) => {
    const removed = State.positions[index];
    State.positions.splice(index, 1); Storage.set(CONFIG.LS_POSITIONS, State.positions);
    renderAll(); if ($('bondsInsightContainer')) renderBondsInsightWidget();
    NotificationManager.show('info', 'Posición eliminada', `${removed.ticker} removido.`, 3500);
  };
  
  NotificationManager.show('info', 'Sistema listo', 'Amygdalé monitoreando mercados y riesgos.', 3000);
}

NotificationManager.init();
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();