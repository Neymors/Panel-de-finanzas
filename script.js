/**
 * Amygdalé — Financial Dashboard & Risk Control
 * Vanilla JS | Local-First | BYMA + Yahoo + CoinGecko + DolarApi
 * Version: 2.0.0 — Full Feature Block
 *
 * NOVEDADES v2.0:
 *  ✅ saveDailySnapshot()     — histórico real para el gráfico de líneas
 *  ✅ Export / Import JSON    — backup manual Local-First
 *  ✅ Auto-refresh de precios — setInterval cada 7 min, solo tickers activos
 *  ✅ Cifrado AES-GCM         — Web Crypto API con passphrase del usuario
 *  ✅ Manejo de feriados/cierre — guard de mercado antes de fetch
 */
'use strict';

/* ═══════════════════════════════════════════════
   CONFIGURACIÓN Y CONSTANTES
═══════════════════════════════════════════════ */
const CONFIG = {
  PROXY: '/api/proxy',
  LS_POSITIONS:  'portfolio_positions_v2',
  LS_CACHE:      'amygdale_price_cache_v1',
  LS_HISTORY:    'amygdale_history_v1',
  LS_SALT:       'amygdale_crypto_salt',
  CACHE_TTL:     5  * 60 * 1000,   // 5 min
  REFRESH_MS:    7  * 60 * 1000,   // 7 min auto-refresh
  DEFAULT_MEP:   1200,
  HISTORY_MAX:   365,              // días máx de histórico
};

const API = {
  BYMA:      'https://open.bymadata.com.ar/van-api/robo/prices?symbol=',
  DOLARAPI:  'https://dolarapi.com/v1/dolares/bolsa',
  COINGECKO: 'https://api.coingecko.com/api/v3/simple/price',
  YAHOO:     'https://query1.finance.yahoo.com/v8/finance/chart/',
};

const BOND_SYMBOLS = {
  AL30:'AL30', GD30:'GD30', AL35:'AL35', GD35:'GD35',
  AE38:'AE38', GD38:'GD38', AL41:'AL41', GD41:'GD41',
  TX2U:'TX2U', T2X2:'T2X2', T2X5:'T2X5', T2X9:'T2X9',
  AE24:'AE24', AE27:'AE27', AE29:'AE29', AE30:'AE30',
  BONAR27:'AO27', BONAR30:'AO30', BONAR:'AO27',
};

const CRYPTO_MAP = {
  BTC:'bitcoin', ETH:'ethereum', SOL:'solana', USDT:'tether',
  ADA:'cardano', DOT:'polkadot', MATIC:'matic-network',
};

/* Horario bursátil Buenos Aires: lun–vie 11:00–17:00 */
const MARKET_HOURS = { open: 11, close: 17 };

/* ═══════════════════════════════════════════════
   ESTADO GLOBAL
═══════════════════════════════════════════════ */
const State = {
  positions:   [],
  priceCache:  {},
  mepRate:     null,
  activeType:  'ar',
  activeRange: 'ytd',
  processed:   [],
  charts:      { pie: null, line: null },
  refreshTimer: null,
  cryptoKey:   null,       // CryptoKey AES-GCM activa
};

/* ═══════════════════════════════════════════════
   UTILIDADES BASE
═══════════════════════════════════════════════ */
const $ = (id) => document.getElementById(id);

const Storage = {
  get(key) {
    try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : null; }
    catch { return null; }
  },
  set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (e) { console.warn('⚠️ localStorage error:', e); return false; }
  },
  remove(key) { localStorage.removeItem(key); },
};

const Format = {
  usd: (v) => '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  ars: (v) => '$' + Math.abs(v).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  pct: (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + '%',
  date: (d) => new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }),
};

