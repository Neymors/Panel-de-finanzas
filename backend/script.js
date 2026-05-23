/**
 * Amygdalé — Financial Dashboard & Risk Control
 * Vanilla JS | Local-First | Amygdalé API + Yahoo + CoinGecko + DolarApi
 * Version: 3.4 — Zero-Trust Suffix Isolation & Defensive Format Architecture
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
  YAHOO: 'https://query1.finance.yahoo.com/v8/finance/chart/'
};

const tickerInput = document.getElementById('tickerInput');
const suggestionBox = document.getElementById('suggestionBox');

/* ═══════════════════════════════════════════════
   SISTEMA DE NOTIFICACIONES EMBAJADOR (UI/UX)
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
    // 1. Prevención de duplicados
    const hash = `${type}|${title}|${message}`;
    if (this.activeHashes.has(hash)) return;
    this.activeHashes.add(hash);

    const stack = this.getStack();
    
    // Controlar máximo de notificaciones visibles
    const currentCards = stack.querySelectorAll('.notification-card');
    if (currentCards.length >= CONFIG.NOTIFICATION_MAX_VISIBLE) {
      this.dismiss(currentCards[0]); // Elimina la más antigua
    }

    // 2. Renderizar la nueva notificación
    const card = document.createElement('div');
    card.className = `notification-card ${type}`;
    card.setAttribute('role', 'alert');
    card.dataset.hash = hash; // Guardamos el hash en el DOM

    const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };

    card.innerHTML = `
      <div class="notification-icon">${icons[type] || 'ℹ'}</div>
      <div class="notification-content">
        <div class="notification-title">${title}</div>
        <div class="notification-message">${message}</div>
      </div>
      <button class="notification-dismiss" aria-label="Cerrar notificación">×</button>
    `;

    stack.appendChild(card);
    triggerReflow(card); // Forzar reflow para la animación
    card.classList.add('visible');

    // 3. Manejo de cierre individual y auto-dismiss
    let dismissTimeout;
    const duration = customDuration || CONFIG.AUTO_DISMISS[type] || 5000;

    const closeBtn = card.querySelector('.notification-dismiss');
    closeBtn.onclick = () => {
      clearTimeout(dismissTimeout);
      this.dismiss(card);
    };

    dismissTimeout = setTimeout(() => this.dismiss(card), duration);

    // 4. Renderizar botón "Eliminar Todas" si aplica
    this.renderClearAllBtn();
  },

  dismiss(card) {
    if (!card || card.classList.contains('removing')) return;
    
    // Liberar el hash para permitir notificaciones idénticas en el futuro
    this.activeHashes.delete(card.dataset.hash);
    
    card.classList.remove('visible');
    card.classList.add('removing');
    
    card.addEventListener('animationend', () => {
      if (card.parentNode) {
        card.parentNode.removeChild(card);
        this.renderClearAllBtn(); // Actualizar botón global tras eliminar
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
/* ═══════════════════════════════════════════════
   ESTADO GLOBAL DE LA APLICACIÓN (STATE)
═══════════════════════════════════════════════ */
const State = {
  positions: [],
  bondsDb: [],
  mepPrice: CONFIG.DEFAULT_MEP,
  activeType: 'ALL',
  activeRange: '1M',
  charts: {
    donut: null,
    line: null
  }
};

