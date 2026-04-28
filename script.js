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
    if (el('clockAR')) el('clockAR').innerText = 'BA ' + new Date().toLocaleTimeString('es-AR', { ...opt, timeZone: 'America/Argentina/Buenos_Aires' });
    if (el('clockNY')) el('clockNY').innerText = 'NY ' + new Date().toLocaleTimeString('en-US', { ...opt, timeZone: 'America/New_York' });
}
setInterval(updateClocks, 1000);

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
    el('bestPct').innerText = bestToday.change !== -Infinity ? fmt.pct(bestToday.change) : '—';
    el('bestPct').className = 'metric-sub ' + colorClass(bestToday.change);

    // Portfolio hoy
    el('todayPct').innerText = fmt.pct(todayChangeWeighted);
    el('todayPct').className = 'metric-val ' + colorClass(todayChangeWeighted);

    const todayAbsUSD = totalVal * (todayChangeWeighted / 100);
    el('todayAbs').innerText = fmt.usd(todayAbsUSD);
    el('todayAbs').className = 'metric-sub ' + colorClass(todayAbsUSD);
}

/* ───────── PIE CHART ───────── */
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
                backgroundColor: [
                    '#378ADD','#1D9E75','#E8A838','#E05C5C',
                    '#8B5CF6','#F97316','#06B6D4','#84CC16'
                ],
                borderWidth: 0
            }]
        },
        options: {
            plugins: { legend: { display: false } },
            maintainAspectRatio: false,
            cutout: '70%'
        }
    });

    const legend = el('pieLegend');
    legend.innerHTML = processed.map((p, i) => `
        <span>
            <span class="leg-dot" style="background:${charts.pie.data.datasets[0].backgroundColor[i]}"></span>
            ${p.pos.ticker}
        </span>
    `).join('');
}

/* ───────── LINE CHART (mock) ───────── */
function renderLineChart(processed) {
    const ctx = el('lineChart')?.getContext('2d');
    if (!ctx) return;

    if (charts.line) charts.line.destroy();

    const labels = Array.from({length: 20}, (_, i) => i);

    let base = 100;
    const portfolioData = labels.map(() => {
        const avg = processed.reduce((acc, p) => acc + p.info.change, 0) / processed.length || 0;
        base *= (1 + avg / 100);
        return base;
    });

    let bench = 100;
    const benchData = labels.map(() => {
        bench *= (1 + (Math.random() * 0.5 - 0.25) / 100);
        return bench;
    });

    charts.line = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    data: portfolioData,
                    borderColor: '#378ADD',
                    tension: 0.3
                },
                {
                    data: benchData,
                    borderColor: '#1D9E75',
                    borderDash: [5,5],
                    tension: 0.3
                }
            ]
        },
        options: {
            plugins: { legend: { display: false } },
            maintainAspectRatio: false
        }
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

    if (processed.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="empty-row">Agregá tu primera posición ↑</td></tr>';
        return;
    }

    tbody.innerHTML = processed.map((item, i) => {
        const { pos, info, qty, valUSD, pnlUSD, per, ppcOriginal } = item;
        const weight = valUSD / totalPortfolioUSD * 100;

        const firstDate = new Date(
            Math.min(...pos.holdings.map(h => new Date(h.date)))
        );

        const tenencia = Math.ceil((Date.now() - firstDate) / (1000*60*60*24));

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
        </tr>`;
    }).join('');
}

/* ───────── API ───────── */
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
    const days = parseInt(el('daysInput').value) || 0;

    const errorEl = el('addError');

    if (!ticker || isNaN(qty) || isNaN(ppc) || qty <= 0 || ppc <= 0) {
        errorEl.innerText = 'Datos inválidos';
        errorEl.style.display = 'block';
        return;
    }

    errorEl.style.display = 'none';

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

    ['tickerInput','qtyInput','avgInput','daysInput'].forEach(id => el(id).value = '');

    priceCache[ticker] = await getPrice(ticker, activeType);

    renderAll();
}

/* ───────── INIT ───────── */
async function init() {
    updateClocks();

    positions = lsGet(LS_POSITIONS) || [];

    try {
        const mep = await fetch(`${PROXY}?url=${encodeURIComponent('https://dolarapi.com/v1/dolares/bolsa')}`).then(r => r.json());
        mepRate = parseFloat(mep.venta);
        el('sourceRow').innerText = `Dólar MEP: $${mepRate}`;
    } catch {}

    if (positions.length > 0) {
        const results = await Promise.all(positions.map(p => getPrice(p.ticker, p.type)));
        positions.forEach((p, i) => priceCache[p.ticker] = results[i]);
    }

    renderAll();

    el('addBtn').onclick = handleAdd;

    // FIX botones tipo
    document.querySelectorAll('.type-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeType = btn.dataset.type;
        });
    });
}

window.deletePos = (i) => {
    positions.splice(i, 1);
    lsSet(LS_POSITIONS, positions);
    renderAll();
};

document.addEventListener('DOMContentLoaded', init);