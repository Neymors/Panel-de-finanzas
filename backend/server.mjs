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

// Forzar explícitamente a que responda el archivo index.html en la raíz
fastify.get('/', async (request, reply) => {
  return reply.sendFile('index.html')
})

// PROXY ROUTE: Soluciona los errores 404 y decodifica las llamadas externas
fastify.get('/api/proxy', async (request, reply) => {
  const { url } = request.query

  if (!url) {
    reply.code(400)
    return { success: false, error: 'Falta el parámetro URL en la consulta' }
  }

  try {
    // Decodifica los caracteres especiales (%3A, %2F, ?, =) traídos desde script.js
    const cleanUrl = decodeURIComponent(url)
    request.log.info(`Proxying request to: ${cleanUrl}`)

    const response = await axios.get(cleanUrl, {
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      },
      timeout: 7000 // Tiempo límite de espera para APIs externas lentas
    })
    
    return response.data
  } catch (error) {
    request.log.error(`Error en Proxy para la URL: ${url} ->`, error.message)
    reply.code(error.response?.status || 500)
    return { 
      success: false, 
      error: 'Error al consultar el recurso externo a través del proxy',
      details: error.message 
    }
  }
})

// Estado de la API
fastify.get('/api/status', async () => {
  return {
    success: true,
    service: 'Amygdalé Core API',
    timestamp: new Date().toISOString()
  }
})

// Obtener todos los bonos procesados
fastify.get('/api/bonds', async () => {
  const bonds = await getBonds()
  return {
    success: true,
    count: bonds.length,
    updatedAt: new Date(cache.updatedAt).toISOString(),
    data: bonds
  }
})

// Obtener un bono específico por símbolo (ej: AL30)
fastify.get('/api/bonds/:symbol', async (request, reply) => {
  const { symbol } = request.params
  const bonds = await getBonds()
  const bond = bonds.find((b) => b.symbol.toUpperCase() === symbol.toUpperCase())

  if (!bond) {
    reply.code(404)
    return { success: false, error: 'Bond not found' }
  }
  return { success: true, data: bond }
})

// Buscador de bonos
fastify.get('/api/search/:query', async (request) => {
  const { query } = request.params
  const bonds = await getBonds()
  const results = bonds.filter((bond) => {
    const q = query.toLowerCase()
    return bond.symbol.toLowerCase().includes(q) || bond.name.toLowerCase().includes(q)
  })
  return { success: true, count: results.length, data: results }
})

// Top 20 bonos por TIR
fastify.get('/api/top/tir', async () => {
  const bonds = await getBonds()
  const sorted = [...bonds]
    .filter((b) => !isNaN(b.tir))
    .sort((a, b) => b.tir - a.tir)
    .slice(0, 20)
  return { success: true, count: sorted.length, data: sorted }
})

// Top 20 bonos por Paridad
fastify.get('/api/top/paridad', async () => {
  const bonds = await getBonds()
  const sorted = [...bonds]
    .filter((b) => !isNaN(b.paridad))
    .sort((a, b) => b.paridad - a.paridad)
    .slice(0, 20)
  return { success: true, count: sorted.length, data: sorted }
})

// Limpiar la caché manualmente si fuera necesario
fastify.post('/api/cache/clear', async () => {
  cache = { data: null, updatedAt: 0 }
  return { success: true, message: 'Cache cleared', timestamp: new Date().toISOString() }
})

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