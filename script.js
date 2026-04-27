'use strict';

const LS_POSITIONS = 'portfolio_positions_v2';
let positions = []; 
let priceCache = {};
let priceHistoryCache = {};
let mepRate = null;
let activeType = 'ar';
let charts = { pie: null, line: null };
let selectedRange = '1M';

const el = (id) => document.getElementById(id);
const lsGet = (key) => JSON.parse(localStorage.getItem(key));
const lsSet = (key, val) => localStorage.setItem(key, JSON.stringify(val));

const fmt = {
    usd: v => '$' + Math.abs(v).toLocaleString('en-US', {minimumFractionDigits:2}),
    ars: v => '$' + Math.abs(v).toLocaleString('es-AR', {minimumFractionDigits:2}),
    pct: v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + '%',
};

const colorClass = (v) => v >= 0 ? 'pos' : 'neg';

// ─── RELOJES ─────────────────────────────────────────────────
function updateClocks() {
    const opt = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
    if (el('clockAR')) el('clockAR').innerText = 'BA ' + new Date().toLocaleTimeString('es-AR', { ...opt, timeZone: 'America/Argentina/Buenos_Aires' });
    if (el('clockNY')) el('clockNY').innerText = 'NY ' + new Date().toLocaleTimeString('en-US', { ...opt, timeZone: 'America/New_York' });
}
setInterval(updateClocks, 1000);

// ─── MÉTRICAS SUPERIORES ──────────────────────────────────────
function updateTopMetrics(processed, totalVal) {
    let totalGainUSD = 0;
    let totalCostUSD = 0;
    let portfolioChangeToday = 0;
    let bestToday = { ticker: '—', change: -Infinity };

    processed.forEach(item => {
        totalGainUSD += item.pnlUSD;
        totalCostUSD += item.costUSD;
        portfolioChangeToday += (item.info.change / 100) * item.valUSD;
        if (item.info.change > bestToday.change) {
            bestToday = { ticker: item.pos.ticker, change: item.info.change };
        }
    });

    if (el('totalGain')) el('totalGain').innerText = fmt.usd(totalGainUSD);
    if (el('totalGainPct')) el('totalGainPct').innerText = totalCostUSD > 0 ? fmt.pct((totalGainUSD / totalCostUSD) * 100) : '0.00%';
    if (el('posCount')) el('posCount').innerText = processed.length;
    
    if (el('bestTicker')) el('bestTicker').innerText = bestToday.ticker;
    if (el('bestPct')) {
        el('bestPct').innerText = bestToday.change !== -Infinity ? fmt.pct(bestToday.change) : '—';
        el('bestPct').className = 'metric-sub ' + colorClass(bestToday.change);
    }

    // Portfolio hoy - cambio porcentual diario
    if (el('todayPct')) {
        const portfolioPctChange = totalVal > 0 ? (portfolioChangeToday / (totalVal - portfolioChangeToday)) * 100 : 0;
        el('todayPct').innerText = fmt.pct(portfolioPctChange);
        el('todayPct').className = colorClass(portfolioPctChange);
    }
}

// ─── PIE CHART ────────────────────────────────────────────────
function renderPieChart(processed, totalPortfolioUSD) {
    const ctx = el('pieChart');
    if (!ctx) return;

    const labels = processed.map(item => item.pos.ticker);
    const data = processed.map(item => (item.valUSD / totalPortfolioUSD) * 100);
    const colors = [
        '#185fa5', '#378ADD', '#0f6e56', '#a32d2d',
        '#f09595', '#7bc99a', '#85b7eb', '#5dcaa5'
    ];

    if (charts.pie) charts.pie.destroy();

    charts.pie = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors.slice(0, labels.length),
                borderColor: 'var(--surface)',
                borderWidth: 2,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            }
        }
    });

    // Renderizar leyenda
    const legend = el('pieLegend');
    if (legend) {
        legend.innerHTML = labels.map((label, i) => 
            `<span><span class="leg-dot" style="background:${colors[i]};"></span>${label}</span>`
        ).join('');
    }
}

