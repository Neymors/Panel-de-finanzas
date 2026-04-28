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
    usd: v => '$' + Math.abs(v).toLocaleString('en-US', {minimumFractionDigits:2}),
    ars: v => '$' + Math.abs(v).toLocaleString('es-AR', {minimumFractionDigits:2}),
    pct: v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + '%',
};

const colorClass = (v) => v >= 0 ? 'pos' : 'neg';

/* ───────── RELOJES ───────── */
function updateClocks() {
    const opt = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
    el('clockAR').innerText = 'BA ' + new Date().toLocaleTimeString('es-AR', { ...opt, timeZone: 'America/Argentina/Buenos_Aires' });
    el('clockNY').innerText = 'NY ' + new Date().toLocaleTimeString('en-US', { ...opt, timeZone: 'America/New_York' });
}
setInterval(updateClocks, 1000);

/* ───────── HELPERS ───────── */
const isBond = (ticker) => /^[A-Z]{2}\d{2}$/.test(ticker);

/* ───────── MÉTRICAS ───────── */
function updateTopMetrics(processed, totalVal) {
    let totalGainUSD = 0;
    let totalCostUSD = 0;
    let bestToday = { ticker: '—', change: -Infinity };
    let todayChangeWeighted = 0;

    processed.forEach(item => {
        totalGainUSD += item.pnlUSD;
        totalCostUSD += item.costUSD;

        if (item.info.change > bestToday.change) {
            bestToday = { ticker: item.pos.ticker, change: item.info.change };
        }

        const weight = totalVal > 0 ? item.valUSD / totalVal : 0;
        todayChangeWeighted += weight * item.info.change;
    });

    el('totalGain').innerText = fmt.usd(totalGainUSD);
    el('totalGainPct').innerText = totalCostUSD > 0 ? fmt.pct((totalGainUSD / totalCostUSD) * 100) : '0.00%';
    el('posCount').innerText = processed.length;

    el('bestTicker').innerText = bestToday.ticker;
    el('bestPct').innerText = fmt.pct(bestToday.change);
    el('bestPct').className = 'metric-sub ' + colorClass(bestToday.change);

    el('todayPct').innerText = fmt.pct(todayChangeWeighted);
    el('todayPct').className = 'metric-val ' + colorClass(todayChangeWeighted);

    const todayAbsUSD = totalVal * (todayChangeWeighted / 100);
    el('todayAbs').innerText = fmt.usd(todayAbsUSD);
    el('todayAbs').className = 'metric-sub ' + colorClass(todayAbsUSD);
}

/* ───────── CHARTS ───────── */
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
                backgroundColor: ['#378ADD','#1D9E75','#E8A838','#E05C5C','#8B5CF6']
            }]
        },
        options: { plugins: { legend: { display: false } }, cutout: '70%' }
    });
}

function renderLineChart(processed) {
    const ctx = el('lineChart')?.getContext('2d');
    if (!ctx) return;

    if (charts.line) charts.line.destroy();

    const labels = Array.from({length: 20}, (_, i) => i);

    let base = 100;
    const portfolioData = labels.map(() => {
        const avg = processed.reduce((a, p) => a + p.info.change, 0) / processed.length || 0;
        base *= (1 + avg / 100);
        return base;
    });

    charts.line = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{ data: portfolioData, borderColor: '#378ADD', tension: 0.3 }]
        },
        options: { plugins: { legend: { display: false } } }
    });
}

