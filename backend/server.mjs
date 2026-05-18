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
const PROXY_TIMEOUT = 15000 // ↑ Timeout aumentado para Yahoo (15s)

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
| HEADERS PARA ENGÑAR A YAHOO FINANCE (Browser Simulation)
|--------------------------------------------------------------------------
*/
const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-site',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Referer': 'https://finance.yahoo.com/'
}

/*
|--------------------------------------------------------------------------
| VALIDADOR DE RESPUESTA YAHOO FINANCE
|--------------------------------------------------------------------------
*/
function isValidYahooResponse(data) {
  // Estructura esperada: data.chart.result[0].meta.regularMarketPrice
  return (
    data?.chart?.result?.[0]?.meta?.regularMarketPrice !== undefined &&
    data?.chart?.result?.[0]?.meta?.regularMarketPrice !== null &&
    data?.chart?.result?.[0]?.meta?.regularMarketPrice > 0
  )
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

// 🔧 PROXY ROUTE MEJORADO: Manejo robusto de Yahoo Finance y otras APIs
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

    // Detectar si es Yahoo Finance para aplicar headers especiales
    const isYahoo = cleanUrl.includes('query1.finance.yahoo.com')
    const headers = isYahoo ? YAHOO_HEADERS : { 
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'application/json'
    }

    const response = await axios.get(cleanUrl, {
      headers,
      timeout: PROXY_TIMEOUT, // ↑ 15 segundos para Yahoo
      validateStatus: (status) => status < 500, // No tirar error en 4xx, manejar manualmente
      responseType: 'json',
      maxRedirects: 5
    })

    // 🛡️ Validación específica para Yahoo Finance
    if (isYahoo) {
      if (response.status !== 200) {
        request.log.warn(`Yahoo returned status ${response.status}`)
        throw new Error(`Yahoo Finance responded with status ${response.status}`)
      }
      
      if (!isValidYahooResponse(response.data)) {
        request.log.warn(`Yahoo response structure invalid: ${JSON.stringify(response.data).slice(0, 200)}`)
        
        // Debug: loguear si Yahoo devolvió HTML de error
        if (typeof response.data === 'string' || response.data?.chart?.result === null) {
          throw new Error('Yahoo Finance bloqueó la solicitud o devolvió formato inválido')
        }
        throw new Error('Formato de respuesta de Yahoo no reconocido')
      }
      
      request.log.info('Yahoo response validated successfully')
    }

    return response.data

  } catch (error) {
    request.log.error(`Proxy error for URL: ${url}`, {
      message: error.message,
      code: error.code,
      status: error.response?.status
    })

    // 🎯 Manejo específico de errores para el frontend
    if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      reply.code(504)
      return {
        success: false,
        error: 'Timeout al consultar el servicio externo',
        details: 'La solicitud tardó más de lo esperado. Intentá nuevamente.'
      }
    }
    
    if (error.response?.status === 429) {
      reply.code(429)
      return {
        success: false,
        error: 'Límite de solicitudes alcanzado',
        details: 'Demasiadas peticiones. Esperá unos segundos antes de reintentar.'
      }
    }
    
    if (error.response?.status === 401 || error.response?.status === 403) {
      reply.code(403)
      return {
        success: false,
        error: 'Acceso denegado por el servicio externo',
        details: 'El servicio bloqueó esta solicitud. Podés intentar más tarde.'
      }
    }

    // Error genérico
    reply.code(error.response?.status || 502)
    return {
      success: false,
      error: 'Error al consultar el recurso externo',
      details: error.message || 'Error desconocido'
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
  return { 
    success: true, 
    message: 'Cache cleared', 
    timestamp: new Date().toISOString() 
  }
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
      host: '0.0.0.0' // Clave para que Render pueda rutear el tráfico externo
    })
    console.log(`🚀 Amygdalé Dashboard corriendo en puerto ${PORT}`)
    console.log(`📡 Proxy endpoint: http://localhost:${PORT}/api/proxy?url=...`)
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

start()