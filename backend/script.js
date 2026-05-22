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

/* ═══════════════════════════════════════════════
   SISTEMA DE NOTIFICACIONES EMBAJADOR (UI/UX)
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
        throw new Error('Formato Crypto inválido');
      }
    } 
    else { 
      let symbol = ticker.toUpperCase();
      if (symbol === 'APPL') symbol = 'AAPL';

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
          throw new Error('No se encontraron precios válidos en Yahoo Finance');
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
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
}

function formatARS(val) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(val);
}

function formatPct(val) {
  return (val >= 0 ? '+' : '') + val.toFixed(2) + '%';
}

function triggerReflow(el) {
  return el.offsetHeight;
}

async function renderAll() {
  const { processed, totalUSD } = await processPositions();
  
  // Saneo Defensivo de los selectores del Header para acoplarse al index.html real
  if ($('totalVal')) $('totalVal').textContent = formatUSD(totalUSD);
  if ($('totalUSD')) $('totalUSD').textContent = formatUSD(totalUSD);
  if ($('totalARS')) $('totalARS').textContent = formatARS(totalUSD * State.mepPrice);
  if ($('mepValue')) $('mepValue').textContent = formatARS(State.mepPrice);

  const tbody = $('posTable');
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
  
  if ($('riskAlerts')) {
    runRiskEngine(filtered);
  }
}

/* ═══════════════════════════════════════════════
   MOTOR DE RENDERIZADO DE GRÁFICOS
═══════════════════════════════════════════════ */
function renderDonutChart(items) {
  // Ajustado a 'pieChart' para coincidir con tu index.html real
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
   MOTOR DE RIESGO DE INTELIGENCIA ARTIFICIAL
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
  errorDiv.textContent = '';

  const ticker = $('tickerInput').value.trim().toUpperCase();
  const qty = parseFloat($('qtyInput').value);
  const ppc = parseFloat($('avgInput').value); // Corregido: Tu ID en el HTML es 'avgInput'
  const days = parseInt($('daysInput').value) || 0;
  
  const typeActiveBtn = document.querySelector('.type-btn.active');
  const rawType = typeActiveBtn ? typeActiveBtn.dataset.type : 'usd';

  if (!ticker || isNaN(qty) || qty <= 0 || isNaN(ppc) || ppc <= 0) {
    errorDiv.textContent = 'Completa todos los campos obligatorios con valores positivos.';
    return;
  }

  // Mapeador Dinámico de Tipos para evitar desvíos 404 a Yahoo Finance
  let type = 'ACCION';
  let currency = 'USD';

  if (rawType === 'ar') {
    currency = 'ARS';
    // Si el ticker figura dentro de la base de datos de bonos locales, va por Rava
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
  if (ticker === 'APPL' || ticker === 'AAPL') { delete cache['APPL']; delete cache['AAPL']; }
  Storage.set(CONFIG.LS_CACHE, cache);

  $('tickerInput').value = '';
  $('qtyInput').value = '';
  $('avgInput').value = '';
  $('daysInput').value = '0';

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

  $('addBtn').onclick = handleAdd;

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
    const removed = State.positions[index];
    State.positions.splice(index, 1);
    Storage.set(CONFIG.LS_POSITIONS, State.positions);
    await renderAll();
    NotificationManager.show('info', 'Posición eliminada', `${removed.ticker} removido de la cartera.`, 3500);
  };
  
  NotificationManager.show('info', 'Sistema Listo', 'Motor de riesgo e interfaz sincronizados.', 4000);
});