/* ═══════════════════════════════════════════════
   MANEJO DE ALMACENAMIENTO (LOCAL STORAGE)
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
   MÓDULO DE ADQUISICIÓN DE PRECIOS & PROXY
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
    console.error('Error obtuvo Dólar MEP, usando fallback:', e);
  }
  State.mepPrice = CONFIG.DEFAULT_MEP;
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
        throw new Error('Bono no mapeado en base de datos local');
      }
    } 
    else if (type === 'CRYPTO') {
      const idMap = { 'BTC': 'bitcoin', 'ETH': 'ethereum', 'USDT': 'tether', 'SOL': 'solana' };
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
        throw new Error('Formato Crypto inválido o no encontrado');
      }
    } 
    else { 
      // Intercepción determinista y normalización estricta del símbolo para mercado local (BYMA)
      let symbol = ticker.toUpperCase().trim();
      const localTickers = ['ALUA', 'BYMA', 'YPFD', 'PAMP', 'GGAL', 'BMA', 'EDN', 'CEPU', 'TGSU2'];
      const storedPositions = Storage.get(CONFIG.LS_POSITIONS, []);
      const matchedStored = storedPositions.find(p => p.ticker.toUpperCase().trim() === symbol);
      
      const isLocalAsset = localTickers.includes(symbol) || 
                          (matchedStored && matchedStored.currency === 'ARS') ||
                          (State.positions.some(p => p.ticker.toUpperCase().trim() === symbol && p.currency === 'ARS'));

      if (isLocalAsset && !symbol.endsWith('.BA')) {
        symbol = `${symbol}.BA`;
      }

      const data = await fetchWithProxy(`${API.YAHOO}${symbol}`, {
        interval: '1d',
        range: '2d'
      });

      const result = data?.chart?.result?.[0];
      if (result) {
        const meta = result.meta;
        const indicators = result.indicators?.quote?.[0];
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
          throw new Error('No se encontraron precios válidos en Yahoo');
        }

        if (meta?.shortName) name = meta.shortName;
      } else {
        throw new Error('Estructura de Yahoo Finance no interpretada');
      }
    }

    const updatedAsset = { price, change, name, ts: now };
    cache[ticker] = updatedAsset;
    Storage.set(CONFIG.LS_CACHE, cache);
    return updatedAsset;

  } catch (err) {
    console.error(`⚠️ Error obteniendo ${ticker}:`, err.message);
    // Control de fallos: Se inyecta 'change: 0' para neutralizar interrupciones en cascada de formatPct
    return cache[ticker] || { price: 0, change: 0, name: ticker, ts: 0 };
  }
}

/* ═══════════════════════════════════════════════
   CÁLCULOS METÁLICOS Y PROCESAMIENTO
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
   SISTEMA DE RENDERIZADO & UI DYNAMICS
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

async function renderAll() {
  console.log('[UI] Iniciando renderizado de métricas y tabla...');

  // 1. Inyectar estado "Loading" en los widgets
  const metricIds = ['todayPct', 'todayAbs', 'totalGain', 'totalGainPct', 'bestTicker', 'bestPct', 'posCount', 'totalUSD', 'totalARS'];
  metricIds.forEach(id => {
    const el = $(id);
    if (el) el.innerHTML = '<span class="loading-pulse">Calculando...</span>';
  });

  // 2. Procesar posiciones y filtrar
  const { processed, totalUSD } = await processPositions();
  const filtered = processed.filter(p => State.activeType === 'ALL' || p.type === State.activeType);

  // 3. Variables para acumuladores matemáticos
  let totalInvestedUSD = 0;
  let todayAbsUSD = 0;
  let bestAsset = { ticker: '—', change: -Infinity };

  // 4. Renderizar Tabla y calcular globales
  const tbody = $('posTable');
  if (tbody) tbody.innerHTML = '';

  if (filtered.length === 0) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="10" class="empty-row">Agregá tu primera posición para iniciar el análisis ↑</td></tr>`;
    bestAsset = { ticker: '—', change: 0 };
  } else {
    filtered.forEach((p, index) => {
      // Cálculos globales
      const capitalInvertidoPosicionUSD = p.currency === 'ARS' ? (p.ppc / State.mepPrice) * p.qty : p.ppc * p.qty;
      totalInvestedUSD += capitalInvertidoPosicionUSD;

      // Variación diaria (Prevención de división por cero si change es -100%)
      const changeDec = p.change / 100;
      const prevPriceUSD = changeDec === -1 ? p.currentPriceUSD : p.currentPriceUSD / (1 + changeDec);
      todayAbsUSD += (p.currentPriceUSD - prevPriceUSD) * p.qty;

      // Mejor activo
      if (p.change > bestAsset.change) {
        bestAsset = { ticker: p.ticker.toUpperCase(), change: p.change };
      }

      // Renderizado de fila
      if (tbody) {
        const share = totalUSD > 0 ? (p.subtotalUSD / totalUSD) * 100 : 0;
        const tr = document.createElement('tr');
        const changeClass = p.change >= 0 ? 'up' : 'down';
        const pnlClass = p.pnlAbsUSD >= 0 ? 'up' : 'down';

        tr.innerHTML = `
          <td>
            <div class="ticker-main">${p.ticker.toUpperCase()}</div>
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

  // 5. Consolidación matemática final
  const totalGainUSD = totalUSD - totalInvestedUSD;
  const totalGainPct = totalInvestedUSD > 0 ? (totalGainUSD / totalInvestedUSD) * 100 : 0;
  
  const prevTotalPortfolioUSD = totalUSD - todayAbsUSD;
  const todayPct = prevTotalPortfolioUSD > 0 ? (todayAbsUSD / prevTotalPortfolioUSD) * 100 : 0;

  console.log(`[Cálculos] Invertido: ${totalInvestedUSD.toFixed(2)} | Actual: ${totalUSD.toFixed(2)} | PnL Día: ${todayAbsUSD.toFixed(2)}`);

  // 6. Imprimir valores en los widgets
  const updateWidget = (id, value, isMonetary = false, isPercentage = false, cssClass = '') => {
    const el = $(id);
    if (!el) return;
    
    if (filtered.length === 0) {
       el.innerHTML = `<span class="metric-empty">${isMonetary ? '$0.00' : (isPercentage ? '0.00%' : '—')}</span>`;
       el.className = 'metric-val'; // Reseteamos colores si está vacío
       return;
    }

    el.textContent = value;
    if (cssClass) {
      el.className = `metric-val ${cssClass}`;
    }
  };

  // Header Totales
  if ($('totalUSD')) $('totalUSD').textContent = formatUSD(totalUSD);
  if ($('totalARS')) $('totalARS').textContent = formatARS(totalUSD * State.mepPrice);
  if ($('mepValue')) $('mepValue').textContent = formatARS(State.mepPrice);

  // Widget 1: Rendimiento Diario
  updateWidget('todayAbs', formatUSD(todayAbsUSD), true);
  updateWidget('todayPct', formatPct(todayPct), false, true, todayPct >= 0 ? 'pos' : 'neg');

  // Widget 2: P&L Total Acumulado
  updateWidget('totalGain', formatUSD(totalGainUSD), true, false, totalGainUSD >= 0 ? 'pos' : 'neg');
  if ($('totalGainPct')) $('totalGainPct').textContent = formatPct(totalGainPct);

  // Widget 3: Mayor Variación Hoy
  updateWidget('bestTicker', bestAsset.ticker);
  if ($('bestPct')) {
    $('bestPct').textContent = filtered.length > 0 ? formatPct(bestAsset.change) : '0.00%';
    $('bestPct').className = `metric-sub ${bestAsset.change >= 0 ? 'up' : 'down'}`;
  }

  // Widget 4: Activos en Cartera
  updateWidget('posCount', filtered.length);

  // 7. Disparar renderizado de gráficos
  renderDonutChart(filtered);
  renderLineChart(totalUSD); // Pasamos totalUSD para el fallback del gráfico
  
  if ($('riskAlerts')) {
    runRiskEngine(filtered);
  }
}

/* ═══════════════════════════════════════════════
   MOTOR DE RENDERIZADO DE GRÁFICOS
═══════════════════════════════════════════════ */
// ... (Mantén tu función renderDonutChart intacta aquí) ...

