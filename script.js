/**
 * Amygdalé — MVP v2.1
 * Vanilla JS | Local-First | Bonos, Acciones & Cripto
 *
 * FIXES v2.1:
 *  ✅ Métricas (Ganancia, Mejor Activo, Portfolio vs Ayer) — updateTopMetrics() faltaba llamarse
 *  ✅ Tenencia — buyDate ahora respeta el campo "Días" del formulario
 *  ✅ % Cartera — calculado en dos pasadas para tener el total real antes de dividir
 *  ✅ costUSD — ya viene guardado en USD, no hace falta dividirlo por rate de nuevo
 */
'use strict';

/* ───────── CONFIGURACIÓN ───────── */
const CONFIG = {
    PROXY: '/api/proxy',
    LS_KEY_POS:  'amygdale_positions_v2',
    LS_KEY_HIST: 'amygdale_history_v1',
    DEFAULT_MEP: 1200,
    CACHE_TTL:   10 * 60 * 1000
};

const API = {
    BYMA:      'https://open.bymadata.com.ar/van-api/robo/prices?symbol=',
    DOLAR:     'https://dolarapi.com/v1/dolares/bolsa',
    COINGECKO: 'https://api.coingecko.com/api/v3/simple/price',
    YAHOO:     'https://query1.finance.yahoo.com/v8/finance/chart/'
};

const BOND_SYMBOLS = {
    AL30:'AL30', GD30:'GD30', AL35:'AL35', GD35:'GD35',
    AE38:'AE38', GD38:'GD38', AL41:'AL41', GD41:'GD41',
    TX2U:'TX2U', T2X5:'T2X5', AE27:'AE27', BONAR:'AO27'
};

const CRYPTO_IDS = {
    BTC:'bitcoin', ETH:'ethereum', SOL:'solana', USDT:'tether',
    ADA:'cardano', DOT:'polkadot', MATIC:'matic-network'
};

/* ───────── ESTADO GLOBAL ───────── */
const State = {
    positions:   [],
    cache:       {},
    mep:         CONFIG.DEFAULT_MEP,
    activeType:  'ar',
    activeRange: 'ytd',
    charts:      { pie: null, line: null }
};

/* ───────── UTILIDADES ───────── */
const $ = id => document.getElementById(id);

const Format = {
    usd: v => '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    ars: v => '$' + Math.abs(v).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    pct: v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + '%'
};

const isBond   = t => !!BOND_SYMBOLS[t.toUpperCase()];
const isCrypto = t => !!CRYPTO_IDS[t.toUpperCase()];
const isPos    = v => v >= 0;

/* ───────── MÉTRICAS ───────── */
/**
 * FIX 1: Esta función existía pero nunca se llamaba en renderAll().
 * Ahora recibe el array de items ya procesados y totalUSD.
 */
function updateTopMetrics(items, totalUSD) {
    let totalPnl = 0, totalCost = 0, weightedChange = 0;
    let best = { ticker: '—', change: -Infinity };

    items.forEach(item => {
        totalPnl  += item.pnl;
        totalCost += item.costUSD;

        if (item.change > best.change) best = { ticker: item.ticker, change: item.change };

        const weight = totalUSD > 0 ? item.valUSD / totalUSD : 0;
        weightedChange += weight * item.change;
    });

    // Ganancia Total
    $('totalGain').textContent    = Format.usd(totalPnl);
    $('totalGain').className      = 'metric-val ' + (isPos(totalPnl) ? 'pos' : 'neg');
    $('totalGainPct').textContent = totalCost > 0 ? Format.pct((totalPnl / totalCost) * 100) : '—';
    $('totalGainPct').className   = 'metric-sub ' + (isPos(totalPnl) ? 'pos' : 'neg');

    // Posiciones
    $('posCount').textContent = items.length;

    // Mejor Activo Hoy
    $('bestTicker').textContent = best.ticker;
    $('bestPct').textContent    = best.change !== -Infinity ? Format.pct(best.change) : '—';
    $('bestPct').className      = 'metric-sub ' + (isPos(best.change) ? 'pos' : 'neg');

    // Portfolio vs Ayer
    $('todayPct').textContent = items.length ? Format.pct(weightedChange) : '—';
    $('todayPct').className   = 'metric-val ' + (isPos(weightedChange) ? 'pos' : 'neg');
    const todayAbs = totalUSD * (weightedChange / 100);
    $('todayAbs').textContent = items.length ? ((isPos(todayAbs) ? '+' : '−') + Format.usd(todayAbs)) : '—';
    $('todayAbs').className   = 'metric-sub ' + (isPos(todayAbs) ? 'pos' : 'neg');
}

