'use strict';

// ─── CONSTANTES Y ESTADO ─────────────────────────────────────
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
    usd: v => '$' + Math.abs(v).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2}),
    ars: v => '$' + Math.abs(v).toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2}),
    pct: v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + '%',
};

const colorClass = (v) => v >= 0 ? 'pos' : 'neg';

// ─── UTILS DE CÁLCULO ────────────────────────────────────────
function calculateDPT(holdings) {
    if (!holdings || holdings.length === 0) return 0;
    const now = new Date();
    let totalQty = 0;
    let weightedDays = 0;
    holdings.forEach(h => {
        const diffTime = Math.abs(now - new Date(h.date));
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        weightedDays += (diffDays * h.qty);
        totalQty += h.qty;
    });
    return totalQty > 0 ? Math.round(weightedDays / totalQty) : 0;
}

// ─── FETCHING ────────────────────────────────────────────────
async function fetchViaProxy(url) {
    const res = await fetch(`${PROXY}?url=${encodeURIComponent(url)}`);
    return await res.json();
}

async function getPrice(ticker, type) {
    try {
        let url;
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

// ─── CORE ────────────────────────────────────────────────────
async function init() {
    positions = lsGet(LS_POSITIONS) || [];
    
    // Cargar Dólar MEP
    const mepData = await fetchViaProxy('https://dolarapi.com/v1/dolares/bolsa');
    mepRate = parseFloat(mepData.venta);
    el('sourceRow').innerText = `Dólar MEP: $${mepRate.toFixed(2)}`;

    // Cargar Precios
    if (positions.length > 0) {
        const results = await Promise.all(positions.map(p => getPrice(p.ticker, p.type)));
        positions.forEach((p, i) => priceCache[p.ticker] = results[i]);
    }

    renderAll();
}

function renderAll() {
    let totalPortfolioUSD = 0;
    const tbody = el('posTable');
    
    // Calcular Valor Total primero para el % de cartera
    const processed = positions.map(pos => {
        const info = priceCache[pos.ticker] || { price: 0, change: 0 };
        const qty = pos.holdings.reduce((s, h) => s + h.qty, 0);
        const valUSD = pos.type === 'ar' ? (info.price * qty / mepRate) : (info.price * qty);
        totalPortfolioUSD += valUSD;
        return { pos, info, qty, valUSD };
    });

    el('totalVal').innerText = fmt.usd(totalPortfolioUSD);

    if (processed.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="empty-row">No hay posiciones</td></tr>';
        return;
    }

    tbody.innerHTML = processed.map((item, i) => {
        const { pos, info, qty, valUSD } = item;
        const ppc = pos.holdings.reduce((s, h) => s + (h.price * h.qty), 0) / qty;
        const tenencia = calculateDPT(pos.holdings);
        const weight = totalPortfolioUSD > 0 ? (valUSD / totalPortfolioUSD) * 100 : 0;
        
        // P&L en USD
        const totalCostUSD = pos.holdings.reduce((s, h) => {
            const cost = pos.type === 'ar' ? (h.price / (h.tc || mepRate)) : h.price;
            return s + (cost * h.qty);
        }, 0);
        const pnl = valUSD - totalCostUSD;
        const per = totalCostUSD > 0 ? (pnl / totalCostUSD) * 100 : 0;

        return `
            <tr>
                <td><strong>${pos.ticker}</strong></td>
                <td>${pos.type === 'ar' ? fmt.ars(info.price) : fmt.usd(info.price)}</td>
                <td class="${colorClass(info.change)}">${fmt.pct(info.change)}</td>
                <td>${qty.toFixed(2)}</td>
                <td>${pos.type === 'ar' ? fmt.ars(ppc) : fmt.usd(ppc)}</td>
                <td>${tenencia} días</td>
                <td>${weight.toFixed(1)}%</td>
                <td class="${colorClass(pnl)}">${fmt.usd(pnl)}</td>
                <td class="${colorClass(per)}">${fmt.pct(per)}</td>
                <td><button class="del-btn" onclick="deletePos(${i})">✕</button></td>
            </tr>
        `;
    }).join('');
}

// ─── EVENTOS ─────────────────────────────────────────────────
el('addBtn').onclick = async () => {
    const ticker = el('tickerInput').value.toUpperCase();
    const qty = parseFloat(el('qtyInput').value);
    const ppc = parseFloat(el('avgInput').value);
    const days = parseInt(el('daysInput').value) || 0;

    if (!ticker || isNaN(qty)) return;

    const purchaseDate = new Date();
    purchaseDate.setDate(purchaseDate.getDate() - days);

    const holding = { qty, price: ppc, date: purchaseDate.toISOString(), tc: mepRate };
    const existing = positions.find(p => p.ticker === ticker);

    if (existing) {
        existing.holdings.push(holding);
    } else {
        positions.push({
            ticker, type: activeType,
            currency: activeType === 'ar' ? 'ARS' : 'USD',
            holdings: [holding]
        });
    }

    lsSet(LS_POSITIONS, positions);
    location.reload(); 
};

window.deletePos = (i) => {
    positions.splice(i, 1);
    lsSet(LS_POSITIONS, positions);
    renderAll();
};

document.querySelectorAll('.type-btn').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeType = btn.dataset.type;
    };
});

init();