function renderLineChart(currentTotalUSD = 0) {
  const ctx = $('lineChart');
  if (!ctx) return;

  if (State.charts.line) State.charts.line.destroy();

  const history = Storage.get(CONFIG.LS_HISTORY, []);
  const filterDays = { '1m': 30, '6m': 180, '1y': 365, 'ytd': 365 }[State.activeRange] || 30;
  const filteredHistory = history.slice(-filterDays);

  let labels = filteredHistory.map(h => h.date);
  let data = filteredHistory.map(h => h.value);

  // Fallback: Si no hay historial, NO mostrar datos inventados. 
  // Mostrar una línea plana con el valor actual o un gráfico vacío.
  if (labels.length === 0) {
    console.log('[Chart] Historial vacío. Mostrando fallback plano.');
    const today = new Date().toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
    labels = [today];
    data = [currentTotalUSD];
  } else if (labels.length === 1) {
    // Si solo hay un día, duplicamos el punto para que se dibuje una línea horizontal visible
    labels.push(labels[0] + ' (Actual)');
    data.push(currentTotalUSD);
  }

  State.charts.line = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Valor Total (USD)',
        data,
        borderColor: '#2D7EE8', /* Usando tu token --blue */
        backgroundColor: 'rgba(45, 126, 232, 0.1)',
        borderWidth: 2,
        fill: true,
        tension: 0.15,
        pointRadius: data.length === 1 ? 4 : 2, // Hacer visible el punto si es uno solo
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(context) {
              return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(context.raw);
            }
          }
        }
      },
      scales: {
        x: { ticks: { color: '#6E7683', font: { family: 'monospace' } }, grid: { display: false } },
        y: { 
          ticks: { 
            color: '#6E7683', 
            font: { family: 'monospace' },
            callback: function(value) { return '$' + value; }
          }, 
          grid: { color: 'rgba(255, 255, 255, 0.05)' } 
        }
      }
    }
  });
}

