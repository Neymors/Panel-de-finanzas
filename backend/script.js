/**
 * Amygdalé — Financial Dashboard & Risk Control
 * Vanilla JS | Local-First | Amygdalé API + Yahoo + CoinGecko + DolarApi
 * Version: 3.2 — Fixed null crash, AR ticker routing, Yahoo 404 fallback
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
  CACHE_TTL: 5 * 60 * 1000,
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
  STOCKS_DATA: '/api/stocks',        // served by our own Fastify endpoint
  DOLARAPI: 'https://dolarapi.com/v1/dolares/bolsa',
  COINGECKO: 'https://api.coingecko.com/api/v3/simple/price',
  YAHOO: 'https://query1.finance.yahoo.com/v8/finance/chart/'
};

/* ═══════════════════════════════════════════════
   SISTEMA DE NOTIFICACIONES
═══════════════════════════════════════════════ */
const NotificationManager = {
  getStack() {
    let stack = document.getElementById('notification-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.id = 'notification-stack';
      stack.className = 'notification-stack';
      document.body.appendChild(stack);
    }
    return stack;
  },

  show(type = 'info', title, message, customDuration = null) {
    const stack = this.getStack();

    while (stack.children.length >= CONFIG.NOTIFICATION_MAX_VISIBLE) {
      stack.removeChild(stack.firstChild);
    }

    const card = document.createElement('div');
    card.className = `notification-card ${type}`;
    card.setAttribute('role', 'alert');

    const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };

    card.innerHTML = `
      <div class="notification-icon">${icons[type] || 'ℹ'}</div>
      <div class="notification-content">
        <div class="notification-title">${title}</div>
        <div class="notification-message">${message}</div>
      </div>
      <button class="notification-close" aria-label="Cerrar notificación">×</button>
    `;

    stack.appendChild(card);
    triggerReflow(card);
    card.classList.add('visible');

    const closeBtn = card.querySelector('.notification-close');
    let dismissTimeout;

    const dismiss = () => {
      clearTimeout(dismissTimeout);
      card.classList.remove('visible');
      card.classList.add('exit');
      card.addEventListener('transitionend', () => {
        if (card.parentNode === stack) stack.removeChild(card);
      });
    };

    closeBtn.onclick = dismiss;
    const duration = customDuration || CONFIG.AUTO_DISMISS[type] || 5000;
    dismissTimeout = setTimeout(dismiss, duration);
  }
};

/* ═══════════════════════════════════════════════
   ESTADO GLOBAL
═══════════════════════════════════════════════ */
const State = {
  positions: [],
  bondsDb: [],
  localStocksDb: [],   // ← NEW: Rava Argentine stocks cache
  mepPrice: CONFIG.DEFAULT_MEP,
  activeType: 'ALL',
  activeRange: '1M',
  charts: {
    donut: null,
    line: null
  }
};

/* ═══════════════════════════════════════════════
   ALMACENAMIENTO
═══════════════════════════════════════════════ */
const Storage = {
  get(key, fallback = []) {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : fallback;
    } catch (e) {
      console.error(`Error leyendo localStorage [${key}]:`, e);
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error(`Error escribiendo localStorage [${key}]:`, e);
    }
  }
};

