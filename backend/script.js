/**
 * Amygdalé — Financial Dashboard & Risk Control
 * Vanilla JS | Local-First | Amygdalé API + Yahoo + CoinGecko + DolarApi
 * Version: 3.5 — Zero-Trust Suffix Isolation & Defensive Format Architecture
 * 
 * Fixed: Bonds data loading and error handling
 * Removed: Unnecessary filter dependencies
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
  LS_CURRENCY: 'amygdale_base_currency_v1',
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
  DOLARAPI: 'https://dolarapi.com/v1/dolares/bolsa',
  COINGECKO: 'https://api.coingecko.com/api/v3/simple/price',
  YAHOO: 'https://query1.finance.yahoo.com/v8/finance/chart/'
};

/* ═══════════════════════════════════════════════
   SISTEMA DE NOTIFICACIONES (UI/UX)
═══════════════════════════════════════════════ */
const NotificationManager = {
  activeHashes: new Set(),

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
    const hash = `${type}|${title}|${message}`;
    if (this.activeHashes.has(hash)) return;
    this.activeHashes.add(hash);

    const stack = this.getStack();
    const currentCards = stack.querySelectorAll('.notification-card');
    if (currentCards.length >= CONFIG.NOTIFICATION_MAX_VISIBLE) {
      this.dismiss(currentCards[0]);
    }

    const card = document.createElement('div');
    card.className = `notification-card ${type}`;
    card.setAttribute('role', 'alert');
    card.dataset.hash = hash;

    const icons = { success: '✓', error: '✗', warning: '!', info: 'ℹ' };

    card.innerHTML = `
      <div class="notification-icon">${icons[type] || 'ℹ'}</div>
      <div class="notification-content">
        <div class="notification-title">${escapeHtml(title)}</div>
        <div class="notification-message">${escapeHtml(message)}</div>
      </div>
      <button class="notification-dismiss" aria-label="Cerrar notificación">×</button>
    `;

    stack.appendChild(card);
    triggerReflow(card);
    card.classList.add('visible');

    let dismissTimeout;
    const duration = customDuration || CONFIG.AUTO_DISMISS[type] || 5000;

    const closeBtn = card.querySelector('.notification-dismiss');
    closeBtn.onclick = () => {
      clearTimeout(dismissTimeout);
      this.dismiss(card);
    };

    dismissTimeout = setTimeout(() => this.dismiss(card), duration);
    this.renderClearAllBtn();
  },

  dismiss(card) {
    if (!card || card.classList.contains('removing')) return;
    this.activeHashes.delete(card.dataset.hash);
    card.classList.remove('visible');
    card.classList.add('removing');
    card.addEventListener('animationend', () => {
      if (card.parentNode) {
        card.parentNode.removeChild(card);
        this.renderClearAllBtn();
      }
    });
  },

  dismissAll() {
    const stack = this.getStack();
    const cards = stack.querySelectorAll('.notification-card');
    cards.forEach(card => this.dismiss(card));
  },

  renderClearAllBtn() {
    const stack = this.getStack();
    const cards = stack.querySelectorAll('.notification-card:not(.removing)');
    let clearBtn = document.getElementById('notif-clear-all');

    if (cards.length > 1) {
      if (!clearBtn) {
        clearBtn = document.createElement('button');
        clearBtn.id = 'notif-clear-all';
        clearBtn.className = 'notif-clear-all-btn';
        clearBtn.textContent = 'Limpiar todas';
        clearBtn.onclick = () => this.dismissAll();
        stack.insertBefore(clearBtn, stack.firstChild);
      }
    } else if (clearBtn) {
      clearBtn.remove();
    }
  }
};

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ═══════════════════════════════════════════════
   ESTADO GLOBAL
═══════════════════════════════════════════════ */
const State = {
  positions: [],
  bondsDb: [],
  mepPrice: CONFIG.DEFAULT_MEP,
  baseCurrency: 'USD', // 'USD' | 'ARS'
  activeType: 'ALL',
  activeRange: '1M',
  charts: { donut: null, line: null }
};

/* ═══════════════════════════════════════════════
   MONEDA BASE — helpers de conversión
═══════════════════════════════════════════════ */
// Convierte un valor USD al display según moneda base
function toDisplay(usdValue) {
  return State.baseCurrency === 'ARS' ? usdValue * State.mepPrice : usdValue;
}