/* ───────── RENDER ───────── */
function renderAll() {
    let totalPortfolioUSD = 0;
    const tbody = el('posTable');

    const processed = positions.map(pos => {
        const info = priceCache[pos.ticker] || { price: 0, change: 0 };
        const holdings = pos.holdings || [];

        const totalQty = holdings.reduce((s, h) => s + h.qty, 0);

        const totalCostUSD = holdings.reduce((s, h) => {
            const tc = h.tc || mepRate || 1;
            const priceUSD = pos.type === 'ar' ? (h.price / tc) : h.price;
            return s + priceUSD * h.qty;
        }, 0);

        const currentValUSD = pos.type === 'ar'
            ? (info.price * totalQty / (mepRate || 1))
            : (info.price * totalQty);

        const pnlUSD = currentValUSD - totalCostUSD;
        const per = totalCostUSD > 0 ? (pnlUSD / totalCostUSD) * 100 : 0;

        const ppcOriginal = holdings.reduce((s, h) => s + h.price * h.qty, 0) / totalQty;

        totalPortfolioUSD += currentValUSD;

        return { pos, info, qty: totalQty, valUSD: currentValUSD, costUSD: totalCostUSD, pnlUSD, per, ppcOriginal };
    });

    el('totalVal').innerText = fmt.usd(totalPortfolioUSD);

    updateTopMetrics(processed, totalPortfolioUSD);
    renderPieChart(processed);
    renderLineChart(processed);

    tbody.innerHTML = processed.map((item, i) => {
        const { pos, info, qty, valUSD, pnlUSD, per, ppcOriginal } = item;

        const firstDate = new Date(Math.min(...pos.holdings.map(h => new Date(h.date))));
        const tenencia = Math.ceil((Date.now() - firstDate) / (1000*60*60*24));

        return `
        <tr>
            <td><strong>${pos.ticker}</strong></td>
            <td>${pos.type === 'ar' ? fmt.ars(info.price) : fmt.usd(info.price)}</td>
            <td class="${colorClass(info.change)}">${fmt.pct(info.change)}</td>
            <td>${qty.toFixed(2)}</td>
            <td>${pos.type === 'ar' ? fmt.ars(ppcOriginal) : fmt.usd(ppcOriginal)}</td>
            <td>${tenencia} d</td>
            <td>${((valUSD/totalPortfolioUSD)*100).toFixed(1)}%</td>
            <td class="${colorClass(pnlUSD)}">${fmt.usd(pnlUSD)}</td>
            <td class="${colorClass(per)}">${fmt.pct(per)}</td>
            <td><button onclick="deletePos(${i})">✕</button></td>
        </tr>`;
    }).join('');
}

/* ───────── API (RAVA FIX) ───────── */
async function getPrice(ticker, type) {
    try {
        if (type === 'crypto') {
            const id = ticker.toLowerCase();
            const url = `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true`;
            const data = await fetch(`${PROXY}?url=${encodeURIComponent(url)}`).then(r => r.json());
            return { price: data[id]?.usd || 0, change: data[id]?.usd_24h_change || 0 };
        }

        if (type === 'ar') {
            try {
                const url = `https://www.rava.com/empresas/precioshistoricos.php?e=${ticker}`;
                const text = await fetch(`${PROXY}?url=${encodeURIComponent(url)}`).then(r => r.text());

                const priceMatch = text.match(/"cierre":"([\d.,]+)"/);
                const changeMatch = text.match(/"variacion":"([\d.,-]+)"/);

                if (priceMatch) {
                    let price = parseFloat(priceMatch[1].replace(',', '.'));

                    if (isBond(ticker)) {
                        price = price / 100; // 🔥 clave bonos
                    }

                    return {
                        price,
                        change: parseFloat(changeMatch?.[1]?.replace(',', '.') || 0)
                    };
                }
            } catch {}
        }

        // fallback yahoo
        const symbol = type === 'ar' ? `${ticker}.BA` : ticker;
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=2d`;
        const data = await fetch(`${PROXY}?url=${encodeURIComponent(url)}`).then(r => r.json());

        const meta = data.chart.result[0].meta;

        return {
            price: meta.regularMarketPrice,
            change: ((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose) * 100
        };

    } catch {
        return { price: 0, change: 0 };
    }
}

/* ───────── ADD ───────── */
async function handleAdd(e) {
    if(e) e.preventDefault();

    const ticker = el('tickerInput').value.trim().toUpperCase();
    const qty = parseFloat(el('qtyInput').value);
    const ppc = parseFloat(el('avgInput').value);

    if (!ticker || isNaN(qty) || isNaN(ppc)) return;

    const holding = { qty, price: ppc, date: new Date().toISOString(), tc: mepRate };

    const existing = positions.find(p => p.ticker === ticker);
    if (existing) existing.holdings.push(holding);
    else positions.push({ ticker, type: activeType, holdings: [holding] });

    lsSet(LS_POSITIONS, positions);
    priceCache[ticker] = await getPrice(ticker, activeType);

    renderAll();
}

/* ───────── INIT ───────── */
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

    document.querySelectorAll('.type-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeType = btn.dataset.type;
        };
    });
}

window.deletePos = (i) => {
    positions.splice(i, 1);
    lsSet(LS_POSITIONS, positions);
    renderAll();
};

document.addEventListener('DOMContentLoaded', init);