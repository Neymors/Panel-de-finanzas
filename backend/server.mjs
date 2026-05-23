import Fastify from 'fastify'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import axios from 'axios'
import { fileURLToPath } from 'url'
import path from 'path'

// Configuración para resolver rutas de archivos estáticos en ES Modules
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const fastify = Fastify({
  logger: true
})

// Habilitar CORS para evitar bloqueos del navegador
await fastify.register(cors, {
  origin: true
})

// Servir archivos estáticos del Frontend (index.html, style.css, script.js)
await fastify.register(fastifyStatic, {
  root: __dirname,
  prefix: '/',
})

/*
|--------------------------------------------------------------------------
| CONFIGURACIÓN
|--------------------------------------------------------------------------
*/
const PORT = process.env.PORT || 3000
const CACHE_DURATION = 60 * 1000 // Cache de bonos por 1 minuto

/*
|--------------------------------------------------------------------------
| CACHE EN MEMORIA (Para Rava)
|--------------------------------------------------------------------------
*/
let cache = {
  data: null,
  updatedAt: 0
}

/*
|--------------------------------------------------------------------------
| HELPERS / NORMALIZACIÓN
|--------------------------------------------------------------------------
*/
function normalizeBond(bond) {
  return {
    symbol: bond.especie,
    name: bond.nombre,
    type: bond.tipo,
    law: bond.ley,
    price: Number(bond.precio) / 1000,
    tir: Number(bond.tir),
    duration: Number(bond.duration),
    dm: Number(bond.dm),
    paridad: Number(bond.paridad),
    currentYield: Number(bond.current_yield),
    technicalValue: Number(bond.valor_tecnico),
    convexity: Number(bond.convexity),
    maturityDate: bond.vencimiento,
    lastUpdateDate: bond.fecha,
    updatedAt: new Date().toISOString()
  }
}

async function fetchBondsFromRava() {
  const response = await axios.get(
    'https://mercado.rava.com/api/prices/bonos',
    {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000
    }
  )
  return response.data?.datos || []
}

async function getBonds() {
  const now = Date.now()
  if (cache.data && now - cache.updatedAt < CACHE_DURATION) {
    return cache.data
  }

  console.log('Fetching bonds from Rava...')
  const rawBonds = await fetchBondsFromRava()
  const normalized = rawBonds.map(normalizeBond)

  cache = {
    data: normalized,
    updatedAt: now
  }
  return normalized
}

/*
|--------------------------------------------------------------------------
| RUTAS DEL FRONTEND Y ENDPOINTS DE LA API
|--------------------------------------------------------------------------
*/

/*
|--------------------------------------------------------------------------
| RUTA: GET /api/bonds — Devuelve todos los bonos normalizados
|--------------------------------------------------------------------------
*/
fastify.get('/api/bonds', async (request, reply) => {
  try {
    const bonds = await getBonds()
    return { success: true, data: bonds }
  } catch (error) {
    request.log.error('Error en /api/bonds:', error.message)
    reply.status(502)
    return { success: false, error: error.message, data: [] }
  }
})

/*
|--------------------------------------------------------------------------
| RUTA: GET /api/top/tir — Devuelve los top bonos por TIR descendente
|--------------------------------------------------------------------------
*/
fastify.get('/api/top/tir', async (request, reply) => {
  try {
    const limit = Math.min(parseInt(request.query.limit) || 10, 50)
    const bonds = await getBonds()
    const sorted = [...bonds]
      .filter(b => b.tir > 0)
      .sort((a, b) => b.tir - a.tir)
      .slice(0, limit)
    return { success: true, data: sorted }
  } catch (error) {
    request.log.error('Error en /api/top/tir:', error.message)
    reply.status(502)
    return { success: false, error: error.message, data: [] }
  }
})

/*
|--------------------------------------------------------------------------
| RUTA: GET /api/proxy — Proxy CORS para APIs externas (Yahoo, CoinGecko, DolarAPI)
|--------------------------------------------------------------------------
*/
fastify.get('/api/proxy', async (request, reply) => {
  const { url } = request.query

  if (!url) {
    reply.status(400)
    return { success: false, error: 'Parámetro url requerido' }
  }

  // Whitelist de dominios permitidos para evitar SSRF
  const ALLOWED_HOSTS = [
    'query1.finance.yahoo.com',
    'query2.finance.yahoo.com',
    'api.coingecko.com',
    'dolarapi.com',
  ]

  let parsed
  try {
    parsed = new URL(url)
  } catch {
    reply.status(400)
    return { success: false, error: 'URL inválida' }
  }

  if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
    reply.status(403)
    return { success: false, error: `Host no permitido: ${parsed.hostname}` }
  }

  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
      timeout: 10000,
    })
    return response.data
  } catch (error) {
    const status = error.response?.status || 502
    request.log.error(`Proxy error [${url}]: ${error.message}`)
    reply.status(status)
    return { success: false, error: error.message }
  }
})

/*
|--------------------------------------------------------------------------
| BUSCADOR UNIVERSAL (Acciones, Bonos, Criptos)
|--------------------------------------------------------------------------
*/
fastify.get('/api/search', async (request, reply) => {
  const { q, type } = request.query; // Ejemplo: /api/search?q=AAPL&type=STOCK

  if (!q || q.length < 2) {
    return { success: false, data: [] };
  }

  try {
    let results = [];

    if (type === 'CRYPTO') {
      // Búsqueda en CoinGecko
      const res = await axios.get(`https://api.coingecko.com/api/v3/search?query=${q}`);
      results = res.data.coins.map(c => ({ 
        ticker: c.symbol.toUpperCase(), 
        name: c.name 
      }));
    } else {
      // Búsqueda en Yahoo Finance (Cubre Acciones y Bonos locales/internacionales)
      const res = await axios.get(`https://query2.finance.yahoo.com/v1/finance/search?q=${q}`);
      results = res.data.quotes.map(item => ({
        ticker: item.symbol,
        name: item.shortname || item.longname
      }));
    }

    return { success: true, data: results.slice(0, 6) };
  } catch (error) {
    request.log.error('Error en Buscador Universal:', error.message);
    return { success: false, data: [] };
  }
});

/*
|--------------------------------------------------------------------------
| INICIO DEL SERVIDOR
|--------------------------------------------------------------------------
*/
const start = async () => {
  try {
    await fastify.listen({
      port: Number(PORT),
      host: '0.0.0.0' // Clave para que Render pueda ruteat el tráfico externo
    })
    console.log(`🚀 Amygdalé Dashboard unificado corriendo en puerto ${PORT}`)
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

start()