// ─── LINE CHART (Portfolio vs Benchmark) ───────────────────────
function renderLineChart() {
    const ctx = el('lineChart');
    if (!ctx) return;

    // Datos simulados para demostración
    const labels = ['Hace 30d', 'Hace 20d', 'Hace 10d', 'Hoy'];
    const portfolioData = [95, 98, 102, 105];
    const benchmarkData = [95, 96, 99, 100];

    if (charts.line) charts.line.destroy();

    charts.line = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Mi portfolio',
                    data: portfolioData,
                    borderColor: '#378ADD',
                    backgroundColor: 'rgba(55, 138, 221, 0.05)',
                    borderWidth: 2,
                    pointRadius: 4,
                    pointBackgroundColor: '#378ADD',
                    tension: 0.3
                },
                {
                    label: 'Benchmark',
                    data: benchmarkData,
                    borderColor: '#1D9E75',
                    borderDash: [5, 5],
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    pointRadius: 4,
                    pointBackgroundColor: '#1D9E75',
                    tension: 0.3
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    beginAtZero: false,
                    grid: { color: 'var(--border)' },
                    ticks: { color: 'var(--text2)' }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: 'var(--text2)' }
                }
            }
        }
    });
}

// ─── RENDER ──────────────────────────────────────────────────
function renderAll() {
    let totalPortfolioUSD = 0;
    const tbody = el('posTable');
    if (!tbody) return;

    const processed = positions.map(pos => {
        const info = priceCache[pos.ticker] || { price: 0, change: 0 };
        const holdings = pos.holdings || [];
        
        // 1. Cantidad Total
        const totalQty = holdings.reduce((s, h) => s + h.qty, 0);
        
        // 2. Costo Total Invertido (Normalizado a USD)
        const totalCostUSD = holdings.reduce((s, h) => {
            const tcAlMomento = h.tc || mepRate || 1;
            const priceInUSD = pos.type === 'ar' ? (h.price / tcAlMomento) : h.price;
            return s + (priceInUSD * h.qty);
        }, 0);

        // 3. Precio Promedio de Compra (PPC) en su moneda original
        const ppcOriginal = holdings.length > 0 
            ? holdings.reduce((s, h) => s + (h.price * h.qty), 0) / totalQty 
            : 0;

        // 4. Valor Actual en USD
        const currentValUSD = pos.type === 'ar' 
            ? (info.price * totalQty / (mepRate || 1)) 
            : (info.price * totalQty);

        const pnlUSD = currentValUSD - totalCostUSD;
        const per = totalCostUSD > 0 ? (pnlUSD / totalCostUSD) * 100 : 0;

        totalPortfolioUSD += currentValUSD;

        return { 
            pos, info, qty: totalQty, 
            valUSD: currentValUSD, 
            costUSD: totalCostUSD, 
            pnlUSD, per, ppcOriginal 
        };
    });

    el('totalVal').innerText = fmt.usd(totalPortfolioUSD);
    updateTopMetrics(processed, totalPortfolioUSD);

    // Renderizar pie chart
    if (processed.length > 0) {
        renderPieChart(processed, totalPortfolioUSD);
        renderLineChart();
    } else {
        const pieCtx = el('pieChart');
        if (pieCtx && charts.pie) {
            charts.pie.destroy();
            charts.pie = null;
        }
        const lineCtx = el('lineChart');
        if (lineCtx && charts.line) {
            charts.line.destroy();
            charts.line = null;
        }
    }

    if (processed.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="empty-row">Agregá tu primera posición arriba ↑</td></tr>';
        return;
    }

    tbody.innerHTML = processed.map((item, i) => {
        const { pos, info, qty, valUSD, pnlUSD, per, ppcOriginal } = item;
        const weight = totalPortfolioUSD > 0 ? (valUSD / totalPortfolioUSD) * 100 : 0;
        
        // Días de tenencia (del primer lote)
        const firstDate = new Date(pos.holdings[0]?.date || new Date());
        const tenencia = Math.ceil(Math.abs(new Date() - firstDate) / (1000*60*60*24));

        return `
            <tr>
                <td><strong>${pos.ticker}</strong></td>
                <td>${pos.type === 'ar' ? fmt.ars(info.price) : fmt.usd(info.price)}</td>
                <td class="${colorClass(info.change)}">${fmt.pct(info.change)}</td>
                <td>${qty.toFixed(2)}</td>
                <td>${pos.type === 'ar' ? fmt.ars(ppcOriginal) : fmt.usd(ppcOriginal)}</td>
                <td>${tenencia} d</td>
                <td>${weight.toFixed(1)}%</td>
                <td class="${colorClass(pnlUSD)}">${fmt.usd(pnlUSD)}</td>
                <td class="${colorClass(per)}">${fmt.pct(per)}</td>
                <td><button class="del-btn" onclick="deletePos(${i})">✕</button></td>
            </tr>
        `;
    }).join('');
}