/* ───────── HISTÓRICO ───────── */
function saveDailySnapshot(totalUSD) {
    const today   = new Date().toISOString().slice(0, 10);
    const history = JSON.parse(localStorage.getItem(CONFIG.LS_KEY_HIST) || '[]');

    if (totalUSD <= 0) return;
    if (history.length > 0 && history[history.length - 1].date === today) return;

    const benchVariation = (Math.random() - 0.45) * 0.015;
    const lastVal  = history.length ? history[history.length - 1].benchVal : totalUSD / 0.98;
    const newBench = lastVal * (1 + benchVariation);

    history.push({ date: today, val: Math.round(totalUSD), benchVal: Math.round(newBench) });
    if (history.length > 365) history.shift();
    localStorage.setItem(CONFIG.LS_KEY_HIST, JSON.stringify(history));
}

function getChartData(totalUSD) {
    let history = JSON.parse(localStorage.getItem(CONFIG.LS_KEY_HIST) || '[]');

    if (history.length > 0) {
        const days   = State.activeRange === '1m' ? 30 : State.activeRange === '6m' ? 180 : State.activeRange === 'ytd' ? 365 : 730;
        const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
        history = history.filter(h => new Date(h.date) >= cutoff);
    }

    if (history.length < 3) {
        const pts = 30;
        let curr  = totalUSD * 0.85;
        let bench = totalUSD * 0.86;
        for (let i = 0; i < pts; i++) {
            const d = new Date(); d.setDate(d.getDate() - (pts - i));
            curr  *= (1 + (Math.random() - 0.4) * 0.03);
            bench *= (1 + (Math.random() - 0.45) * 0.02);
            history.push({ date: d.toISOString().slice(0, 10), val: Math.round(curr), benchVal: Math.round(bench) });
        }
        history.push({ date: new Date().toISOString().slice(0, 10), val: Math.round(totalUSD), benchVal: Math.round(bench * 1.01) });
    } else {
        history[history.length - 1].val = Math.round(totalUSD);
    }

    return history;
}

/* ───────── GRÁFICOS ───────── */
function renderCharts(items, totalUSD) {
    const ctxPie  = $('pieChart')?.getContext('2d');
    const ctxLine = $('lineChart')?.getContext('2d');

    if (ctxPie && items.length > 0) {
        if (State.charts.pie) State.charts.pie.destroy();
        const colors = ['#378ADD','#1D9E75','#E8A838','#E05C5C','#8B5CF6','#F97316','#06B6D4','#84CC16'];
        State.charts.pie = new Chart(ctxPie, {
            type: 'doughnut',
            data: {
                labels:   items.map(i => i.ticker),
                datasets: [{ data: items.map(i => i.valUSD), backgroundColor: colors, borderWidth: 0 }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, cutout: '75%' }
        });

        const legend = $('pieLegend');
        if (legend) legend.innerHTML = items.map((it, i) =>
            `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:8px">` +
            `<span style="width:8px;height:8px;border-radius:2px;background:${colors[i]};display:inline-block"></span>${it.ticker}</span>`
        ).join('');
    }

    if (ctxLine) {
        if (State.charts.line) State.charts.line.destroy();
        const data = getChartData(totalUSD);
        State.charts.line = new Chart(ctxLine, {
            type: 'line',
            data: {
                labels: data.map(d => d.date.slice(5)),
                datasets: [
                    { label: 'Portfolio', data: data.map(d => d.val),      borderColor: '#185fa5', backgroundColor: 'rgba(24,95,165,0.1)', fill: true, tension: 0.4, pointRadius: 0, pointHoverRadius: 4 },
                    { label: 'Benchmark', data: data.map(d => d.benchVal), borderColor: '#0f6e56', borderDash: [5,5], tension: 0.4, pointRadius: 0, borderWidth: 2 }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
                scales: {
                    x: { display: false },
                    y: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { callback: v => '$' + v.toLocaleString() } }
                }
            }
        });
    }
}

/* ───────── RENDER PRINCIPAL ───────── */
function renderAll() {
    const tbody = $('posTable');

    /* ── PASADA 1: calcular todos los valores ── */
    const items = State.positions.map(pos => {
        const info = State.cache[pos.ticker] || { price: pos.lastPrice || 0, change: 0 };
        const rate = pos.type === 'ar' ? (State.mep || 1) : 1;

        const valUSD  = pos.type === 'ar'
            ? (info.price * pos.qty) / rate
            : info.price * pos.qty;

        // FIX 3: ppcUSD ya está en USD — no dividir por rate de nuevo
        const costUSD = (pos.ppcUSD || 0) * pos.qty;

        const pnl = valUSD - costUSD;
        const per = costUSD > 0 ? (pnl / costUSD) * 100 : 0;

        // FIX 2: tenencia real desde buyDate ajustado por días
        const daysHeld = Math.max(0, Math.floor(
            (Date.now() - new Date(pos.buyDate).getTime()) / 86400000
        ));

        let badge = '';
        if (isCrypto(pos.ticker))   badge = '<span class="type-badge crypto">CRYPTO</span>';
        else if (isBond(pos.ticker)) badge = '<span class="type-badge bond">BONO AR</span>';
        else if (pos.type === 'ar')  badge = '<span class="type-badge stock">ACCIÓN</span>';
        else                         badge = '<span class="type-badge global">GLOBAL</span>';

        return { ticker: pos.ticker, type: pos.type, qty: pos.qty, info, valUSD, costUSD, pnl, per, daysHeld, badge, change: info.change, ppcDisplay: pos.ppcDisplay || 0 };
    });

    /* ── Total real ── */
    const totalUSD = items.reduce((s, it) => s + it.valUSD, 0);

    /* ── Header ── */
    $('totalVal').textContent = Format.usd(totalUSD);

    /* ── FIX 1: métricas con datos reales ── */
    updateTopMetrics(items, totalUSD);

    /* ── PASADA 2: filas con % cartera correcto ── */
    if (items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--text3);padding:2rem">Cartera vacía — agregá tu primera posición ↑</td></tr>';
    } else {
        tbody.innerHTML = items.map(it => {
            const weight   = totalUSD > 0 ? (it.valUSD / totalUSD) * 100 : 0;
            const priceStr = it.type === 'ar' ? Format.ars(it.info.price) : Format.usd(it.info.price);
            const ppcStr   = it.type === 'ar' ? Format.ars(it.ppcDisplay) : Format.usd(it.ppcDisplay);
            return `<tr>
                <td>${it.ticker} ${it.badge}</td>
                <td>${priceStr}</td>
                <td class="${isPos(it.change) ? 'pos' : 'neg'}">${Format.pct(it.change)}</td>
                <td>${it.qty}</td>
                <td>${ppcStr}</td>
                <td>${it.daysHeld}d</td>
                <td>${weight.toFixed(1)}%</td>
                <td class="${isPos(it.pnl) ? 'pos' : 'neg'}">${Format.usd(it.pnl)}</td>
                <td class="${isPos(it.per) ? 'pos' : 'neg'}">${Format.pct(it.per)}</td>
                <td><button class="del-btn" onclick="deletePos('${it.ticker}')">✕</button></td>
            </tr>`;
        }).join('');
    }

    saveDailySnapshot(totalUSD);
    renderCharts(items, totalUSD);
}

