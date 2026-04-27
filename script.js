'use strict';

const PROXY = '/api/proxy';
const LS_POSITIONS = 'portfolio_positions_v2';
let positions = []; 
let priceCache = {};
let mepRate = null;
let activeType = 'ar';
let charts = { pie: null, line: null };

const el = (id) => document.getElementById(id);
const lsGet = (key) => JSON.parse(localStorage.getItem(key));
const lsSet = (key, val) => localStorage.setItem(key, JSON.stringify(val));

const fmt = {
    usd: v => '$' + Math.abs(v).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2}),
    ars: v => '$' + Math.abs(v).toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2}),
    pct: v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + '%',
};

const colorClass = (v) => v >= 0 ? 'pos' : 'neg';

// ─── 1. RELOJES (AR & NY) ─────────────────────────────────────
function updateClocks() {
    const options = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
    if (el('clockAR')) el('clockAR').innerText = 'BA ' + new Date().toLocaleTimeString('es-AR', { ...options, timeZone: 'America/Argentina/Buenos_Aires' });
    if (el('clockNY')) el('clockNY').innerText = 'NY ' + new Date().toLocaleTimeString('en-US', { ...options, timeZone: 'America/New_York' });
}
setInterval(updateClocks, 1000);

// ─── 2. MÉTRICAS SUPERIORES ───────────────────────────────────
function updateTopMetrics(processed, totalVal) {
    let totalGain = 0;
    let totalCost = 0;
    let bestToday = { ticker: '—', change: -Infinity };
    let weightedChangeToday = 0;

    processed.forEach(item => {
        totalGain += item.pnl;
        totalCost += item.cost;
        weightedChangeToday += (item.info.change * (item.valUSD / (totalVal || 1)));
        
        if (item.info.change > bestToday.change) {
            bestToday = { ticker: item.pos.ticker, change: item.info.change };
        }
    });

    // Ganancia Total
    if (el('totalGain')) el('totalGain').innerText = fmt.usd(totalGain);
    if (el('totalGainPct')) el('totalGainPct').innerText = totalCost > 0 ? fmt.pct((totalGain / totalCost) * 100) : '0.00%';

    // Portfolio Hoy
    if (el('todayPct')) {
        el('todayPct').innerText = fmt.pct(weightedChangeToday);
        el('todayPct').className = 'metric-val ' + colorClass(weightedChangeToday);
    }

    // Posiciones
    if (el('posCount')) el('posCount').innerText = processed.length;

    // Mejor Hoy
    if (el('bestTicker')) el('bestTicker').innerText = bestToday.ticker;
    if (el('bestPct')) {
        el('bestPct').innerText = bestToday.change !== -Infinity ? fmt.pct(bestToday.change) : '—';
        el('bestPct').className = 'metric-sub ' + colorClass(bestToday.change);
    }
}

// ─── 3. GRÁFICOS (Chart.js) ──────────────────────────────────
function renderCharts(processed) {
    // Gráfico de Distribución (Pie)
    const ctxPie = el('pieChart')?.getContext('2d');
    if (!ctxPie) return;

    if (charts.pie) charts.pie.destroy();
    
    const data = processed.filter(p => p.valUSD > 0);
    charts.pie = new Chart(ctxPie, {
        type: 'doughnut',
        data: {
            labels: data.map(p => p.pos.ticker),
            datasets: [{
                data: data.map(p => p.valUSD),
                backgroundColor: ['#378ADD', '#1D9E75', '#E8A838', '#E05C5C', '#8B5CF6'],
                borderWidth: 0,
                hoverOffset: 4
            }]
        },
        options: {
            plugins: { legend: { display: false } },
            maintainAspectRatio: false,
            cutout: '70%'
        }
    });

    // Gráfico Portfolio vs Benchmark (Simulado/Estructura)
    const ctxLine = el('lineChart')?.getContext('2d');
    if (!ctxLine) return;
    if (charts.line) charts.line.destroy();

    charts.line = new Chart(ctxLine, {
        type: 'line',
        data: {
            labels: ['1', '2', '3', '4', '5'], // Aquí irían fechas históricas
            datasets: [{
                label: 'Mi Portfolio',
                data: [100, 102, 101, 105, 108], // Datos reales requerirían historial en LS
                borderColor: '#378ADD',
                tension: 0.3,
                pointRadius: 0
            }]
        },
        options: {
            plugins: { legend: { display: false } },
            maintainAspectRatio: false,
            scales: { y: { display: false }, x: { display: false } }
        }
    });
}