/* ═══════════════════════════════════════════════
   PROXY & FETCH
═══════════════════════════════════════════════ */
async function fetchWithProxy(baseUrl, params = {}) {
  const urlObj = new URL(baseUrl);
  Object.keys(params).forEach(key => urlObj.searchParams.append(key, params[key]));
  const proxyUrl = `${CONFIG.PROXY}?url=${encodeURIComponent(urlObj.toString())}`;
  const res = await fetch(proxyUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getMepPrice() {
  try {
    const data = await fetchWithProxy(API.DOLARAPI);
    if (data && data.venta) {
      State.mepPrice = Number(data.venta);
      console.log(`[API] Dólar MEP sincronizado: $${State.mepPrice}`);
      return;
    }
  } catch (e) {
    console.error('Error obteniendo Dólar MEP, usando fallback:', e);
  }
  State.mepPrice = CONFIG.DEFAULT_MEP;
}

/* ═══════════════════════════════════════════════
   SINCRONIZACIÓN DE ACCIONES LOCALES (RAVA)
   Carga el panel de acciones del mercado argentino
   para resolver tickers como ALUA, BYMA, GGAL, etc.
═══════════════════════════════════════════════ */
async function syncLocalStocks() {
  try {
    const res = await fetch(API.STOCKS_DATA);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Respuesta inválida');
    State.localStocksDb = json.data; // already normalized by server
    console.log(`[API] Sincronizadas ${State.localStocksDb.length} acciones locales (Rava vía /api/stocks).`);
  } catch (e) {
    console.warn('[API] No se pudo sincronizar acciones locales:', e.message);
  }
}

/* ═══════════════════════════════════════════════
   MOTOR DE PRECIOS — con fallback AR inteligente
═══════════════════════════════════════════════ */
async function getPrice(ticker, type) {
  const cache = Storage.get(CONFIG.LS_CACHE, {});
  const now = Date.now();

  if (cache[ticker] && (now - cache[ticker].ts < CONFIG.CACHE_TTL) && cache[ticker].price > 0) {
    return cache[ticker];
  }

  // ── Auto-correct stale localStorage types ─────────────────────────────
  // Positions saved before v3.2 may have type 'ACCION' for bonds/AR stocks.
  // Detect by checking the live databases so routing is always correct.
  if (type !== 'CRYPTO') {
    const inBondsDb = State.bondsDb.some(b => b.symbol.toUpperCase() === ticker.toUpperCase());
    if (inBondsDb) type = 'BONO';
    else if (type !== 'ACCION' || State.localStocksDb.some(s => s.symbol === ticker.toUpperCase())) {
      // If it's not a known international stock AND it's in our local DB, treat as AR
      if (State.localStocksDb.some(s => s.symbol === ticker.toUpperCase())) type = 'AR';
    }
  }

  let price = 0;
  let change = 0;
  let name = ticker;

  try {
    // ── 1. BONOS: base de datos local de Rava ──────────────────────────────
    if (type === 'BONO') {
      const b = State.bondsDb.find(x => x.symbol.toUpperCase() === ticker.toUpperCase());
      if (b) {
        price = b.price;
        change = b.tir;
        name = b.name;
      } else {
        throw new Error('Bono no encontrado en base de datos local');
      }
    }

    // ── 2. CRYPTO: CoinGecko ───────────────────────────────────────────────
    else if (type === 'CRYPTO') {
      const idMap = { 'BTC': 'bitcoin', 'ETH': 'ethereum', 'USDT': 'tether', 'SOL': 'solana', 'BNB': 'binancecoin' };
      const id = idMap[ticker.toUpperCase()] || ticker.toLowerCase();

      const data = await fetchWithProxy(API.COINGECKO, {
        ids: id,
        vs_currencies: 'usd',
        include_24hr_change: 'true'
      });

      if (data[id]) {
        price = data[id].usd;
        change = data[id].usd_24h_change || 0;
      } else {
        throw new Error('Crypto no encontrada en CoinGecko');
      }
    }

    // ── 3. ACCIONES LOCALES AR: primero Rava, luego Yahoo como fallback ────
    else if (type === 'AR') {
      const local = State.localStocksDb.find(s => s.symbol === ticker.toUpperCase());
      if (local && local.price > 0) {
        price = local.price;
        change = local.change;
        name = local.name || ticker;
      } else {
        // Fallback: intentar Yahoo con sufijo .BA (Buenos Aires)
        const symbol = ticker.toUpperCase() + '.BA';
        const data = await fetchWithProxy(`${API.YAHOO}${symbol}`, { interval: '1d', range: '2d' });
        const result = data?.chart?.result?.[0];
        if (result) {
          const meta = result.meta;
          const closes = (result.indicators?.quote?.[0]?.close || []).filter(v => v != null);
          if (closes.length > 0) {
            price = closes[closes.length - 1];
            change = closes.length > 1
              ? ((closes[closes.length - 1] - closes[closes.length - 2]) / closes[closes.length - 2]) * 100
              : (meta?.regularMarketChangePercent || 0);
          } else if (meta?.regularMarketPrice) {
            price = meta.regularMarketPrice;
            change = meta.regularMarketChangePercent || 0;
          }
          if (meta?.shortName) name = meta.shortName;
        }
        if (price === 0) throw new Error(`${ticker} no encontrado ni en Rava ni en Yahoo (.BA)`);
      }
    }

    // ── 4. ACCIONES INTERNACIONALES (USD): Yahoo Finance ──────────────────
    else {
      let symbol = ticker.toUpperCase();
      if (symbol === 'APPL') symbol = 'AAPL'; // typo común

      const data = await fetchWithProxy(`${API.YAHOO}${symbol}`, { interval: '1d', range: '2d' });
      const result = data?.chart?.result?.[0];

      if (result) {
        const meta = result.meta;
        const closes = (result.indicators?.quote?.[0]?.close || []).filter(v => v != null);

        if (closes.length > 0) {
          price = closes[closes.length - 1];
          change = closes.length > 1
            ? ((closes[closes.length - 1] - closes[closes.length - 2]) / closes[closes.length - 2]) * 100
            : (meta?.regularMarketChangePercent || 0);
        } else if (meta?.regularMarketPrice != null) {
          price = meta.regularMarketPrice;
          change = meta.regularMarketChangePercent || 0;
        } else {
          throw new Error('No se encontraron precios válidos en Yahoo Finance');
        }

        if (meta?.shortName) name = meta.shortName;
      } else {
        throw new Error('Estructura de Yahoo Finance no interpretada');
      }
    }

    const asset = { price, change, name, ts: now };
    cache[ticker] = asset;
    Storage.set(CONFIG.LS_CACHE, cache);
    return asset;

  } catch (err) {
    console.error(`⚠️ Error obteniendo ${ticker}:`, err.message);
    // Devolver caché stale si existe, o valores cero
    return cache[ticker] || { price: 0, change: 0, name: ticker, ts: 0 };
  }
}

/* ═══════════════════════════════════════════════
   CÁLCULOS & PROCESAMIENTO
═══════════════════════════════════════════════ */
async function processPositions() {
  const processed = [];
  let totalUSD = 0;

  for (const pos of State.positions) {
    const live = await getPrice(pos.ticker, pos.type);

    let currentPriceUSD = live.price;
    let ppcUSD = pos.ppc;

    // Normalización a USD: ARS → USD vía MEP
    if (pos.currency === 'ARS') {
      currentPriceUSD = live.price / State.mepPrice;
      ppcUSD = pos.ppc / State.mepPrice;
    }

    const subtotalUSD = currentPriceUSD * pos.qty;
    const capitalInvertidoUSD = ppcUSD * pos.qty;
    const pnlAbsUSD = subtotalUSD - capitalInvertidoUSD;
    const pnlPct = capitalInvertidoUSD > 0 ? (pnlAbsUSD / capitalInvertidoUSD) * 100 : 0;

    processed.push({
      ...pos,
      name: live.name,
      currentPriceUSD,
      currentPriceOriginal: live.price,
      change: live.change,
      subtotalUSD,
      pnlAbsUSD,
      pnlPct
    });

    if (State.activeType === 'ALL' || pos.type === State.activeType) {
      totalUSD += subtotalUSD;
    }
  }

  return { processed, totalUSD };
}

/* ═══════════════════════════════════════════════
   RENDERIZADO
═══════════════════════════════════════════════ */
const $ = (id) => document.getElementById(id);

function formatUSD(val) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
}

function formatARS(val) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(val);
}