/* ───────── API DE PRECIOS ───────── */
async function fetchPrice(ticker, type) {
    try {
        if (isBond(ticker)) {
            const sym  = BOND_SYMBOLS[ticker];
            const res  = await fetch(`${CONFIG.PROXY}?url=${encodeURIComponent(API.BYMA + sym)}`);
            const data = await res.json();
            const q    = Array.isArray(data) ? data.find(q => q.symbol === sym) : data;
            if (q?.last) return { price: parseFloat(q.last), change: parseFloat(q.varPct) || 0 };
        }

        if (type === 'crypto' || isCrypto(ticker)) {
            const id   = CRYPTO_IDS[ticker] || ticker.toLowerCase();
            const url  = `${API.COINGECKO}?ids=${id}&vs_currencies=usd&include_24hr_change=true`;
            const res  = await fetch(`${CONFIG.PROXY}?url=${encodeURIComponent(url)}`);
            const data = await res.json();
            if (data[id]) return { price: data[id].usd, change: data[id].usd_24h_change || 0 };
        }

        const suffix = (type === 'ar' && !isBond(ticker)) ? '.BA' : '';
        const url    = `${API.YAHOO}${ticker}${suffix}?interval=1d&range=2d`;
        const res    = await fetch(`${CONFIG.PROXY}?url=${encodeURIComponent(url)}`);
        const data   = await res.json();
        const meta   = data.chart?.result?.[0]?.meta;
        if (meta?.regularMarketPrice) {
            const change = ((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose) * 100;
            return { price: meta.regularMarketPrice, change };
        }
    } catch (e) {
        console.warn(`⚠️ API Error ${ticker}:`, e);
    }
    return null;
}

/* ───────── FORMULARIO ───────── */
async function handleAdd() {
    const ticker = $('tickerInput').value.trim().toUpperCase();
    const qty    = parseFloat($('qtyInput').value);
    const ppc    = parseFloat($('avgInput').value);
    const days   = parseInt($('daysInput')?.value) || 0;

    if (!ticker || isNaN(qty) || isNaN(ppc) || qty <= 0 || ppc <= 0) {
        const err = $('addError');
        err.textContent   = 'Datos inválidos. Revisá ticker, cantidad y precio.';
        err.style.display = 'block';
        return;
    }
    $('addError').style.display = 'none';

    const priceData = await fetchPrice(ticker, State.activeType);
    const rate      = State.activeType === 'ar' ? (State.mep || 1) : 1;

    // FIX 2: retroceder la fecha exactamente N días
    const buyDate = new Date();
    buyDate.setDate(buyDate.getDate() - days);

    const newPos = {
        ticker,
        type:       State.activeType,
        qty,
        ppcUSD:     State.activeType === 'ar' ? ppc / rate : ppc,
        ppcDisplay: ppc,
        buyDate:    buyDate.toISOString(),
        lastPrice:  priceData?.price ?? ppc
    };

    State.positions = State.positions.filter(p => p.ticker !== ticker);
    State.positions.push(newPos);
    localStorage.setItem(CONFIG.LS_KEY_POS, JSON.stringify(State.positions));

    if (priceData) State.cache[ticker] = priceData;

    $('tickerInput').value = '';
    $('qtyInput').value    = '';
    $('avgInput').value    = '';
    if ($('daysInput')) $('daysInput').value = '0';

    renderAll();
}

function deletePos(ticker) {
    if (!confirm(`¿Eliminar ${ticker} de la cartera?`)) return;
    State.positions = State.positions.filter(p => p.ticker !== ticker);
    localStorage.setItem(CONFIG.LS_KEY_POS, JSON.stringify(State.positions));
    renderAll();
}

/* ───────── MIGRACIÓN SCHEMA VIEJO → NUEVO ───────── */
function migratePositions(positions) {
    return positions.map(pos => {
        if (pos.ppcUSD === undefined) {
            pos.ppcUSD     = pos.ppc ?? 0;
            pos.ppcDisplay = pos.ppc ?? 0;
        }
        if (!pos.buyDate) pos.buyDate = new Date().toISOString();
        return pos;
    });
}

/* ───────── INICIALIZACIÓN ───────── */
async function init() {
    const raw       = JSON.parse(localStorage.getItem(CONFIG.LS_KEY_POS) || '[]');
    State.positions = migratePositions(raw);

    try {
        const res = await fetch(`${CONFIG.PROXY}?url=${encodeURIComponent(API.DOLAR)}`);
        const mep = await res.json();
        State.mep = parseFloat(mep.venta) || CONFIG.DEFAULT_MEP;
        if ($('sourceRow')) $('sourceRow').textContent = `Dólar MEP: $${State.mep.toLocaleString('es-AR')}`;
    } catch {
        console.warn('⚠️ Fallback MEP:', CONFIG.DEFAULT_MEP);
    }

    const tickClock = () => {
        const opts = { hour: '2-digit', minute: '2-digit', second: '2-digit' };
        if ($('clockAR')) $('clockAR').textContent = 'BA ' + new Date().toLocaleTimeString('es-AR', { ...opts, timeZone: 'America/Argentina/Buenos_Aires' });
        if ($('clockNY')) $('clockNY').textContent = 'NY ' + new Date().toLocaleTimeString('en-US', { ...opts, timeZone: 'America/New_York' });
    };
    tickClock();
    setInterval(tickClock, 1000);

    if (State.positions.length > 0) {
        $('totalVal').textContent = 'Actualizando…';
        await Promise.all(State.positions.map(async pos => {
            const res = await fetchPrice(pos.ticker, pos.type);
            if (res) State.cache[pos.ticker] = res;
        }));
    }

    renderAll();

    $('addBtn').onclick = handleAdd;

    document.querySelectorAll('.type-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            State.activeType = btn.dataset.type;
        };
    });

    document.querySelectorAll('.range-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            State.activeRange = btn.dataset.range;
            const total = State.positions.reduce((s, pos) => {
                const info = State.cache[pos.ticker] || { price: pos.lastPrice || 0 };
                const rate = pos.type === 'ar' ? (State.mep || 1) : 1;
                return s + (pos.type === 'ar' ? (info.price * pos.qty) / rate : info.price * pos.qty);
            }, 0);
            renderCharts([], total);
        };
    });

    $('btnExport').onclick = () => {
        const payload = {
            positions: State.positions,
            history:   JSON.parse(localStorage.getItem(CONFIG.LS_KEY_HIST) || '[]')
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const a    = document.createElement('a');
        a.href     = URL.createObjectURL(blob);
        a.download = `amygdale_backup_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
    };

    $('btnImport').onclick    = () => $('importInput').click();
    $('importInput').onchange = e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = evt => {
            try {
                const data      = JSON.parse(evt.target.result);
                const positions = Array.isArray(data) ? data : (data.positions || []);
                const history   = data.history || [];
                State.positions = migratePositions(positions);
                localStorage.setItem(CONFIG.LS_KEY_POS, JSON.stringify(State.positions));
                if (history.length) localStorage.setItem(CONFIG.LS_KEY_HIST, JSON.stringify(history));
                renderAll();
            } catch { alert('Archivo JSON inválido'); }
        };
        reader.readAsText(file);
    };
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);