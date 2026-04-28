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
        let url;
        if (type === 'crypto') {
            const map = { BTC:'bitcoin', ETH:'ethereum', SOL:'solana', USDT:'tether' };
            const id = map[ticker] || ticker.toLowerCase();
            url = `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true`;
        } else {
            const symbol = type === 'ar' ? `${ticker}.BA` : ticker;
            url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=2d`;
        }
        const res = await fetch(`${PROXY}?url=${encodeURIComponent(url)}`);
        const data = await res.json();
        
        if (type === 'crypto') {
            const id = Object.keys(data)[0];
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
        const mep = await fetch(`${PROXY}?url=${encodeURIComponent('https://dolarapi.com/v1/dolares/bolsa')}`).then(r => r.json());
        mepRate = parseFloat(mep.venta);
        if (el('sourceRow')) el('sourceRow').innerText = `Dólar MEP: $${mepRate}`;
    } catch(e) { console.error("Error MEP"); }

    if (positions.length > 0) {
        const results = await Promise.all(positions.map(p => getPrice(p.ticker, p.type)));
        positions.forEach((p, i) => priceCache[p.ticker] = results[i]);
    }
    
    renderAll();
    el('addBtn').onclick = handleAdd;
}

document.addEventListener('DOMContentLoaded', init);