function formatPct(val) {
  const n = Number(val);
  if (!isFinite(n)) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

function triggerReflow(el) {
  return el.offsetHeight;
}

async function renderAll() {
  const { processed, totalUSD } = await processPositions();

  // FIX: usar optional chaining para evitar null crash si un elemento no existe en el DOM
  const set = (id, val) => { const el = $(id); if (el) el.textContent = val; };

  set('totalUSD', formatUSD(totalUSD));
  set('totalARS', formatARS(totalUSD * State.mepPrice));
  set('mepValue', formatARS(State.mepPrice)); // sólo actúa si el elemento existe

  // Métricas del header
  const totalInvested = processed.reduce((acc, p) => {
    const ppcUSD = p.currency === 'ARS' ? p.ppc / State.mepPrice : p.ppc;
    return acc + ppcUSD * p.qty;
  }, 0);
  const totalGain = totalUSD - totalInvested;
  const totalGainPct = totalInvested > 0 ? (totalGain / totalInvested) * 100 : 0;

  // Mejor/peor variación del día
  const withChange = processed.filter(p => p.type !== 'BONO');
  const best = withChange.reduce((a, b) => Math.abs(b.change) > Math.abs(a?.change || 0) ? b : a, null);

  set('totalGain', formatUSD(totalGain));
  set('totalGainPct', formatPct(totalGainPct));
  set('posCount', processed.length);
  if (best) {
    set('bestTicker', best.ticker.toUpperCase());
    set('bestPct', formatPct(best.change));
    const bestPctEl = $('bestPct');
    if (bestPctEl) bestPctEl.className = `metric-sub ${best.change >= 0 ? 'up' : 'down'}`;
  }

  // Tabla de posiciones
  const tbody = $('posTable');
  if (!tbody) return;
  tbody.innerHTML = '';

  const filtered = processed.filter(p => State.activeType === 'ALL' || p.type === State.activeType);

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="empty-row">No hay posiciones activas para este segmento.</td></tr>`;
  } else {
    filtered.forEach((p, index) => {
      const share = totalUSD > 0 ? (p.subtotalUSD / totalUSD) * 100 : 0;
      const tr = document.createElement('tr');
      const changeClass = p.change >= 0 ? 'up' : 'down';
      const pnlClass = p.pnlAbsUSD >= 0 ? 'up' : 'down';

      tr.innerHTML = `
        <td>
          <div class="ticker-main">${p.ticker.toUpperCase()}</div>
          <div class="asset-name">${p.name || p.ticker}</div>
        </td>
        <td>
          <div class="price-us">${formatUSD(p.currentPriceUSD)}</div>
          <div class="price-original">${p.currency === 'ARS' ? formatARS(p.currentPriceOriginal) : formatUSD(p.currentPriceOriginal)}</div>
        </td>
        <td class="${changeClass}">${p.type === 'BONO' ? 'TIR: ' : ''}${formatPct(p.change)}</td>
        <td>${p.qty}</td>
        <td>
          <div class="price-us">${formatUSD(p.currency === 'ARS' ? p.ppc / State.mepPrice : p.ppc)}</div>
          <div class="price-original">${p.currency === 'ARS' ? formatARS(p.ppc) : formatUSD(p.ppc)}</div>
        </td>
        <td>${p.days} días</td>
        <td>${share.toFixed(1)}%</td>
        <td class="${pnlClass}">${formatUSD(p.pnlAbsUSD)}</td>
        <td class="${pnlClass}">${formatPct(p.pnlPct)}</td>
        <td><button class="action-btn delete" onclick="deletePos(${index})" aria-label="Eliminar posición">✕</button></td>
      `;
      tbody.appendChild(tr);
    });
  }

  renderDonutChart(filtered);
  renderLineChart();
  runRiskEngine(filtered);
}

/* ═══════════════════════════════════════════════
   GRÁFICOS
═══════════════════════════════════════════════ */
function renderDonutChart(items) {
  // index.html usa id="pieChart", script original usaba id="donutChart" — soportar ambos
  const ctx = $('pieChart') || $('donutChart');
  if (!ctx) return;

  if (State.charts.donut) State.charts.donut.destroy();
  if (items.length === 0) { ctx.style.display = 'none'; return; }
  ctx.style.display = 'block';

  const labels = items.map(x => x.ticker.toUpperCase());
  const data = items.map(x => x.subtotalUSD);
  const colors = ['#2563eb', '#3b82f6', '#60a5fa', '#93c5fd', '#1d4ed8', '#7c3aed', '#2e9b6b'];

  State.charts.donut = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data, backgroundColor: colors.slice(0, labels.length), borderWidth: 0 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { color: '#94a3b8', font: { family: 'monospace', size: 11 } } }
      }
    }
  });
}

function renderLineChart() {
  const ctx = $('lineChart');
  if (!ctx) return;

  if (State.charts.line) State.charts.line.destroy();

  const history = Storage.get(CONFIG.LS_HISTORY, []);
  const filterDays = { '1W': 7, '1M': 30, '3M': 90, 'ALL': CONFIG.HISTORY_MAX }[State.activeRange] || 30;
  const filteredHistory = history.slice(-filterDays);

  let labels = filteredHistory.map(h => h.date);
  let data = filteredHistory.map(h => h.value);

  if (labels.length === 0) {
    labels = Array.from({ length: 5 }, (_, i) => `Punto ${i + 1}`);
    data = [1000, 1200, 1150, 1300, 1420];
  }

  State.charts.line = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Historial USD',
        data,
        borderColor: '#2563eb',
        borderWidth: 2,
        fill: false,
        tension: 0.15
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { ticks: { color: '#64748b' } },
        y: { ticks: { color: '#64748b' } }
      }
    }
  });
}

/* ═══════════════════════════════════════════════
   MOTOR DE RIESGO
═══════════════════════════════════════════════ */
function runRiskEngine(processedPositions) {
  const alertsContainer = $('riskAlerts');
  if (!alertsContainer) return;
  alertsContainer.innerHTML = '';

  const alerts = [];
  const totalUSD = processedPositions.reduce((acc, x) => acc + x.subtotalUSD, 0);

  processedPositions.forEach(p => {
    const share = totalUSD > 0 ? (p.subtotalUSD / totalUSD) * 100 : 0;
    if (share > 40 && processedPositions.length > 1) {
      alerts.push({ type: 'warning', title: 'Alta Concentración', desc: `${p.ticker.toUpperCase()} representa el ${share.toFixed(1)}% de la cartera.` });
    }
    if (p.pnlPct < -15) {
      alerts.push({ type: 'danger', title: 'Alerta Stop-Loss Crítico', desc: `${p.ticker.toUpperCase()} acumula una caída del ${p.pnlPct.toFixed(1)}%.` });
    }
  });

  if (alerts.length === 0) {
    alertsContainer.innerHTML = `<div class="no-risk">✓ Todos los parámetros de riesgo estables.</div>`;
    return;
  }
  alerts.forEach(a => {
    const box = document.createElement('div');
    box.className = `risk-box ${a.type}`;
    box.innerHTML = `<strong>${a.title}:</strong> ${a.desc}`;
    alertsContainer.appendChild(box);
  });
}

/* ═══════════════════════════════════════════════
   WIDGET BONOS
═══════════════════════════════════════════════ */
async function renderBondsInsightWidget() {
  const container = $('bondsInsightContainer');
  if (!container) return;

  try {
    const res = await fetch(API.BONDS_TOP_TIR);
    if (!res.ok) throw new Error('Error al consultar el top de TIR');
    const json = await res.json();

    if (json.success && json.data) {
      const topBonds = json.data.slice(0, 4);
      let html = '<div class="bonds-insight-grid">';
      topBonds.forEach(b => {
        html += `
          <div class="bond-insight-card">
            <div class="bond-insight-sym">${b.symbol}</div>
            <div class="bond-insight-metric">TIR: <span class="up">${b.tir.toFixed(1)}%</span></div>
          </div>`;
      });
      html += '</div>';
      container.innerHTML = html;
    }
  } catch (err) {
    container.innerHTML = `<div class="error-msg">No se pudo cargar el análisis de renta fija.</div>`;
  }
}

/* ═══════════════════════════════════════════════
   MIGRACIÓN DE TIPOS DE POSICIÓN (localStorage fix)
   Corrige posiciones guardadas con tipo incorrecto
   antes de v3.2 (ej: bonos como 'ACCION').
═══════════════════════════════════════════════ */
function migratePositionTypes() {
  let changed = false;
  State.positions = State.positions.map(pos => {
    let { type, currency } = pos;
    const t = pos.ticker.toUpperCase();

    const inBonds = State.bondsDb.some(b => b.symbol.toUpperCase() === t);
    const inLocalStocks = State.localStocksDb.some(s => s.symbol === t);

    if (inBonds && type !== 'BONO') {
      type = 'BONO'; currency = 'ARS'; changed = true;
      console.log(`[Migración] ${t}: ACCION → BONO`);
    } else if (inLocalStocks && type !== 'AR' && type !== 'BONO') {
      type = 'AR'; currency = 'ARS'; changed = true;
      console.log(`[Migración] ${t}: ${pos.type} → AR`);
    }

    return { ...pos, type, currency };
  });

  if (changed) {
    Storage.set(CONFIG.LS_POSITIONS, State.positions);
    console.log('[Migración] Tipos de posición corregidos y guardados.');
  }
}


/*   Tipo de activo mapeado:
     ar     → type: 'AR'      currency: 'ARS'
     usd    → type: 'ACCION'  currency: 'USD'
     crypto → type: 'CRYPTO'  currency: 'USD'
   Bonos: el usuario selecciona 'ar' y el ticker
   coincide con la bondsDb → se guarda como 'BONO' */
async function handleAdd() {
  const errorDiv = $('addError');
  if (errorDiv) errorDiv.textContent = '';

  const ticker = $('tickerInput')?.value.trim().toUpperCase();
  const qty = parseFloat($('qtyInput')?.value);
  const ppc = parseFloat($('avgInput')?.value || $('ppcInput')?.value);
  const days = parseInt($('daysInput')?.value) || 0;

  const typeActiveBtn = document.querySelector('.type-btn.active');
  const rawType = typeActiveBtn ? typeActiveBtn.dataset.type : 'usd';

  // Determinar currency y type interno
  let currency = 'USD';
  let type = 'ACCION';

  if (rawType === 'ar') {
    currency = 'ARS';
    // Si el ticker coincide con algún bono conocido, usar tipo BONO
    const isBond = State.bondsDb.some(b => b.symbol.toUpperCase() === ticker);
    type = isBond ? 'BONO' : 'AR';
  } else if (rawType === 'crypto') {
    type = 'CRYPTO';
    currency = 'USD';
  } else {
    type = 'ACCION';
    currency = 'USD';
  }

  if (!ticker || isNaN(qty) || qty <= 0 || isNaN(ppc) || ppc <= 0) {
    if (errorDiv) errorDiv.textContent = 'Completa todos los campos obligatorios con valores positivos.';
    return;
  }

  const newPosition = { ticker, type, qty, ppc, currency, days };
  State.positions.push(newPosition);
  Storage.set(CONFIG.LS_POSITIONS, State.positions);

  // Limpiar caché del ticker para forzar precio fresco
  const cache = Storage.get(CONFIG.LS_CACHE, {});
  delete cache[ticker];
  Storage.set(CONFIG.LS_CACHE, cache);

  if ($('tickerInput')) $('tickerInput').value = '';
  if ($('qtyInput')) $('qtyInput').value = '';
  const ppcField = $('avgInput') || $('ppcInput');
  if (ppcField) ppcField.value = '';
  if ($('daysInput')) $('daysInput').value = '0';

  NotificationManager.show('success', 'Posición Añadida', `${ticker} integrado como ${type} (${currency}).`);
  await renderAll();
}

/* ═══════════════════════════════════════════════
   CONTROLES DE SEGMENTACIÓN
═══════════════════════════════════════════════ */
function injectControls() {
  const container = $('controlsContainer');
  if (!container) return;

  container.innerHTML = `
    <div class="segment-controls">
      <div class="control-card">
        <div class="card-title">Filtro de Segmentación</div>
        <div class="filter-row">
          <button class="filter-btn active" data-filter="ALL">Todos</button>
          <button class="filter-btn" data-filter="ACCION">Acciones Internacionales</button>
          <button class="filter-btn" data-filter="AR">Acciones Locales</button>
          <button class="filter-btn" data-filter="BONO">Bonos soberanos</button>
          <button class="filter-btn" data-filter="CRYPTO">Criptoactivos</button>
        </div>
      </div>
    </div>
  `;

  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      State.activeType = btn.dataset.filter;
      await renderAll();
    });
  });
}

/* ═══════════════════════════════════════════════
   RELOJES
═══════════════════════════════════════════════ */
function initClocks() {
  const updateClocks = () => {
    const options = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
    if ($('clockAR')) $('clockAR').textContent = 'BA ' + new Date().toLocaleTimeString('es-AR', { ...options, timeZone: 'America/Argentina/Buenos_Aires' });
    if ($('clockNY')) $('clockNY').textContent = 'NY ' + new Date().toLocaleTimeString('en-US', { ...options, timeZone: 'America/New_York' });
  };
  setInterval(updateClocks, 1000);
  updateClocks();
}

/* ═══════════════════════════════════════════════
   INICIALIZACIÓN
═══════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  initClocks();

  // 1. Sincronizar bonos
  try {
    const bondsRes = await fetch(API.BONDS_DATA);
    if (!bondsRes.ok) throw new Error('Error al sincronizar base de datos de bonos');
    const bondsJson = await bondsRes.json();
    if (bondsJson.success) {
      State.bondsDb = bondsJson.data;
      console.log(`[API] Sincronizados ${State.bondsDb.length} bonos en memoria.`);
    }
  } catch (e) {
    console.error('Error inicial bonos:', e);
    NotificationManager.show('error', 'Fallo de sincronización', 'No se pudo conectar con el motor de bonos.');
  }

  // 2. Sincronizar acciones locales argentinas (Rava)
  await syncLocalStocks();

  // 3. Tipo de cambio MEP
  await getMepPrice();

  // 4. Cargar posiciones del storage
  State.positions = Storage.get(CONFIG.LS_POSITIONS, []);

  // 4b. Corregir tipos de posición guardados con versiones anteriores
  migratePositionTypes();

  // 5. Registrar snapshot de historia
  const history = Storage.get(CONFIG.LS_HISTORY, []);
  const todayStr = new Date().toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
  const { totalUSD } = await processPositions();
  if (totalUSD > 0 && (!history.length || history[history.length - 1].date !== todayStr)) {
    history.push({ date: todayStr, value: totalUSD });
    if (history.length > CONFIG.HISTORY_MAX) history.shift();
    Storage.set(CONFIG.LS_HISTORY, history);
  }

  // 6. Render
  await renderAll();
  injectControls();
  if ($('bondsInsightContainer')) await renderBondsInsightWidget();

  // 7. Eventos del formulario
  const addBtn = $('addBtn');
  if (addBtn) addBtn.onclick = handleAdd;

  // Compatibilidad con el formulario que usa onsubmit
  const addForm = $('addForm');
  if (addForm) addForm.addEventListener('submit', (e) => { e.preventDefault(); handleAdd(); });

  // Selector de tipo de activo
  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Selector de rango temporal
  document.querySelectorAll('.range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      State.activeRange = btn.dataset.range;
      renderLineChart();
    });
  });

  // Eliminar posición (global para onclick inline)
  window.deletePos = async (index) => {
    const removed = State.positions[index];
    State.positions.splice(index, 1);
    Storage.set(CONFIG.LS_POSITIONS, State.positions);
    await renderAll();
    NotificationManager.show('info', 'Posición eliminada', `${removed.ticker} removido de la cartera.`, 3500);
  };

  NotificationManager.show('info', 'Sistema Listo', 'Motor de riesgo e interfaz sincronizados.', 4000);
});