// ─── 4. RENDER TABLA Y UNIFICACIÓN ───────────────────────────
function renderAll() {
    let totalPortfolioUSD = 0;
    const tbody = el('posTable');
    if (!tbody) return;

    const processed = positions.map(pos => {
        const info = priceCache[pos.ticker] || { price: 0, change: 0 };
        const holdings = pos.holdings || [];
        const qty = holdings.reduce((s, h) => s + h.qty, 0);
        const valUSD = pos.type === 'ar' ? (info.price * qty / (mepRate || 1)) : (info.price * qty);
        
        const costUSD = holdings.reduce((s, h) => {
            const c = pos.type === 'ar' ? (h.price / (h.tc || mepRate || 1)) : h.price;
            return s + (c * h.qty);
        }, 0);

        totalPortfolioUSD += valUSD;
        return { pos, info, qty, valUSD, cost: costUSD, pnl: valUSD - costUSD };
    });

    el('totalVal').innerText = fmt.usd(totalPortfolioUSD);
    
    updateTopMetrics(processed, totalPortfolioUSD);
    renderCharts(processed);

    if (processed.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="empty-row">Agregá tu primera posición arriba ↑</td></tr>';
        return;
    }

    tbody.innerHTML = processed.map((item, i) => {
        const { pos, info, qty, valUSD, cost, pnl } = item;
        const ppc = cost / (qty || 1);
        const weight = totalPortfolioUSD > 0 ? (valUSD / totalPortfolioUSD) * 100 : 0;
        const per = cost > 0 ? (pnl / cost) * 100 : 0;

        return `
            <tr>
                <td><strong>${pos.ticker}</strong></td>
                <td>${pos.type === 'ar' ? fmt.ars(info.price) : fmt.usd(info.price)}</td>
                <td class="${colorClass(info.change)}">${fmt.pct(info.change)}</td>
                <td>${qty.toFixed(2)}</td>
                <td>${pos.type === 'ar' ? fmt.ars(ppc) : fmt.usd(ppc)}</td>
                <td>${Math.ceil(Math.abs(new Date() - new Date(item.pos.holdings[0].date)) / (1000*60*60*24))} d</td>
                <td>${weight.toFixed(1)}%</td>
                <td class="${colorClass(pnl)}">${fmt.usd(pnl)}</td>
                <td class="${colorClass(per)}">${fmt.pct(per)}</td>
                <td><button class="del-btn" onclick="deletePos(${i})">✕</button></td>
            </tr>
        `;
    }).join('');
}

// ─── FETCHING & ACTIONS (Se mantienen de tu código previo) ─────
async function fetchViaProxy(url) {
    try {
        const res = await fetch(`${PROXY}?url=${encodeURIComponent(url)}`);
        return await res.json();
    } catch (e) { return null; }
}

async function getPrice(ticker, type) {
    try {
        if (type === 'crypto') {
            const map = { BTC:'bitcoin', ETH:'ethereum', SOL:'solana', USDT:'tether' };
            const id = map[ticker] || ticker.toLowerCase();
            const data = await fetchViaProxy(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true`);
            return { price: data[id].usd, change: data[id].usd_24h_change };
        } else {
            const symbol = type === 'ar' ? (ticker.includes('.') ? ticker : `${ticker}.BA`) : ticker;
            const data = await fetchViaProxy(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=2d`);
            const meta = data.chart.result[0].meta;
            return { price: meta.regularMarketPrice, change: ((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose) * 100 };
        }
    } catch (e) { return { price: 0, change: 0 }; }
}

async function handleAdd(e) {
    if(e) e.preventDefault();
    const ticker = el('tickerInput').value.trim().toUpperCase();
    const qty = parseFloat(el('qtyInput').value);
    const ppc = parseFloat(el('avgInput').value);
    const days = parseInt(el('daysInput').value) || 0;

    if (!ticker || isNaN(qty) || isNaN(ppc)) return;

    const purchaseDate = new Date();
    purchaseDate.setDate(purchaseDate.getDate() - days);
    const holding = { qty, price: ppc, date: purchaseDate.toISOString(), tc: mepRate };
    
    const existing = positions.find(p => p.ticker === ticker);
    if (existing) {
        existing.holdings.push(holding);
    } else {
        positions.push({ ticker, type: activeType, holdings: [holding] });
    }

    lsSet(LS_POSITIONS, positions);
    ['tickerInput', 'qtyInput', 'avgInput', 'daysInput'].forEach(id => el(id).value = '');
    
    const newPrice = await getPrice(ticker, activeType);
    priceCache[ticker] = newPrice;
    renderAll();
}

window.deletePos = (i) => {
    positions.splice(i, 1);
    lsSet(LS_POSITIONS, positions);
    renderAll();
};

async function init() {
    updateClocks();
    positions = lsGet(LS_POSITIONS) || [];
    
    const mepData = await fetchViaProxy('https://dolarapi.com/v1/dolares/bolsa');
    if (mepData) mepRate = parseFloat(mepData.venta);
    if (el('sourceRow')) el('sourceRow').innerText = mepRate ? `Dólar MEP: $${mepRate.toFixed(2)}` : 'Error cargando MEP';

    if (positions.length > 0) {
        const results = await Promise.all(positions.map(p => getPrice(p.ticker, p.type)));
        positions.forEach((p, i) => priceCache[p.ticker] = results[i]);
    }

    renderAll();
    el('addBtn').onclick = handleAdd;
    document.querySelectorAll('.type-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.preventDefault();
            document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeType = btn.dataset.type;
        };
    });
}

document.addEventListener('DOMContentLoaded', init);