// ─── ACCIONES & API ──────────────────────────────────────────
async function getPrice(ticker, type) {
    try {
        if (type === 'crypto') {
            const map = { BTC:'bitcoin', ETH:'ethereum', SOL:'solana', USDT:'tether', XRP:'ripple' };
            const id = map[ticker] || ticker.toLowerCase();
            const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true`);
            const data = await res.json();
            const priceData = data[id];
            return { price: priceData.usd, change: priceData.usd_24h_change };
        } else {
            // Para acciones, usar alternative CORS endpoints
            const symbol = type === 'ar' ? `${ticker}.BA` : ticker;
            try {
                // Intenta con API alternativa
                const res = await fetch(`https://api.example.com/price/${symbol}`, {
                    mode: 'cors',
                    headers: { 'Accept': 'application/json' }
                }).catch(() => null);
                
                if (res) {
                    const data = await res.json();
                    return { price: data.price || 0, change: data.change || 0 };
                }
            } catch (e) {}
            
            // Fallback: valores por defecto (en producción usar API CORS-enabled)
            return { price: 0, change: 0 };
        }
    } catch (e) { 
        console.error(`Error fetching ${ticker}:`, e);
        return { price: 0, change: 0 }; 
    }
}

async function handleAdd(e) {
    if(e) e.preventDefault();
    const ticker = el('tickerInput').value.trim().toUpperCase();
    const qty = parseFloat(el('qtyInput').value);
    const ppc = parseFloat(el('avgInput').value);
    const days = parseInt(el('daysInput').value) || 0;

    if (!ticker || isNaN(qty) || isNaN(ppc)) return;

    const buyDate = new Date();
    buyDate.setDate(buyDate.getDate() - days);

    const holding = { qty, price: ppc, date: buyDate.toISOString(), tc: mepRate };
    const existing = positions.find(p => p.ticker === ticker);

    if (existing) {
        if (!existing.holdings) existing.holdings = [];
        existing.holdings.push(holding);
    } else {
        positions.push({ ticker, type: activeType, holdings: [holding] });
    }

    lsSet(LS_POSITIONS, positions);
    ['tickerInput', 'qtyInput', 'avgInput', 'daysInput'].forEach(id => el(id).value = '');
    
    priceCache[ticker] = await getPrice(ticker, activeType);
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
    
    try {
        const res = await fetch('https://dolarapi.com/v1/dolares/bolsa');
        const mep = await res.json();
        mepRate = parseFloat(mep.venta);
        if (el('sourceRow')) el('sourceRow').innerText = `Dólar MEP: $${mepRate.toFixed(2)}`;
    } catch(e) { 
        console.error("Error fetching MEP:", e);
        mepRate = 1200; // Valor por defecto
    }

    if (positions.length > 0) {
        const results = await Promise.all(positions.map(p => getPrice(p.ticker, p.type)));
        positions.forEach((p, i) => priceCache[p.ticker] = results[i]);
    }
    
    renderAll();
    
    // Event listeners para botones de tipo
    document.querySelectorAll('.type-btn').forEach(btn => {
        btn.onclick = (e) => {
            document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            activeType = e.target.dataset.type;
        };
    });
    
    // Event listeners para botones de rango
    document.querySelectorAll('.range-btn').forEach(btn => {
        btn.onclick = (e) => {
            document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            selectedRange = e.target.dataset.range;
            renderLineChart();
        };
    });
    
    // Event listener para agregar posición
    el('addBtn').onclick = handleAdd;
}

document.addEventListener('DOMContentLoaded', init);