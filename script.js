'use strict';

const PROXY = '/api/proxy';
const LS_POSITIONS = 'portfolio_positions_v2';
let positions = []; 
let priceCache = {};
let mepRate = null;
let activeType = 'ar';
let charts = { pie: null };

const el = (id) => document.getElementById(id);
const lsGet = (key) => JSON.parse(localStorage.getItem(key));
const lsSet = (key, val) => localStorage.setItem(key, JSON.stringify(val));

const fmt = {
    usd: v => '$' + Math.abs(v).toLocaleString('en-US', {minimumFractionDigits:2}),
    ars: v => '$' + Math.abs(v).toLocaleString('es-AR', {minimumFractionDigits:2}),
    pct: v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + '%',
};

const colorClass = (v) => v >= 0 ? 'pos' : 'neg';

// ─── MÉTRICAS SUPERIORES ──────────────────────────────────────
function updateTopMetrics(processed, totalVal) {
    let totalGainUSD = 0;
    let totalCostUSD = 0;
    let bestToday = { ticker: '—', change: -Infinity };

    processed.forEach(item => {
        totalGainUSD += item.pnlUSD;
        totalCostUSD += item.costUSD;
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
}

// ─── RENDERIZADO DE TABLA ─────────────────────────────────────
function renderAll() {
    let totalPortfolioUSD = 0;
    const tbody = el('posTable');
    if (!tbody) return;

    const processed = positions.map(pos => {
        const info = priceCache[pos.ticker] || { price: 0, change: 0 };
        const holdings = pos.holdings || [];
        const totalQty = holdings.reduce((s, h) => s + h.qty, 0);
        
        // Calcular PPC y Costo en USD
        // Si es AR, usamos el TC de compra guardado para no arrastrar inflación/devaluación al PPC
        const totalCostUSD = holdings.reduce((s, h) => {
            const costInUSD = pos.type === 'ar' ? (h.price / (h.tc || mepRate || 1)) : h.price;
            return s + (costInUSD * h.qty);
        }, 0);

        const currentValUSD = pos.type === 'ar' 
            ? (info.price * totalQty / (mepRate || 1)) 
            : (info.price * totalQty);

        const pnlUSD = currentValUSD - totalCostUSD;
        const per = totalCostUSD > 0 ? (pnlUSD / totalCostUSD) * 100 : 0;
        const ppcOriginal = holdings.length > 0 ? holdings.reduce((s, h) => s + (h.price * h.qty), 0) / totalQty : 0;

        totalPortfolioUSD += currentValUSD;

        return { pos, info, qty: totalQty, valUSD: currentValUSD, costUSD: totalCostUSD, pnlUSD, per, ppcOriginal };
    });

    el('totalVal').innerText = fmt.usd(totalPortfolioUSD);
    updateTopMetrics(processed, totalPortfolioUSD);
    renderPieChart(processed); // Siguiente item preparado

    if (processed.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="empty-row">Agregá tu primera posición arriba ↑</td></tr>';
        return;
    }

    tbody.innerHTML = processed.map((item, i) => {
        const { pos, info, qty, valUSD, pnlUSD, per, ppcOriginal } = item;
        const weight = totalPortfolioUSD > 0 ? (valUSD / totalPortfolioUSD) * 100 : 0;
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

// ─── GRÁFICO DE TORTA ─────────────────────────────────────────
function renderPieChart(processed) {
    const ctx = el('pieChart')?.getContext('2d');
    if (!ctx || processed.length === 0) return;

    if (charts.pie) charts.pie.destroy();
    
    charts.pie = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: processed.map(p => p.pos.ticker),
            datasets: [{
                data: processed.map(p => p.valUSD),
                backgroundColor: ['#378ADD', '#1D9E75', '#E8A838', '#E05C5C', '#8B5CF6'],
                borderWidth: 0
            }]
        },
        options: {
            plugins: { legend: { display: false } },
            maintainAspectRatio: false,
            cutout: '75%'
        }
    });
}

// ─── ACCIONES E INIT (Simplificado) ───────────────────────────
async function getPrice(ticker, type) {
    try {
        const symbol = type === 'ar' ? `${ticker}.BA` : ticker;
        const url = type === 'crypto' 
            ? `https://api.coingecko.com/api/v3/simple/price?ids=${ticker.toLowerCase()}&vs_currencies=usd&include_24hr_change=true`
            : `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=2d`;
        
        const res = await fetch(`${PROXY}?url=${encodeURIComponent(url)}`);
        const data = await res.json();
        
        if (type === 'crypto') {
            const id = ticker.toLowerCase();
            return { price: data[id].usd, change: data[id].usd_24h_change };
        }
        const meta = data.chart.result[0].meta;
        return { price: meta.regularMarketPrice, change: ((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose) * 100 };
    } catch (e) { return { price: 0, change: 0 }; }
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
        existing.holdings.push(holding);
    } else {
        positions.push({ ticker, type: activeType, holdings: [holding] });
    }

    lsSet(LS_POSITIONS, positions);
    priceCache[ticker] = await getPrice(ticker, activeType);
    renderAll();
}

window.deletePos = (i) => {
    positions.splice(i, 1);
    lsSet(LS_POSITIONS, positions);
    renderAll();
};

async function init() {
    positions = lsGet(LS_POSITIONS) || [];
    const mep = await fetch(`${PROXY}?url=${encodeURIComponent('https://dolarapi.com/v1/dolares/bolsa')}`).then(r => r.json());
    mepRate = parseFloat(mep.venta);
    
    if (positions.length > 0) {
        const results = await Promise.all(positions.map(p => getPrice(p.ticker, p.type)));
        positions.forEach((p, i) => priceCache[p.ticker] = results[i]);
    }
    renderAll();
    el('addBtn').onclick = handleAdd;
}

document.addEventListener('DOMContentLoaded', init);