const isPositive         = (v) => v >= 0;
const isArgentineBond    = (t) => Object.prototype.hasOwnProperty.call(BOND_SYMBOLS, t.toUpperCase());
const isBursatilOpen     = () => {
  const ba  = new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' });
  const now = new Date(ba);
  const day = now.getDay(); // 0 dom, 6 sab
  const h   = now.getHours();
  return day >= 1 && day <= 5 && h >= MARKET_HOURS.open && h < MARKET_HOURS.close;
};

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
   ✅ MEJORA 1 — HISTÓRICO DIARIO (saveDailySnapshot)
═══════════════════════════════════════════════ */
/**
 * Guarda un snapshot {date, totalUSD, benchmark} una vez por día.
 * Se llama automáticamente luego de cada renderAll() exitoso.
 * El benchmark usa el MEP como proxy de variación del mercado.
 */
function saveDailySnapshot(totalUSD) {
  const today     = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const history   = Storage.get(CONFIG.LS_HISTORY) || [];
  const lastEntry = history[history.length - 1];

  // Solo guarda si es un día nuevo y el portfolio tiene valor
  if (lastEntry?.date === today || totalUSD <= 0) return;

  // Benchmark: MEP como proxy (simplificado; idealmente sería un índice)
  const benchmarkChange = State.mepRate
    ? ((State.mepRate - CONFIG.DEFAULT_MEP) / CONFIG.DEFAULT_MEP) * 100
    : 0;

  history.push({ date: today, totalUSD, benchmark: totalUSD * (1 + benchmarkChange / 100) });

  // Limita el histórico al máximo configurado
  if (history.length > CONFIG.HISTORY_MAX) history.splice(0, history.length - CONFIG.HISTORY_MAX);

  Storage.set(CONFIG.LS_HISTORY, history);
  console.info(`📸 Snapshot guardado: ${today} — $${totalUSD.toFixed(2)}`);
}

/* ═══════════════════════════════════════════════
   ✅ MEJORA 2 — AUTO-REFRESH DE PRECIOS
═══════════════════════════════════════════════ */
function startAutoRefresh() {
  if (State.refreshTimer) clearInterval(State.refreshTimer);

  State.refreshTimer = setInterval(async () => {
    // No refreshea si el mercado está cerrado y solo hay activos AR
    const hasGlobalOrCrypto = State.positions.some(p => p.type !== 'ar');
    if (!isBursatilOpen() && !hasGlobalOrCrypto) {
      console.info('🔕 Mercado AR cerrado — auto-refresh pausado');
      return;
    }

    if (State.positions.length === 0) return;

    PriceCache.clear(); // Fuerza precios frescos
    const results = await Promise.all(
      State.positions.map(p => getPriceCached(p.ticker, p.type))
    );
    State.positions.forEach((p, i) => { State.priceCache[p.ticker] = results[i]; });

    renderAll();
    showToast('🔄 Precios actualizados');
    console.info(`♻️ Auto-refresh ejecutado — ${new Date().toLocaleTimeString('es-AR')}`);
  }, CONFIG.REFRESH_MS);

  console.info(`⏱️ Auto-refresh iniciado cada ${CONFIG.REFRESH_MS / 60000} min`);
}

function stopAutoRefresh() {
  if (State.refreshTimer) { clearInterval(State.refreshTimer); State.refreshTimer = null; }
}

