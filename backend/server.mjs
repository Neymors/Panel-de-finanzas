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

// Habilitar CORS
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
| CONFIG
|--------------------------------------------------------------------------
*/

const PORT = process.env.PORT || 3000
const CACHE_DURATION = 60 * 1000

/*
|--------------------------------------------------------------------------
| CACHE
|--------------------------------------------------------------------------
*/

let cache = {
  data: null,
  updatedAt: 0
}

/*
|--------------------------------------------------------------------------
| HELPERS
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
      headers: {
        'User-Agent': 'Mozilla/5.0'
      },
      timeout: 10000
    }
  )

  return response.data?.datos || []
}

async function getBonds() {
  const now = Date.now()

  /*
  |--------------------------------------------------------------------------
  | CACHE HIT
  |--------------------------------------------------------------------------
  */

  if (
    cache.data &&
    now - cache.updatedAt < CACHE_DURATION
  ) {
    return cache.data
  }

  /*
  |--------------------------------------------------------------------------
  | FETCH
  |--------------------------------------------------------------------------
  */

  console.log('Fetching bonds from Rava...')

  const rawBonds = await fetchBondsFromRava()

  const normalized = rawBonds.map(normalizeBond)

  /*
  |--------------------------------------------------------------------------
  | SAVE CACHE
  |--------------------------------------------------------------------------
  */

  cache = {
    data: normalized,
    updatedAt: now
  }

  return normalized
}

/*
|--------------------------------------------------------------------------
| ROUTES
|--------------------------------------------------------------------------
*/

/*
|--------------------------------------------------------------------------
| Health Check / API Status
|--------------------------------------------------------------------------
*/

fastify.get('/api/status', async () => {
  return {
    success: true,
    service: 'Rava Bonds API',
    timestamp: new Date().toISOString()
  }
})

/*
|--------------------------------------------------------------------------
| Get all bonds
|--------------------------------------------------------------------------
*/

fastify.get('/api/bonds', async () => {
  const bonds = await getBonds()

  return {
    success: true,
    count: bonds.length,
    updatedAt: new Date(cache.updatedAt).toISOString(),
    data: bonds
  }
})

/*
|--------------------------------------------------------------------------
| Get bond by symbol
|--------------------------------------------------------------------------
*/

fastify.get('/api/bonds/:symbol', async (request, reply) => {
  const { symbol } = request.params

  const bonds = await getBonds()

  const bond = bonds.find(
    (b) =>
      b.symbol.toUpperCase() === symbol.toUpperCase()
  )

  if (!bond) {
    reply.code(404)

    return {
      success: false,
      error: 'Bond not found'
    }
  }

  return {
    success: true,
    data: bond
  }
})

/*
|--------------------------------------------------------------------------
| Search bonds
|--------------------------------------------------------------------------
*/

fastify.get('/api/search/:query', async (request) => {
  const { query } = request.params

  const bonds = await getBonds()

  const results = bonds.filter((bond) => {
    const q = query.toLowerCase()

    return (
      bond.symbol.toLowerCase().includes(q) ||
      bond.name.toLowerCase().includes(q)
    )
  })

  return {
    success: true,
    count: results.length,
    data: results
  }
})

/*
|--------------------------------------------------------------------------
| Top bonds by TIR
|--------------------------------------------------------------------------
*/

fastify.get('/api/top/tir', async () => {
  const bonds = await getBonds()

  const sorted = [...bonds]
    .filter((b) => !isNaN(b.tir))
    .sort((a, b) => b.tir - a.tir)
    .slice(0, 20)

  return {
    success: true,
    count: sorted.length,
    data: sorted
  }
})

/*
|--------------------------------------------------------------------------
| Top bonds by parity
|--------------------------------------------------------------------------
*/

fastify.get('/api/top/paridad', async () => {
  const bonds = await getBonds()

  const sorted = [...bonds]
    .filter((b) => !isNaN(b.paridad))
    .sort((a, b) => b.paridad - a.paridad)
    .slice(0, 20)

  return {
    success: true,
    count: sorted.length,
    data: sorted
  }
})

/*
|--------------------------------------------------------------------------
| Clear cache manually
|--------------------------------------------------------------------------
*/

fastify.post('/api/cache/clear', async () => {
  cache = {
    data: null,
    updatedAt: 0
  }

  return {
    success: true,
    message: 'Cache cleared',
    timestamp: new Date().toISOString()
  }
})

/*
|--------------------------------------------------------------------------
| START SERVER (Configurado para el entorno dinámico de Render)
|--------------------------------------------------------------------------
*/

const start = async () => {
  try {
    // Es crítico usar host: '0.0.0.0' y convertir PORT a Number para que Render exponga el servicio
    await fastify.listen({
      port: Number(PORT),
      host: '0.0.0.0'
    })
    console.log(`🚀 Amygdalé API & Dashboard running on port ${PORT}`)
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

start()