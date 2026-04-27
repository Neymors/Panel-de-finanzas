'use strict';

const PROXY = '/api/proxy';
const LS_POSITIONS = 'portfolio_positions_v2';
let positions = []; 
let priceCache = {};
let mepRate = null;
let activeType = 'ar';

const el = (id) => document.getElementById(id);
const lsGet = (key) => JSON.parse(localStorage.getItem(key));
const lsSet = (key, val) => localStorage.setItem(key, JSON.stringify(val));

const fmt = {
    usd: v => '$' + v.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2}),
    ars: v => '$' + v.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2}),
    pct: v => (v >= 0 ? '+' : '') + v.toFixed(2) + '%',
};

const colorClass = (v) => v > 0 ? 'pos' : (v < 0 ? 'neg' : '');

// ─── LÓGICA DE MÉTRICAS SUPERIORES ────────────────────────────
function updateTopMetrics(processed, totalVal) {
    // 1. Cantidad de posiciones
    if (el('activeCount')) el('activeCount').innerText = processed.length;

    // 2. Ganancia Total y Mejor Hoy
    let totalGain = 0;
    let bestToday = { ticker: '—', change: -Infinity };

    processed.forEach(item => {
        totalGain += item.pnl;
        if (item.info.change > bestToday.change) {
            bestToday = { ticker: item.pos.ticker, change: item.info.change };
        }
    });

    if (el('totalGain')) el('totalGain').innerText = fmt.usd(totalGain);
    if (el('totalGainPct')) el('totalGainPct').innerText = processed.length ? fmt.pct((totalGain / (totalVal - totalGain)) * 100) : '0.00%';
    
    if (el('bestTodayTicker')) el('bestTodayTicker').innerText = bestToday.ticker;
    if (el('bestTodayPct')) {
        el('bestTodayPct').innerText = bestToday.change !== -Infinity ? fmt.pct(bestToday.change) : '—';
        el('bestTodayPct').className = 'metric-val ' + colorClass(bestToday.change);
    }
}

// ─── CORE RENDER ──────────────────────────────────────────────
function renderAll() {
    let totalPortfolioUSD = 0;
    const tbody = el('posTable');
    
    const processed = positions.map(pos => {
        const info = priceCache[pos.ticker] || { price: 0, change: 0 };
        const holdings = pos.holdings || [];
        const qty = holdings.reduce((s, h) => s + h.qty, 0);
        const valUSD = pos.type === 'ar' ? (info.price * qty / (mepRate || 1)) : (info.price * qty);
        
        const totalCostUSD = holdings.reduce((s, h) => {
            const cost = pos.type === 'ar' ? (h.price / (h.tc || mepRate || 1)) : h.price;
            return s + (cost * h.qty);
        }, 0);

        totalPortfolioUSD += valUSD;
        return { pos, info, qty, valUSD, holdings, pnl: valUSD - totalCostUSD, cost: totalCostUSD };
    });

    el('totalVal').innerText = fmt.usd(totalPortfolioUSD);
    
    // Actualizamos las tarjetitas de arriba
    updateTopMetrics(processed, totalPortfolioUSD);

    if (!processed.length) {
        tbody.innerHTML = '<tr><td colspan="10" class="empty-row">No hay posiciones</td></tr>';
        return;
    }

    tbody.innerHTML = processed.map((item, i) => {
        const { pos, info, qty, valUSD, holdings, pnl, cost } = item;
        const ppc = holdings.reduce((s, h) => s + (h.price * h.qty), 0) / qty;
        const performance = cost > 0 ? (pnl / cost) * 100 : 0;
        const weight = totalPortfolioUSD > 0 ? (valUSD / totalPortfolioUSD) * 100 : 0;

        return `
            <tr>
                <td><strong>${pos.ticker}</strong></td>
                <td>${pos.type === 'ar' ? fmt.ars(info.price) : fmt.usd(info.price)}</td>
                <td class="${colorClass(info.change)}">${fmt.pct(info.change)}</td>
                <td>${qty.toFixed(2)}</td>
                <td>${pos.type === 'ar' ? fmt.ars(ppc) : fmt.usd(ppc)}</td>
                <td>${Math.ceil(Math.abs(new Date() - new Date(holdings[0].date)) / (1000*60*60*24))} d</td>
                <td>${weight.toFixed(1)}%</td>
                <td class="${colorClass(pnl)}">${fmt.usd(pnl)}</td>
                <td class="${colorClass(performance)}">${fmt.pct(performance)}</td>
                <td><button class="del-btn" onclick="deletePos(${i})">✕</button></td>
            </tr>
        `;
    }).join('');
}

// ─── AGREGAR POSICIÓN ─────────────────────────────────────────
async function handleAdd(e) {
    if(e) e.preventDefault();
    const ticker = el('tickerInput').value.trim().toUpperCase();
    const qty = parseFloat(el('qtyInput').value);
    const ppc = parseFloat(el('avgInput').value);
    const days = parseInt(el('daysInput').value) || 0;

    if (!ticker || isNaN(qty) || isNaN(ppc)) return;

    const purchaseDate = new Date();
    purchaseDate.setDate(purchaseDate.getDate() - days);

    const newHolding = { qty, price: ppc, date: purchaseDate.toISOString(), tc: mepRate };
    const existing = positions.find(p => p.ticker === ticker);

    if (existing) {
        if (!existing.holdings) existing.holdings = [];
        existing.holdings.push(newHolding);
    } else {
        positions.push({ ticker, type: activeType, holdings: [newHolding] });
    }

    lsSet(LS_POSITIONS, positions);
    const freshPrice = await getPrice(ticker, activeType);
    priceCache[ticker] = freshPrice;
    
    ['tickerInput', 'qtyInput', 'avgInput', 'daysInput'].forEach(id => el(id).value = '');
    renderAll();
}

// (Las funciones getPrice, fetchViaProxy, deletePos e init se mantienen igual que la anterior)

window.deletePos = (i) => {
    positions.splice(i, 1);
    lsSet(LS_POSITIONS, positions);
    renderAll();
};

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

async function fetchViaProxy(url) {
    try {
        const res = await fetch(`${PROXY}?url=${encodeURIComponent(url)}`);
        return await res.json();
    } catch (e) { return null; }
}

async function init() {
    positions = lsGet(LS_POSITIONS) || [];
    const mepData = await fetchViaProxy('https://dolarapi.com/v1/dolares/bolsa');
    if (mepData) mepRate = parseFloat(mepData.venta);
    
    if (positions.length > 0) {
        const results = await Promise.all(positions.map(p => getPrice(p.ticker, p.type)));
        positions.forEach((p, i) => priceCache[p.ticker] = results[i]);
    }
    renderAll();

    el('addBtn').onclick = handleAdd;
    document.querySelectorAll('.type-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeType = btn.dataset.type;
        };
    });
}

document.addEventListener('DOMContentLoaded', init);