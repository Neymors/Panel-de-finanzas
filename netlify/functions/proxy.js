/**
 * Amygdalé — Proxy CORS
 * Netlify Function: /netlify/functions/proxy
 * Mapeada como /api/proxy via netlify.toml
 *
 * Uso: GET /api/proxy?url=https://api.externa.com/endpoint
 *
 * Dominios permitidos (whitelist de seguridad):
 *   - open.bymadata.com.ar      (BYMA — bonos AR)
 *   - dolarapi.com              (Dólar MEP)
 *   - api.coingecko.com         (Cripto)
 *   - query1.finance.yahoo.com  (Acciones)
 *   - query2.finance.yahoo.com  (Acciones fallback)
 */

const ALLOWED_DOMAINS = [
  'open.bymadata.com.ar',
  'dolarapi.com',
  'api.coingecko.com',
  'query1.finance.yahoo.com',
  'query2.finance.yahoo.com',
];

exports.handler = async (event) => {
  // Solo GET
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  const targetUrl = event.queryStringParameters?.url;

  if (!targetUrl) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Falta parámetro ?url=' }),
    };
  }

  // Validar URL
  let parsed;
  try {
    parsed = new URL(decodeURIComponent(targetUrl));
  } catch {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'URL inválida' }),
    };
  }

  // Whitelist de dominios
  const domainAllowed = ALLOWED_DOMAINS.some(
    (d) => parsed.hostname === d || parsed.hostname.endsWith('.' + d)
  );

  if (!domainAllowed) {
    return {
      statusCode: 403,
      body: JSON.stringify({
        error: `Dominio no permitido: ${parsed.hostname}`,
        allowed: ALLOWED_DOMAINS,
      }),
    };
  }

  try {
    const response = await fetch(parsed.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Amygdale/2.0)',
        'Accept':     'application/json',
      },
      // Timeout de 8 segundos
      signal: AbortSignal.timeout(8000),
    });

    const contentType = response.headers.get('content-type') || 'application/json';
    const body        = await response.text();

    return {
      statusCode: response.status,
      headers: {
        'Content-Type':                'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control':               'public, max-age=60', // 1 min de caché en CDN
      },
      body,
    };
  } catch (err) {
    const isTimeout = err.name === 'TimeoutError' || err.name === 'AbortError';
    return {
      statusCode: isTimeout ? 504 : 502,
      body: JSON.stringify({
        error: isTimeout ? 'Timeout al contactar la API externa' : 'Error de red',
        detail: err.message,
      }),
    };
  }
};