// Formatea un valor ya en moneda display
function formatDisplay(val) {
  return State.baseCurrency === 'ARS' ? formatARS(val) : formatUSD(val);
}

// Símbolo/label de la moneda activa
function currencyLabel() {
  return State.baseCurrency === 'ARS' ? 'ARS' : 'USD';
}

/* ═══════════════════════════════════════════════
   LOCAL STORAGE
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
   UTILIDADES DE FORMATO
═══════════════════════════════════════════════ */
const $ = (id) => document.getElementById(id);

function formatUSD(val) {
  if (val === undefined || val === null || isNaN(val)) return '$0.00';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
}

function formatARS(val) {
  if (val === undefined || val === null || isNaN(val)) return '$0.00';
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(val);
}

function formatPct(val) {
  if (val === undefined || val === null || isNaN(val) || !isFinite(val)) return '0.00%';
  return (val >= 0 ? '+' : '') + val.toFixed(2) + '%';
}

function triggerReflow(el) {
  return el.offsetHeight;
}

/* ═══════════════════════════════════════════════
   PRECIOS & PROXY
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
  const displayEl = $('mepDisplay');
  const statusEl = $('mepStatus');
  
  if (displayEl) displayEl.innerHTML = '<span class="loading-pulse">...</span>';
  if (statusEl) statusEl.textContent = '';

  try {
    const data = await fetchWithProxy(API.DOLARAPI);
    if (data && data.venta) {
      State.mepPrice = Number(data.venta);
      if (displayEl) displayEl.textContent = formatARS(State.mepPrice);
      
      // Actualizar tasa en el selector de moneda si está visible
      const rateEl = document.querySelector('#currency-selector-widget .currency-mep-rate');
      if (rateEl) rateEl.textContent = `MEP: ${formatARS(State.mepPrice)}`;
      
      const now = new Date();
      const horaArg = new Date(now.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
      const diaSemana = horaArg.getDay();
      const hora = horaArg.getHours();
      const minutos = horaArg.getMinutes();
      
      let mercadoAbierto = (diaSemana >= 1 && diaSemana <= 5) && (hora > 11 || (hora === 11 && minutos >= 0)) && (hora < 17 || (hora === 17 && minutos === 0));
      
      if (statusEl) {
        if (mercadoAbierto) {
          const timeStr = horaArg.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
          statusEl.textContent = `(Actualizado ${timeStr})`;
        } else {
          statusEl.textContent = '(Mercado Cerrado)';
        }
      }
      return;
    }
  } catch (e) {
    console.error('Error Dólar MEP:', e);
    if (displayEl) displayEl.innerHTML = `<span class="neg">${formatARS(CONFIG.DEFAULT_MEP)}</span>`;
    if (statusEl) statusEl.textContent = '(Offline)';
  }
  State.mepPrice = CONFIG.DEFAULT_MEP;
  if (displayEl && !displayEl.innerHTML.includes('Fallback')) displayEl.textContent = formatARS(CONFIG.DEFAULT_MEP);
  if (statusEl && !statusEl.textContent) statusEl.textContent = '(Sin conexión)';
}

async function getPrice(ticker, type) {
  const cache = Storage.get(CONFIG.LS_CACHE, {});
  const now = Date.now();

  if (cache[ticker] && (now - cache[ticker].ts < CONFIG.CACHE_TTL) && cache[ticker].price > 0) {
    return cache[ticker];
  }

  let price = 0;
  let change = 0;
  let name = ticker;

  try {
    if (type === 'BONO') {
      const b = State.bondsDb.find(x => x.symbol.toUpperCase() === ticker.toUpperCase());
      if (b) {
        price = b.price;
        change = b.tir;
        name = b.name;
      } else {
        throw new Error(`Bono ${ticker} no encontrado en la base local`);
      }
    } 
    else if (type === 'CRYPTO') {
      const idMap = { 'BTC': 'bitcoin', 'ETH': 'ethereum', 'USDT': 'tether', 'SOL': 'solana', 'WLFI': 'world-liberty-financial' };
      const id = idMap[ticker.toUpperCase()] || ticker.toLowerCase();
      const data = await fetchWithProxy(API.COINGECKO, { ids: id, vs_currencies: 'usd', include_24hr_change: 'true' });
      if (data[id]) {
        price = data[id].usd;
        change = data[id].usd_24h_change || 0;
      } else {
        throw new Error('Crypto no encontrado');
      }
    } 
    else {
      let symbol = ticker.toUpperCase().trim();
      const localTickers = ['ALUA', 'BYMA', 'YPFD', 'PAMP', 'GGAL', 'BMA', 'EDN', 'CEPU', 'TGSU2'];
      const storedPositions = Storage.get(CONFIG.LS_POSITIONS, []);
      const matchedStored = storedPositions.find(p => p.ticker.toUpperCase().trim() === symbol);
      const isLocalAsset = localTickers.includes(symbol) || (matchedStored && matchedStored.currency === 'ARS') || (State.positions.some(p => p.ticker.toUpperCase().trim() === symbol && p.currency === 'ARS'));
      if (isLocalAsset && !symbol.endsWith('.BA')) symbol = `${symbol}.BA`;

      const data = await fetchWithProxy(`${API.YAHOO}${symbol}`, { interval: '1d', range: '2d' });
      const result = data?.chart?.result;
      if (result && result.length > 0) {
        const firstResult = result[0];
        const meta = firstResult.meta;
        const indicators = firstResult.indicators?.quote?.[0];
        const prices = indicators?.close || [];
        const cleanPrices = prices.filter(v => v !== null && v !== undefined);
        
        if (cleanPrices.length > 0) {
          price = cleanPrices[cleanPrices.length - 1];
          if (cleanPrices.length > 1) {
            const prev = cleanPrices[cleanPrices.length - 2];
            change = ((price - prev) / prev) * 100;
          } else if (meta?.regularMarketChangePercent !== undefined) {
            change = meta.regularMarketChangePercent;
          }
        } else if (meta?.regularMarketPrice !== undefined) {
          price = meta.regularMarketPrice;
          change = meta.regularMarketChangePercent || 0;
        } else {
          throw new Error('No se encontraron precios');
        }
        if (meta?.shortName) name = meta.shortName;
      } else {
        throw new Error('Estructura Yahoo inválida');
      }
    }

    const updatedAsset = { price, change, name, ts: now };
    cache[ticker] = updatedAsset;
    Storage.set(CONFIG.LS_CACHE, cache);
    return updatedAsset;
  } catch (err) {
    console.error(`Error ${ticker}:`, err.message);
    return cache[ticker] || { price: 0, change: 0, name: ticker, ts: 0 };
  }
}

/* ═══════════════════════════════════════════════
   PROCESAMIENTO DE POSICIONES
═══════════════════════════════════════════════ */
async function processPositions() {
  const processed = [];
  let totalUSD = 0;

  for (const pos of State.positions) {
    const live = await getPrice(pos.ticker, pos.type);
    let currentPriceUSD = live.price;
    let ppcUSD = pos.ppc;

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
   RENDERIZADO UI
═══════════════════════════════════════════════ */
async function renderAll() {
  console.log('[UI] Renderizando...');

  const metricIds = ['todayPct', 'todayAbs', 'totalGain', 'totalGainPct', 'bestTicker', 'bestPct', 'posCount', 'totalUSD', 'totalARS'];
  metricIds.forEach(id => { const el = $(id); if (el) el.innerHTML = '<span class="loading-pulse">Calculando...</span>'; });

  // Actualizar etiqueta del bloque total según moneda activa
  const totalLabelEl = document.querySelector('.total-label');
  if (totalLabelEl) totalLabelEl.textContent = `Valor Total (${currencyLabel()})`;

  const { processed, totalUSD } = await processPositions();
  const filtered = processed.filter(p => State.activeType === 'ALL' || p.type === State.activeType);

  let totalInvestedUSD = 0;
  let todayAbsUSD = 0;
  let bestAsset = { ticker: '—', change: -Infinity };

  const tbody = $('posTable');
  if (tbody) tbody.innerHTML = '';

  if (filtered.length === 0) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="10" class="empty-row">Agregá tu primera posición para iniciar el análisis ↑</td></tr>`;
    bestAsset = { ticker: '—', change: 0 };
  } else {
    filtered.forEach((p, index) => {
      const capitalInvertidoPosicionUSD = p.currency === 'ARS' ? (p.ppc / State.mepPrice) * p.qty : p.ppc * p.qty;
      totalInvestedUSD += capitalInvertidoPosicionUSD;

      const changeDec = p.change / 100;
      const prevPriceUSD = changeDec === -1 ? p.currentPriceUSD : p.currentPriceUSD / (1 + changeDec);
      todayAbsUSD += (p.currentPriceUSD - prevPriceUSD) * p.qty;

      if (p.change > bestAsset.change) bestAsset = { ticker: p.ticker.toUpperCase(), change: p.change };

      if (tbody) {
        const share = totalUSD > 0 ? (p.subtotalUSD / totalUSD) * 100 : 0;
        const tr = document.createElement('tr');
        const changeClass = p.change >= 0 ? 'up' : 'down';
        const pnlClass = p.pnlAbsUSD >= 0 ? 'up' : 'down';

        // Precios en moneda display
        const displayCurrentPrice = toDisplay(p.currentPriceUSD);
        const displayPPC = toDisplay(p.currency === 'ARS' ? p.ppc / State.mepPrice : p.ppc);
        const displayPnL = toDisplay(p.pnlAbsUSD);
        const displaySubtotal = toDisplay(p.subtotalUSD);
      tr.innerHTML = `
        <td>
          <div class="ticker-main">${escapeHtml(p.ticker.toUpperCase())}</div>
          <div class="asset-type">${p.type === 'BONO' ? 'BONO' : p.type === 'CRYPTO' ? 'CRYPTO' : 'ACCIÓN'}</div>
        </td>
        <td><div class="price-display">${formatDisplay(displayCurrentPrice)}</div></td>
        <td class="${changeClass}">${p.type === 'BONO' ? 'TIR: ' : ''}${formatPct(p.change)}</td>
        <td>${p.qty}</td>
        <td><div class="price-display">${formatDisplay(displayPPC)}</div></td>
        <td>${p.days} días</td>
        <td>${share.toFixed(1)}%</td>
        <td class="${pnlClass}">${formatDisplay(displayPnL)}</td>
        <td class="${pnlClass}">${formatPct(p.pnlPct)}</td>
        <td><button class="action-btn delete" data-index="${index}" aria-label="Eliminar posición">✕</button></td>
      `;
        tbody.appendChild(tr);
      }
    });

    if (tbody) {
      tbody.querySelectorAll('.action-btn.delete').forEach(btn => {
        btn.onclick = async (e) => {
          const idx = parseInt(e.currentTarget.dataset.index);
          await window.deletePos(idx);
        };
      });
    }
  }

  const totalGainUSD = totalUSD - totalInvestedUSD;
  const totalGainPct = totalInvestedUSD > 0 ? (totalGainUSD / totalInvestedUSD) * 100 : 0;
  const prevTotalPortfolioUSD = totalUSD - todayAbsUSD;
  const todayPct = prevTotalPortfolioUSD > 0 ? (todayAbsUSD / prevTotalPortfolioUSD) * 100 : 0;

  // Totales en moneda base
  const displayTotal = toDisplay(totalUSD);
  const displaySecondary = State.baseCurrency === 'ARS'
    ? formatUSD(totalUSD)
    : formatARS(totalUSD * State.mepPrice);

  if ($('totalUSD')) $('totalUSD').textContent = formatDisplay(displayTotal);
  if ($('totalARS')) $('totalARS').textContent = displaySecondary;
  if ($('mepDisplay')) $('mepDisplay').textContent = formatARS(State.mepPrice);

  const updateWidget = (id, value, isMonetary = false, isPercentage = false, cssClass = '') => {
    const el = $(id);
    if (!el) return;
    if (filtered.length === 0) {
      el.innerHTML = `<span class="metric-empty">${isMonetary ? formatDisplay(0) : (isPercentage ? '0.00%' : '—')}</span>`;
      el.className = 'metric-val';
      return;
    }
    el.textContent = value;
    if (cssClass) el.className = `metric-val ${cssClass}`;
  };

  updateWidget('todayAbs', formatDisplay(toDisplay(todayAbsUSD)), true);
  updateWidget('todayPct', formatPct(todayPct), false, true, todayPct >= 0 ? 'pos' : 'neg');
  updateWidget('totalGain', formatDisplay(toDisplay(totalGainUSD)), true, false, totalGainUSD >= 0 ? 'pos' : 'neg');
  if ($('totalGainPct')) $('totalGainPct').textContent = formatPct(totalGainPct);
  updateWidget('bestTicker', bestAsset.ticker);
  if ($('bestPct')) {
    $('bestPct').textContent = filtered.length > 0 ? formatPct(bestAsset.change) : '0.00%';
    $('bestPct').className = `metric-sub ${bestAsset.change >= 0 ? 'up' : 'down'}`;
  }
  updateWidget('posCount', filtered.length);

  renderDonutChart(filtered);
  renderLineChart(totalUSD);
  if ($('riskAlerts')) runRiskEngine(filtered);
}

/* ═══════════════════════════════════════════════
   GRÁFICOS
═══════════════════════════════════════════════ */
function renderDonutChart(items) {
  const ctx = $('pieChart');
  if (!ctx) return;
  if (State.charts.donut) State.charts.donut.destroy();
  if (items.length === 0) { ctx.style.display = 'none'; return; }
  ctx.style.display = 'block';

  const labels = items.map(x => x.ticker.toUpperCase());
  const data = items.map(x => x.subtotalUSD);
  const defaultColors = ['#2563eb', '#3b82f6', '#60a5fa', '#93c5fd', '#1d4ed8'];
  const bgColors = labels.map((label, i) => label === 'BTC' ? '#F7931A' : defaultColors[i % defaultColors.length]);

  State.charts.donut = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: bgColors, borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: '#94a3b8', font: { family: 'monospace', size: 11 } } } } }
  });
}

function renderLineChart(currentTotalUSD = 0) {
  const ctx = $('lineChart');
  if (!ctx) return;
  if (State.charts.line) State.charts.line.destroy();

  const history = Storage.get(CONFIG.LS_HISTORY, []);
  const filterDays = { '1m': 30, '6m': 180, '1y': 365, 'ytd': 365 }[State.activeRange] || 30;
  const filteredHistory = history.slice(-filterDays);
  let labels = filteredHistory.map(h => h.date);
  let data = filteredHistory.map(h => h.value);

  if (labels.length === 0) {
    const today = new Date().toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
    labels = [today];
    data = [currentTotalUSD];
  } else if (labels.length === 1) {
    labels.push(labels[0] + ' (Actual)');
    data.push(currentTotalUSD);
  }

  State.charts.line = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [{ label: `Valor Total (${currencyLabel()})`, data: data.map(v => toDisplay(v)), borderColor: '#2962FF', backgroundColor: 'rgba(41, 98, 255, 0.1)', borderWidth: 2, fill: true, tension: 0.15, pointRadius: data.length === 1 ? 4 : 2 }] },
    options: {
      responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => formatDisplay(ctx.raw) } } },
      scales: { x: { ticks: { color: '#6E7683', font: { family: 'monospace' } }, grid: { display: false } }, y: { ticks: { color: '#6E7683', font: { family: 'monospace' }, callback: (val) => formatDisplay(val) }, grid: { color: 'rgba(255, 255, 255, 0.05)' } } }
    }
  });
}

/* ═══════════════════════════════════════════════
   RIESGO
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
      alerts.push({ type: 'warning', title: 'Alta Concentración', desc: `El activo **${p.ticker.toUpperCase()}** representa el ${share.toFixed(1)}% de tu cartera.` });
    }
    if (p.pnlPct < -15) {
      alerts.push({ type: 'danger', title: 'Alerta Stop-Loss Crítico', desc: `El activo **${p.ticker.toUpperCase()}** acumula una caída del ${p.pnlPct.toFixed(1)}%.` });
    }
  });

  if (alerts.length === 0) {
    alertsContainer.innerHTML = `<div class="no-risk">Todos los parámetros de riesgo estables.</div>`;
    return;
  }
  alerts.forEach(a => {
    const box = document.createElement('div');
    box.className = `risk-box ${a.type}`;
    box.innerHTML = `<strong>${escapeHtml(a.title)}:</strong> ${escapeHtml(a.desc)}`;
    alertsContainer.appendChild(box);
  });
}

/* ═══════════════════════════════════════════════
   BONOS WIDGET (corregido)
═══════════════════════════════════════════════ */
async function renderBondsInsightWidget() {
  const container = $('bondsInsightContainer');
  if (!container) return;

  try {
    const res = await fetch(API.BONDS_TOP_TIR);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    
    if (json.success && json.data && json.data.length > 0) {
      const topBonds = json.data.slice(0, 4);
      let html = '<div class="bonds-insight-grid">';
      topBonds.forEach(b => {
        html += `
          <div class="bond-insight-card">
            <div class="bond-insight-sym">${escapeHtml(b.symbol)}</div>
            <div class="bond-insight-metric">TIR: <span class="up">${b.tir.toFixed(1)}%</span></div>
          </div>
        `;
      });
      html += '</div>';
      container.innerHTML = html;
    } else {
      container.innerHTML = '<div class="error-msg">⚠️ No se recibieron datos de bonos. Verifique el servidor.</div>';
      console.warn('[Bonds] Respuesta sin datos:', json);
    }
  } catch (err) {
    console.error('[Bonds] Error cargando widget:', err);
    container.innerHTML = `<div class="error-msg">❌ Error cargando bonos: ${err.message}</div>`;
  }
}

/* ═══════════════════════════════════════════════
   FORMULARIO
═══════════════════════════════════════════════ */
async function handleAdd(e) {
  e.preventDefault();
  const errorDiv = $('addError');
  if (errorDiv) errorDiv.textContent = '';

  const tickerInputEl = $('tickerInput');
  const qtyInput = $('qtyInput');
  const avgInput = $('avgInput');
  const daysInput = $('daysInput');

  if (!tickerInputEl || !qtyInput || !avgInput) return;

  const ticker = tickerInputEl.value.trim().toUpperCase();
  const qty = parseFloat(qtyInput.value);
  const ppc = parseFloat(avgInput.value);
  const days = parseInt(daysInput ? daysInput.value : 0) || 0;
  
  const typeActiveBtn = document.querySelector('.type-btn.active');
  const rawType = typeActiveBtn ? typeActiveBtn.dataset.type : 'usd';

  if (!ticker || isNaN(qty) || qty <= 0 || isNaN(ppc) || ppc <= 0) {
    if (errorDiv) errorDiv.textContent = 'Complete todos los campos con valores positivos.';
    return;
  }

  let type = 'ACCION';
  let currency = 'USD';

  if (rawType === 'ar') {
    currency = 'ARS';
    const isBono = State.bondsDb.some(x => x.symbol.toUpperCase() === ticker.toUpperCase());
    type = isBono ? 'BONO' : 'ACCION';
  } else if (rawType === 'crypto') {
    type = 'CRYPTO';
  }

  const newPosition = { ticker, type, qty, ppc, currency, days };
  State.positions.push(newPosition);
  Storage.set(CONFIG.LS_POSITIONS, State.positions);
  
  const cache = Storage.get(CONFIG.LS_CACHE, {});
  delete cache[ticker];
  Storage.set(CONFIG.LS_CACHE, cache);

  tickerInputEl.value = '';
  qtyInput.value = '';
  avgInput.value = '';
  if (daysInput) daysInput.value = '0';

  NotificationManager.show('success', 'Posición Añadida', `Se integró ${ticker} correctamente.`);
  await renderAll();
}

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
   SELECTOR DE MONEDA BASE
═══════════════════════════════════════════════ */
function renderCurrencySelector() {
  // Eliminar instancia previa si existe
  const existing = document.getElementById('currency-selector-widget');
  if (existing) existing.remove();

  const widget = document.createElement('div');
  widget.id = 'currency-selector-widget';
  widget.className = 'currency-selector-widget';
  widget.setAttribute('aria-label', 'Selector de moneda base');

  widget.innerHTML = `
    <span class="currency-selector-label">Ver en:</span>
    <div class="currency-toggle" role="group" aria-label="Moneda de visualización">
      <button 
        class="currency-btn ${State.baseCurrency === 'USD' ? 'active' : ''}" 
        data-currency="USD" 
        aria-pressed="${State.baseCurrency === 'USD'}"
        title="Ver todo en Dólares (USD)">
        🇺🇸 USD
      </button>
      <button 
        class="currency-btn ${State.baseCurrency === 'ARS' ? 'active' : ''}" 
        data-currency="ARS" 
        aria-pressed="${State.baseCurrency === 'ARS'}"
        title="Ver todo en Pesos Argentinos (ARS) — usa Dólar MEP">
        🇦🇷 ARS
      </button>
    </div>
    <span class="currency-mep-rate">MEP: ${formatARS(State.mepPrice)}</span>
  `;

  // Insertar en el header, junto al bloque total
  const header = document.querySelector('.header');
  if (header) {
  const totalBlock = header.querySelector('.total-block');
  if (totalBlock) {
    totalBlock.insertAdjacentElement('afterend', widget);
    widget.style.marginLeft = 'auto';
    widget.style.marginTop = 'var(--space-sm)';
  } else {
    header.appendChild(widget);
  }
  }

  // Event listeners
  widget.querySelectorAll('.currency-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const selected = btn.dataset.currency;
      if (selected === State.baseCurrency) return;

      State.baseCurrency = selected;
      Storage.set(CONFIG.LS_CURRENCY, selected);

      // Actualizar botones
      widget.querySelectorAll('.currency-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.currency === selected);
        b.setAttribute('aria-pressed', b.dataset.currency === selected);
      });

      // Actualizar tasa MEP en el widget
      const rateEl = widget.querySelector('.currency-mep-rate');
      if (rateEl) rateEl.textContent = `MEP: ${formatARS(State.mepPrice)}`;

      NotificationManager.show('info', 'Moneda cambiada', `Visualizando en ${selected} — conversión por Dólar MEP.`, 3500);
      await renderAll();
    });
  });
}

/* ═══════════════════════════════════════════════
   INICIALIZACIÓN
═══════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  initClocks();

  // ── Cargar preferencia de moneda base ──────────────────────────────────
  State.baseCurrency = Storage.get(CONFIG.LS_CURRENCY, 'USD') || 'USD';
  renderCurrencySelector();
  
  // Cargar base de datos de bonos
  try {
    const bondsRes = await fetch(API.BONDS_DATA);
    if (!bondsRes.ok) throw new Error(`HTTP ${bondsRes.status}`);
    const bondsJson = await bondsRes.json();
    if (bondsJson.success && Array.isArray(bondsJson.data)) {
      State.bondsDb = bondsJson.data;
      console.log(`[API] ${State.bondsDb.length} bonos sincronizados.`);
    } else {
      console.warn('[API] Respuesta de bonos inválida:', bondsJson);
      State.bondsDb = [];
    }
  } catch (e) {
    console.error('Error cargando bonos:', e);
    NotificationManager.show('error', 'Error de bonos', 'No se pudo cargar la base de bonos. Algunas funciones pueden estar limitadas.');
    State.bondsDb = [];
  }

  await getMepPrice();
  State.positions = Storage.get(CONFIG.LS_POSITIONS, []);

  // ── Fix: reclasificar posiciones ARS guardadas como ACCION que son BONO ─
  if (State.bondsDb.length > 0) {
    let changed = false;
    State.positions = State.positions.map(pos => {
      if (pos.currency === 'ARS' && pos.type === 'ACCION') {
        const isBono = State.bondsDb.some(x => x.symbol.toUpperCase() === pos.ticker.toUpperCase());
        if (isBono) { changed = true; return { ...pos, type: 'BONO' }; }
      }
      return pos;
    });
    if (changed) {
      Storage.set(CONFIG.LS_POSITIONS, State.positions);
      console.log('[Fix] Posiciones re-clasificadas como BONO.');
    }
  }
  
  const history = Storage.get(CONFIG.LS_HISTORY, []);
  const todayStr = new Date().toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
  const { totalUSD } = await processPositions();
  
  if (totalUSD > 0 && (!history.length || history[history.length - 1].date !== todayStr)) {
    history.push({ date: todayStr, value: totalUSD });
    if (history.length > CONFIG.HISTORY_MAX) history.shift();
    Storage.set(CONFIG.LS_HISTORY, history);
  }

  await renderAll();
  
  // Cargar widget de bonos (top TIR)
  if ($('bondsInsightContainer')) await renderBondsInsightWidget();

  const addBtn = $('addBtn');
  if (addBtn) addBtn.onclick = handleAdd;

  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
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

  window.deletePos = async (index) => {
    if (index < 0 || index >= State.positions.length) return;
    const removed = State.positions[index];
    State.positions.splice(index, 1);
    Storage.set(CONFIG.LS_POSITIONS, State.positions);
    await renderAll();
    NotificationManager.show('info', 'Posición eliminada', `${removed.ticker} removido de la cartera.`, 3500);
  };
  
  NotificationManager.show('info', 'Sistema Listo', 'Motor de riesgo e interfaz sincronizados.', 4000);
});