/* ═══════════════════════════════════════════════
   MOTOR DE RENDERIZADO DE GRÁFICOS
═══════════════════════════════════════════════ */
function renderDonutChart(items) {
  const ctx = $('pieChart'); 
  if (!ctx) return;

  if (State.charts.donut) State.charts.donut.destroy();
  if (items.length === 0) {
    ctx.style.display = 'none';
    return;
  }
  ctx.style.display = 'block';

  const labels = items.map(x => x.ticker.toUpperCase());
  const data = items.map(x => x.subtotalUSD);
  const colors = ['#2563eb', '#3b82f6', '#60a5fa', '#93c5fd', '#1d4ed8'];

  State.charts.donut = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors.slice(0, labels.length),
        borderWidth: 0
      }]
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
    labels = Array.from({ length: 5 }, (_, i) => `Punto ${i+1}`);
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
   MOTOR DE RIESGO DE CARTERA
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
      alerts.push({
        type: 'warning',
        title: 'Alta Concentración',
        desc: `El activo **${p.ticker.toUpperCase()}** representa el ${share.toFixed(1)}% de tu cartera.`
      });
    }
    if (p.pnlPct < -15) {
      alerts.push({
        type: 'danger',
        title: 'Alerta Stop-Loss Crítico',
        desc: `El activo **${p.ticker.toUpperCase()}** acumula una caída del ${p.pnlPct.toFixed(1)}%.`
      });
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
   WIDGET DE BONOS INTELIGENTES
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
          </div>
        `;
      });
      html += '</div>';
      container.innerHTML = html;
    }
  } catch (err) {
    container.innerHTML = `<div class="error-msg">No se pudo cargar el análisis de renta fija.</div>`;
  }
}

/* ═══════════════════════════════════════════════
   MANEJO DE EVENTOS Y FORMULARIOS (HANDLERS)
═══════════════════════════════════════════════ */
async function handleAdd(e) {
  e.preventDefault();
  const errorDiv = $('addError');
  if (errorDiv) errorDiv.textContent = '';

  const tickerInput = $('tickerInput');
  const qtyInput = $('qtyInput');
  const avgInput = $('avgInput');
  const daysInput = $('daysInput');

  if (!tickerInput || !qtyInput || !avgInput) return;

  const ticker = tickerInput.value.trim().toUpperCase();
  const qty = parseFloat(qtyInput.value);
  const ppc = parseFloat(avgInput.value);
  const days = parseInt(daysInput ? daysInput.value : 0) || 0;
  
  const typeActiveBtn = document.querySelector('.type-btn.active');
  const rawType = typeActiveBtn ? typeActiveBtn.dataset.type : 'usd';

  if (!ticker || isNaN(qty) || qty <= 0 || isNaN(ppc) || ppc <= 0) {
    if (errorDiv) errorDiv.textContent = 'Completa todos los campos obligatorios con valores positivos.';
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

  tickerInput.value = '';
  qtyInput.value = '';
  avgInput.value = '';
  if (daysInput) daysInput.value = '0';

  NotificationManager.show('success', 'Posición Añadida', `Se integró **${ticker}** de forma exitosa.`);
  await renderAll();
}

function injectControls() {
  const container = $('controlsContainer');
  if (!container) return;

  container.innerHTML = `
    <div class="segment-controls">
      <div class="control-card">
        <div class="card-title">Filtro de Segmentación</div>
        <div class="filter-row">
          <button class="filter-btn active" data-filter="ALL">Todos</button>
          <button class="filter-btn" data-filter="ACCION">Acciones/CEDEARs</button>
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
   PUNTO DE ENTRADA INICIALIZADOR (DOM READY)
═══════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  initClocks();
  
  try {
    const bondsRes = await fetch(API.BONDS_DATA);
    if (!bondsRes.ok) throw new Error('Error al sincronizar base de datos de bonos');
    const bondsJson = await bondsRes.json();
    if (bondsJson.success) {
      State.bondsDb = bondsJson.data;
      console.log(`[API] Sincronizados ${State.bondsDb.length} bonos en memoria.`);
    }
  } catch (e) {
    console.error('Error inicial:', e);
    NotificationManager.show('error', 'Fallo de sincronización', 'No se pudo conectar con el motor de bonos.');
  }

  await getMepPrice();
  State.positions = Storage.get(CONFIG.LS_POSITIONS, []);
  
  const history = Storage.get(CONFIG.LS_HISTORY, []);
  const todayStr = new Date().toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
  const { totalUSD } = await processPositions();
  
  if (totalUSD > 0 && (!history.length || history[history.length - 1].date !== todayStr)) {
    history.push({ date: todayStr, value: totalUSD });
    if (history.length > CONFIG.HISTORY_MAX) history.shift();
    Storage.set(CONFIG.LS_HISTORY, history);
  }

  await renderAll();
  injectControls();
  
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