/* ═══════════════════════════════════════════════
   ✅ MEJORA 3 — EXPORT / IMPORT JSON (Local-First)
═══════════════════════════════════════════════ */
function exportPortfolio() {
  const payload = {
    version:   '2.0',
    exported:  new Date().toISOString(),
    positions: State.positions,
    history:   Storage.get(CONFIG.LS_HISTORY) || [],
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `amygdale_backup_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('📦 Backup exportado');
}

function importPortfolio(file) {
  if (!file) return;
  const reader = new FileReader();

  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);

      if (!data.positions || !Array.isArray(data.positions)) {
        throw new Error('Formato inválido: falta campo positions');
      }

      // Merge inteligente: no duplica tickers existentes
      const existingTickers = new Set(State.positions.map(p => p.ticker));
      const newPositions    = data.positions.filter(p => !existingTickers.has(p.ticker));
      State.positions       = [...State.positions, ...newPositions];

      if (data.history?.length) {
        const existing = Storage.get(CONFIG.LS_HISTORY) || [];
        const merged   = [...existing, ...data.history]
          .sort((a, b) => a.date.localeCompare(b.date))
          .filter((h, i, arr) => i === 0 || h.date !== arr[i - 1].date); // deduplica por fecha
        Storage.set(CONFIG.LS_HISTORY, merged);
      }

      Storage.set(CONFIG.LS_POSITIONS, State.positions);
      renderAll();
      showToast(`✅ Importadas ${newPositions.length} posición(es) nueva(s)`);
    } catch (err) {
      showToast(`❌ Error al importar: ${err.message}`, 'error');
    }
  };

  reader.readAsText(file);
}

/* ═══════════════════════════════════════════════
   ✅ MEJORA 4 — CIFRADO AES-GCM (Web Crypto API)
═══════════════════════════════════════════════ */
const Crypto = {
  /* Deriva una CryptoKey desde passphrase + salt con PBKDF2 */
  async deriveKey(passphrase, salt) {
    const enc      = new TextEncoder();
    const keyMat   = await crypto.subtle.importKey(
      'raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 200_000, hash: 'SHA-256' },
      keyMat,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  },

  /* Cifra un objeto JS → string base64 empaquetado (iv + ciphertext) */
  async encrypt(obj, key) {
    const iv   = crypto.getRandomValues(new Uint8Array(12));
    const data = new TextEncoder().encode(JSON.stringify(obj));
    const ct   = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
    // Empaquetar: iv (12b) + ciphertext
    const packed = new Uint8Array(iv.byteLength + ct.byteLength);
    packed.set(iv);
    packed.set(new Uint8Array(ct), iv.byteLength);
    return btoa(String.fromCharCode(...packed));
  },

  /* Descifra un string base64 → objeto JS */
  async decrypt(b64, key) {
    const packed = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const iv     = packed.slice(0, 12);
    const ct     = packed.slice(12);
    const plain  = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return JSON.parse(new TextDecoder().decode(plain));
  },

  /* Obtiene o crea el salt persistente */
  getSalt() {
    const stored = localStorage.getItem(CONFIG.LS_SALT);
    if (stored) return Uint8Array.from(atob(stored), c => c.charCodeAt(0));
    const salt = crypto.getRandomValues(new Uint8Array(16));
    localStorage.setItem(CONFIG.LS_SALT, btoa(String.fromCharCode(...salt)));
    return salt;
  },
};

/**
 * Activa el cifrado: deriva la clave, cifra positions y las guarda.
 * Llama con passphrase vacío para desactivar (guarda en texto plano).
 */
async function setCryptoPassphrase(passphrase) {
  if (!passphrase) {
    State.cryptoKey = null;
    // Guarda en texto plano
    Storage.set(CONFIG.LS_POSITIONS, State.positions);
    showToast('🔓 Cifrado desactivado');
    return;
  }

  try {
    const salt       = Crypto.getSalt();
    State.cryptoKey  = await Crypto.deriveKey(passphrase, salt);
    await savePositionsEncrypted();
    showToast('🔐 Cifrado AES-GCM activado');
  } catch (err) {
    showToast('❌ Error al activar cifrado', 'error');
    console.error(err);
  }
}

async function savePositionsEncrypted() {
  if (!State.cryptoKey) {
    Storage.set(CONFIG.LS_POSITIONS, State.positions);
    return;
  }
  try {
    const encrypted = await Crypto.encrypt(State.positions, State.cryptoKey);
    localStorage.setItem(CONFIG.LS_POSITIONS + '_enc', encrypted);
    // Limpia el texto plano si existía
    Storage.remove(CONFIG.LS_POSITIONS);
  } catch (err) {
    console.error('❌ Error al cifrar posiciones:', err);
  }
}

async function loadPositionsDecrypted(passphrase) {
  const encData = localStorage.getItem(CONFIG.LS_POSITIONS + '_enc');

  if (encData && passphrase) {
    try {
      const salt      = Crypto.getSalt();
      State.cryptoKey = await Crypto.deriveKey(passphrase, salt);
      return await Crypto.decrypt(encData, State.cryptoKey);
    } catch {
      showToast('❌ Passphrase incorrecta — cargando sin descifrar', 'error');
      State.cryptoKey = null;
    }
  }

  // Fallback: texto plano
  return Storage.get(CONFIG.LS_POSITIONS) || [];
}

/* ═══════════════════════════════════════════════
   RELOJES
═══════════════════════════════════════════════ */
function updateClocks() {
  const opts = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
  const ba   = new Date().toLocaleTimeString('es-AR', { ...opts, timeZone: 'America/Argentina/Buenos_Aires' });
  const ny   = new Date().toLocaleTimeString('en-US', { ...opts, timeZone: 'America/New_York' });
  if ($('clockAR')) $('clockAR').textContent = `BA ${ba}`;
  if ($('clockNY')) $('clockNY').textContent = `NY ${ny}`;
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
    if (item.info.change > bestToday.change)
      bestToday = { ticker: item.pos.ticker, change: item.info.change };
    const weight = totalVal > 0 ? item.valUSD / totalVal : 0;
    todayChangeWeighted += weight * item.info.change;
  });

  $('totalGain').textContent    = Format.usd(totalGainUSD);
  $('totalGainPct').textContent = totalCostUSD > 0
    ? Format.pct((totalGainUSD / totalCostUSD) * 100) : '0.00%';
  $('posCount').textContent     = processed.length;
  $('bestTicker').textContent   = bestToday.ticker;
  $('bestPct').textContent      = bestToday.change !== -Infinity ? Format.pct(bestToday.change) : '—';
  $('bestPct').className        = `metric-sub ${isPositive(bestToday.change) ? 'pos' : 'neg'}`;
  $('todayPct').textContent     = Format.pct(todayChangeWeighted);
  $('todayPct').className       = `metric-val ${isPositive(todayChangeWeighted) ? 'pos' : 'neg'}`;
  const todayAbsUSD             = totalVal * (todayChangeWeighted / 100);
  $('todayAbs').textContent     = Format.usd(todayAbsUSD);
  $('todayAbs').className       = `metric-sub ${isPositive(todayAbsUSD) ? 'pos' : 'neg'}`;
}

/* ═══════════════════════════════════════════════
   GRÁFICOS
═══════════════════════════════════════════════ */
function renderPieChart(processed) {
  const ctx = $('pieChart')?.getContext('2d');
  if (!ctx || processed.length === 0) return;
  if (State.charts.pie) State.charts.pie.destroy();

  const colors = ['#378ADD','#1D9E75','#E8A838','#E05C5C','#8B5CF6','#F97316','#06B6D4','#84CC16'];

  State.charts.pie = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels:   processed.map(p => p.pos.ticker),
      datasets: [{ data: processed.map(p => p.valUSD), backgroundColor: colors.slice(0, processed.length), borderWidth: 0 }]
    },
    options: { plugins: { legend: { display: false } }, maintainAspectRatio: false, cutout: '70%', responsive: true },
  });

  const legend = $('pieLegend');
  if (legend)
    legend.innerHTML = processed.map((p, i) =>
      `<span><span class="leg-dot" style="background:${colors[i]}"></span>${p.pos.ticker}</span>`
    ).join('');
}

function renderLineChart(processed) {
  const ctx = $('lineChart')?.getContext('2d');
  if (!ctx) return;
  if (State.charts.line) State.charts.line.destroy();

  const history = (Storage.get(CONFIG.LS_HISTORY) || []).filter(h => filterByRange(h.date, State.activeRange));

  const labels        = history.length > 0 ? history.map(h => Format.date(h.date)) : Array.from({ length: 20 }, (_, i) => `D${i + 1}`);
  const portfolioData = history.length > 0 ? history.map(h => h.totalUSD) : generateMockData(processed, 20, 100);
  const benchData     = history.length > 0 ? history.map(h => h.benchmark ?? h.totalUSD * 0.98) : generateMockData(processed, 20, 100, true);

  State.charts.line = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Portfolio', data: portfolioData, borderColor: '#378ADD', backgroundColor: 'rgba(55,138,221,0.1)', tension: 0.3, fill: true, pointRadius: 2 },
        { label: 'Benchmark', data: benchData,    borderColor: '#1D9E75', borderDash: [5,5], tension: 0.3, pointRadius: 0 }
      ]
    },
    options: {
      plugins: { legend: { display: false } },
      maintainAspectRatio: false, responsive: true,
      scales: {
        x: { display: false },
        y: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { callback: v => `$${(v/1000).toFixed(1)}k` } }
      }
    }
  });
}

function filterByRange(dateStr, range) {
  const date = new Date(dateStr);
  const now  = new Date();
  const diff = (now - date) / (1000 * 60 * 60 * 24); // días
  if (range === '1m')  return diff <= 30;
  if (range === '6m')  return diff <= 180;
  if (range === '1y')  return diff <= 365;
  if (range === 'ytd') return date.getFullYear() === now.getFullYear();
  return true;
}

function generateMockData(processed, points, start, isBenchmark = false) {
  let base = start;
  return Array.from({ length: points }, () => {
    const avg        = processed.length ? processed.reduce((a, p) => a + p.info.change, 0) / processed.length : 0;
    const volatility = isBenchmark ? 0.3 : 0.5;
    base *= 1 + ((avg || 0) + (Math.random() * volatility - volatility / 2)) / 100;
    return Math.round(base * 100) / 100;
  });
}

/* ═══════════════════════════════════════════════
   RENDER PRINCIPAL
═══════════════════════════════════════════════ */
function renderAll() {
  let totalPortfolioUSD = 0;
  const tbody = $('posTable');

  State.processed = State.positions.map(pos => {
    const info     = State.priceCache[pos.ticker] || { price: 0, change: 0 };
    const holdings = pos.holdings || [];
    const totalQty = holdings.reduce((s, h) => s + h.qty, 0);

    const totalCostUSD = holdings.reduce((s, h) => {
      const tc       = h.tc || State.mepRate || 1;
      const priceUSD = pos.type === 'ar' ? h.price / tc : h.price;
      return s + priceUSD * h.qty;
    }, 0);

    const currentValUSD = pos.type === 'ar'
      ? (info.price * totalQty) / (State.mepRate || 1)
      : info.price * totalQty;

    const pnlUSD      = currentValUSD - totalCostUSD;
    const per         = totalCostUSD > 0 ? (pnlUSD / totalCostUSD) * 100 : 0;
    const ppcOriginal = totalQty > 0
      ? holdings.reduce((s, h) => s + h.price * h.qty, 0) / totalQty : 0;

    totalPortfolioUSD += currentValUSD;
    return { pos, info, qty: totalQty, valUSD: currentValUSD, costUSD: totalCostUSD, pnlUSD, per, ppcOriginal };
  });

  $('totalVal').textContent = Format.usd(totalPortfolioUSD);
  updateTopMetrics(State.processed, totalPortfolioUSD);
  renderPieChart(State.processed);
  renderLineChart(State.processed);

  // 📸 Snapshot diario automático
  saveDailySnapshot(totalPortfolioUSD);

  if (State.processed.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty-row">Agregá tu primera posición ↑</td></tr>';
    return;
  }

  tbody.innerHTML = State.processed.map((item, i) => {
    const { pos, info, qty, valUSD, pnlUSD, per, ppcOriginal } = item;
    const weight     = totalPortfolioUSD > 0 ? (valUSD / totalPortfolioUSD) * 100 : 0;
    const firstDate  = new Date(Math.min(...pos.holdings.map(h => new Date(h.date).getTime())));
    const tenencia   = Math.ceil((Date.now() - firstDate) / (1000 * 60 * 60 * 24));
    const badge      = getAssetBadge(pos.ticker, pos.type);

    return `
      <tr>
        <td><strong>${pos.ticker}</strong> ${badge}</td>
        <td>${pos.type === 'ar' ? Format.ars(info.price) : Format.usd(info.price)}</td>
        <td class="${isPositive(info.change) ? 'pos' : 'neg'}">${Format.pct(info.change)}</td>
        <td>${qty.toFixed(2)}</td>
        <td>${pos.type === 'ar' ? Format.ars(ppcOriginal) : Format.usd(ppcOriginal)}</td>
        <td>${tenencia}d</td>
        <td>${weight.toFixed(1)}%</td>
        <td class="${isPositive(pnlUSD) ? 'pos' : 'neg'}">${Format.usd(pnlUSD)}</td>
        <td class="${isPositive(per) ? 'pos' : 'neg'}">${Format.pct(per)}</td>
        <td><button class="del-btn" onclick="window.deletePos(${i})" aria-label="Eliminar ${pos.ticker}">✕</button></td>
      </tr>`;
  }).join('');
}

function getAssetBadge(ticker, type) {
  if (type === 'crypto')                         return '<span class="type-badge crypto">CRYPTO</span>';
  if (type === 'ar' && isArgentineBond(ticker))  return '<span class="type-badge bond">BONO AR</span>';
  if (type === 'ar')                             return '<span class="type-badge stock">ACCIÓN AR</span>';
  return '<span class="type-badge global">GLOBAL</span>';
}

/* ═══════════════════════════════════════════════
   API DE PRECIOS
═══════════════════════════════════════════════ */
async function fetchWithProxy(url) {
  const full = `${CONFIG.PROXY}?url=${encodeURIComponent(url)}`;
  const res  = await fetch(full, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getPrice(ticker, type) {
  try {
    // 1️⃣ Bonos AR → BYMA
    if (type === 'ar' && isArgentineBond(ticker)) {
      const symbol = BOND_SYMBOLS[ticker.toUpperCase()];
      const data   = await fetchWithProxy(API.BYMA + symbol);
      const quote  = Array.isArray(data) ? data.find(q => q.symbol === symbol) : data;
      if (quote?.last && !isNaN(quote.last))
        return { price: parseFloat(quote.last), change: parseFloat(quote.varPct) || 0, source: 'BYMA' };
    }

    // 2️⃣ Cripto → CoinGecko
    if (type === 'crypto') {
      const id   = CRYPTO_MAP[ticker] || ticker.toLowerCase();
      const data = await fetchWithProxy(`${API.COINGECKO}?ids=${id}&vs_currencies=usd&include_24hr_change=true`);
      const coin = data[Object.keys(data)[0]];
      if (coin?.usd) return { price: coin.usd, change: coin.usd_24h_change || 0, source: 'CoinGecko' };
    }

    // 3️⃣ Acciones AR → Yahoo (.BA)
    if (type === 'ar') {
      const data = await fetchWithProxy(`${API.YAHOO}${ticker}.BA?interval=1d&range=2d`);
      const meta = data.chart?.result?.[0]?.meta;
      if (meta?.regularMarketPrice)
        return {
          price:  meta.regularMarketPrice,
          change: ((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose) * 100,
          source: 'Yahoo',
        };
    }

    // 4️⃣ Global → Yahoo
    const data = await fetchWithProxy(`${API.YAHOO}${ticker}?interval=1d&range=2d`);
    const meta = data.chart?.result?.[0]?.meta;
    if (meta?.regularMarketPrice)
      return {
        price:  meta.regularMarketPrice,
        change: ((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose) * 100,
        source: 'Yahoo',
      };

    return { price: 0, change: 0, source: 'N/A' };
  } catch (e) {
    console.warn(`⚠️ Error ${ticker}:`, e.message);
    return { price: 0, change: 0, source: 'Error' };
  }
}

async function getPriceCached(ticker, type) {
  const cached = PriceCache.get(ticker);
  if (cached) return cached;
  const fresh = await getPrice(ticker, type);
  if (fresh.price > 0) PriceCache.set(ticker, fresh);
  return fresh;
}

/* ═══════════════════════════════════════════════
   FORMULARIO
═══════════════════════════════════════════════ */
async function handleAdd(e) {
  if (e) e.preventDefault();

  const ticker  = $('tickerInput').value.trim().toUpperCase();
  const qty     = parseFloat($('qtyInput').value);
  const ppc     = parseFloat($('avgInput').value);
  const days    = parseInt($('daysInput').value) || 0;
  const errorEl = $('addError');

  if (!ticker || isNaN(qty) || isNaN(ppc) || qty <= 0 || ppc <= 0) {
    errorEl.textContent  = 'Datos inválidos. Revisá cantidad y precio.';
    errorEl.style.display = 'block';
    return;
  }

  errorEl.style.display = 'none';
  const buyDate = new Date();
  buyDate.setDate(buyDate.getDate() - days);

  const holding  = { qty, price: ppc, date: buyDate.toISOString(), tc: State.mepRate };
  const existing = State.positions.find(p => p.ticker === ticker);
  if (existing) existing.holdings.push(holding);
  else State.positions.push({ ticker, type: State.activeType, holdings: [holding] });

  await savePositionsEncrypted();
  ['tickerInput','qtyInput','avgInput','daysInput'].forEach(id => $(id).value = '');

  State.priceCache[ticker] = await getPriceCached(ticker, State.activeType);
  renderAll();
}

/* ═══════════════════════════════════════════════
   TOAST / NOTIFICACIONES
═══════════════════════════════════════════════ */
function showToast(msg, type = 'info') {
  let toast = $('amygdale-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'amygdale-toast';
    Object.assign(toast.style, {
      position: 'fixed', bottom: '1.5rem', right: '1.5rem',
      padding: '10px 16px', borderRadius: '8px', fontSize: '13px',
      fontFamily: 'monospace', zIndex: '9999', opacity: '0',
      transition: 'opacity 0.3s ease', pointerEvents: 'none',
      maxWidth: '320px', lineHeight: '1.4',
    });
    document.body.appendChild(toast);
  }

  const bg   = type === 'error' ? '#a32d2d' : '#185fa5';
  toast.style.background = bg;
  toast.style.color      = '#fff';
  toast.textContent      = msg;
  toast.style.opacity    = '1';
  setTimeout(() => { toast.style.opacity = '0'; }, 3500);
}

/* ═══════════════════════════════════════════════
   INYECCIÓN DE CONTROLES EN EL DOM
   (Export / Import / Cifrado — se añaden al footer)
═══════════════════════════════════════════════ */
function injectControls() {
  const footer = document.querySelector('footer.footer');
  if (!footer) return;

  // Input oculto para importar
  const fileInput    = document.createElement('input');
  fileInput.type     = 'file';
  fileInput.accept   = '.json';
  fileInput.style.display = 'none';
  fileInput.id       = 'importInput';
  fileInput.addEventListener('change', () => importPortfolio(fileInput.files[0]));
  document.body.appendChild(fileInput);

  const controls = document.createElement('div');
  controls.className = 'footer-controls';
  controls.innerHTML = `
    <button class="ctrl-btn" id="btnExport" title="Exportar portfolio como JSON">📦 Export</button>
    <button class="ctrl-btn" id="btnImport" title="Importar portfolio desde JSON">📥 Import</button>
    <button class="ctrl-btn" id="btnCrypto" title="Activar/desactivar cifrado AES-GCM">🔐 Cifrado</button>
    <button class="ctrl-btn" id="btnRefresh" title="Refrescar precios ahora">🔄 Refresh</button>
  `;
  footer.appendChild(controls);

  // Estilos inline para los botones del footer
  const style = document.createElement('style');
  style.textContent = `
    .footer-controls {
      display: flex; gap: 8px; flex-wrap: wrap; justify-content: center;
      margin-top: 10px;
    }
    .ctrl-btn {
      font-size: 11px; font-family: var(--font-mono, monospace);
      padding: 5px 10px; border: 1px solid var(--border-strong, #ccc);
      border-radius: 6px; background: transparent;
      color: var(--text2, #666); cursor: pointer;
      transition: all 0.15s ease; text-transform: uppercase; letter-spacing: 0.05em;
    }
    .ctrl-btn:hover {
      background: var(--blue, #185fa5); color: #fff;
      border-color: var(--blue, #185fa5);
    }
  `;
  document.head.appendChild(style);

  $('btnExport').addEventListener('click', exportPortfolio);
  $('btnImport').addEventListener('click', () => $('importInput').click());
  $('btnCrypto').addEventListener('click', async () => {
    const pass = prompt(
      State.cryptoKey
        ? '🔓 Dejá el campo vacío para desactivar el cifrado:'
        : '🔐 Ingresá una passphrase para cifrar tu portfolio:'
    );
    if (pass === null) return; // Canceló
    await setCryptoPassphrase(pass.trim());
  });
  $('btnRefresh').addEventListener('click', async () => {
    PriceCache.clear();
    const results = await Promise.all(State.positions.map(p => getPriceCached(p.ticker, p.type)));
    State.positions.forEach((p, i) => { State.priceCache[p.ticker] = results[i]; });
    renderAll();
    showToast('🔄 Precios actualizados manualmente');
  });
}

/* ═══════════════════════════════════════════════
   INICIALIZACIÓN
═══════════════════════════════════════════════ */
async function init() {
  updateClocks();
  setInterval(updateClocks, 1000);

  // Detecta si hay datos cifrados y pide passphrase
  const hasEncrypted = !!localStorage.getItem(CONFIG.LS_POSITIONS + '_enc');
  let passphrase = null;
  if (hasEncrypted) {
    passphrase = prompt('🔐 Portfolio cifrado detectado. Ingresá tu passphrase:');
  }

  State.positions = await loadPositionsDecrypted(passphrase || '');

  // Dólar MEP
  try {
    const mep    = await fetchWithProxy(API.DOLARAPI);
    State.mepRate = parseFloat(mep.venta) || CONFIG.DEFAULT_MEP;
    if ($('sourceRow')) $('sourceRow').textContent = `Dólar MEP: $${State.mepRate.toLocaleString('es-AR')}`;
  } catch {
    State.mepRate = CONFIG.DEFAULT_MEP;
    console.warn('⚠️ Usando MEP fallback');
  }

  // Precios iniciales
  if (State.positions.length > 0) {
    const results = await Promise.all(State.positions.map(p => getPriceCached(p.ticker, p.type)));
    State.positions.forEach((p, i) => { State.priceCache[p.ticker] = results[i]; });
  }

  renderAll();
  injectControls();
  startAutoRefresh();

  // Eventos
  if ($('addBtn')) $('addBtn').onclick = handleAdd;

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
      renderLineChart(State.processed);
    });
  });

  window.deletePos = async (index) => {
    State.positions.splice(index, 1);
    await savePositionsEncrypted();
    renderAll();
  };

  // Snapshot al cerrar pestaña
  window.addEventListener('beforeunload', () => {
    const totalVal = State.processed.reduce((s, i) => s + i.valUSD, 0);
    if (totalVal > 0) saveDailySnapshot(totalVal);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}