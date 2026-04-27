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

// ─── FETCHING CON ERROR HANDLING ─────────────────────────────
async function fetchViaProxy(url) {
    try {
        const res = await fetch(`${PROXY}?url=${encodeURIComponent(url)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } catch (e) {
        console.warn(`Error fetching ${url}:`, e);
        return null;
    }
}

async function getPrice(ticker, type) {
    try {
        if (type === 'crypto') {
            const map = { BTC:'bitcoin', ETH:'ethereum', SOL:'solana', USDT:'tether' };
            const id = map[ticker] || ticker.toLowerCase();
            const data = await fetchViaProxy(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true`);
            if (!data || !data[id]) throw new Error('No data from CoinGecko');
            return { price: data[id].usd, change: data[id].usd_24h_change || 0 };
        } else {
            const symbol = type === 'ar' ? (ticker.includes('.') ? ticker : `${ticker}.BA`) : ticker;
            const data = await fetchViaProxy(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=2d`);
            if (!data?.chart?.result?.[0]?.meta) throw new Error('No data from Yahoo Finance');
            const meta = data.chart.result[0].meta;
            return { price: meta.regularMarketPrice, change: ((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose) * 100 };
        }
    } catch (e) {
        console.error(`Error obteniendo precio para ${ticker} (${type}):`, e);
        return { price: 0, change: 0 };  // fallback seguro
    }
}

// ─── RENDER ──────────────────────────────────────────────────
function renderAll() {
    let totalPortfolioUSD = 0;
    const tbody = el('posTable');
    const errorMsgDiv = el('addError');
    
    // Validar MEP para activos argentinos
    if (!mepRate && positions.some(p => p.type === 'ar')) {
        errorMsgDiv.innerText = '⚠️ No se pudo obtener el dólar MEP. Los valores en USD pueden ser incorrectos.';
    } else {
        errorMsgDiv.innerText = '';
    }
    
    // Calcular Valor Total
    const processed = positions.map(pos => {
        const info = priceCache[pos.ticker] || { price: 0, change: 0 };
        const qty = pos.holdings.reduce((s, h) => s + h.qty, 0);
        const effectiveMep = (mepRate && mepRate > 0) ? mepRate : 1;
        const valUSD = pos.type === 'ar' ? (info.price * qty / effectiveMep) : (info.price * qty);
        totalPortfolioUSD += valUSD;
        return { pos, info, qty, valUSD };
    });

    el('totalVal').innerText = fmt.usd(totalPortfolioUSD);

    if (processed.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="empty-row">Agregá tu primera posición arriba ↑</td></tr>';
        return;
    }

    // Generar Filas
    tbody.innerHTML = processed.map((item, i) => {
        const { pos, info, qty, valUSD } = item;
        const ppc = pos.holdings.reduce((s, h) => s + (h.price * h.qty), 0) / qty;
        const tenencia = calculateDPT(pos.holdings);
        const weight = totalPortfolioUSD > 0 ? (valUSD / totalPortfolioUSD) * 100 : 0;
        
        const totalCostUSD = pos.holdings.reduce((s, h) => {
            const effectiveMep = (h.tc && h.tc > 0) ? h.tc : (mepRate || 1);
            const cost = pos.type === 'ar' ? (h.price / effectiveMep) : h.price;
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

// ─── ACTIONS ─────────────────────────────────────────────────
async function handleAdd(e) {
    if(e) e.preventDefault();
    const errorDiv = el('addError');
    errorDiv.innerText = '';

    const ticker = el('tickerInput').value.trim().toUpperCase();
    const qty = parseFloat(el('qtyInput').value);
    const ppc = parseFloat(el('avgInput').value);
    let days = parseInt(el('daysInput').value);
    if (isNaN(days)) days = 0;

    if (!ticker) {
        errorDiv.innerText = '❌ Ingresá un símbolo de activo.';
        return;
    }
    if (isNaN(qty) || qty <= 0) {
        errorDiv.innerText = '❌ Cantidad inválida.';
        return;
    }
    if (isNaN(ppc) || ppc <= 0) {
        errorDiv.innerText = '❌ Precio promedio inválido.';
        return;
    }

    // Si el activo ya existe, verificar que sea del mismo tipo
    const existingPos = positions.find(p => p.ticker === ticker);
    if (existingPos && existingPos.type !== activeType) {
        errorDiv.innerText = `❌ Ya tenés ${ticker} como ${existingPos.type === 'ar' ? 'Argentina' : existingPos.type === 'global' ? 'Global' : 'Cripto'}. Usá el mismo tipo o eliminá la posición anterior.`;
        return;
    }

    const purchaseDate = new Date();
    purchaseDate.setDate(purchaseDate.getDate() - days);

    const holding = { 
        qty, 
        price: ppc, 
        date: purchaseDate.toISOString(), 
        tc: mepRate   // guardamos el MEP al momento de la compra
    };

    if (existingPos) {
        existingPos.holdings.push(holding);
    } else {
        positions.push({
            ticker, 
            type: activeType,
            currency: activeType === 'ar' ? 'ARS' : 'USD',
            holdings: [holding]
        });
    }

    lsSet(LS_POSITIONS, positions);
    
    // Limpiar inputs
    el('tickerInput').value = '';
    el('qtyInput').value = '';
    el('avgInput').value = '';
    el('daysInput').value = '';

    // Intentar obtener precio actual (pero no bloquear si falla)
    try {
        const newPrice = await getPrice(ticker, activeType);
        priceCache[ticker] = newPrice;
    } catch (err) {
        console.warn(`No se pudo obtener precio actual para ${ticker}`, err);
        priceCache[ticker] = { price: 0, change: 0 };
        errorDiv.innerText = `⚠️ Activo agregado, pero no se pudo obtener precio actual (mostrará 0).`;
    }
    
    renderAll();
}

window.deletePos = (i) => {
    positions.splice(i, 1);
    lsSet(LS_POSITIONS, positions);
    // Limpiar cache si ya no existe
    const remainingTickers = new Set(positions.map(p => p.ticker));
    Object.keys(priceCache).forEach(t => {
        if (!remainingTickers.has(t)) delete priceCache[t];
    });
    renderAll();
};

// ─── INIT ─────────────────────────────────────────────────────
async function init() {
    positions = lsGet(LS_POSITIONS) || [];
    
    // Cargar MEP (pero no crítico)
    try {
        const mepData = await fetchViaProxy('https://dolarapi.com/v1/dolares/bolsa');
        if (mepData && mepData.venta) {
            mepRate = parseFloat(mepData.venta);
        } else {
            console.warn('No se pudo obtener MEP');
            mepRate = null;
        }
    } catch(e) {
        console.warn('Error obteniendo MEP', e);
        mepRate = null;
    }
    
    if (el('sourceRow')) {
        el('sourceRow').innerText = mepRate ? `Dólar MEP: $${mepRate.toFixed(2)}` : '⚠️ Sin dato de MEP';
    }

    // Cargar precios iniciales
    if (positions.length > 0) {
        const fetchPromises = positions.map(p => getPrice(p.ticker, p.type));
        const results = await Promise.allSettled(fetchPromises);
        results.forEach((result, idx) => {
            const ticker = positions[idx].ticker;
            if (result.status === 'fulfilled') {
                priceCache[ticker] = result.value;
            } else {
                console.warn(`Fallo al cargar precio inicial para ${ticker}`);
                priceCache[ticker] = { price: 0, change: 0 };
            }
        });
    }

    renderAll();

    // Event Listeners
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