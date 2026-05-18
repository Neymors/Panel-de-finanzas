import { chromium } from 'playwright'

async function main() {
  const browser = await chromium.launch({
    headless: true
  })

  const page = await browser.newPage()

  console.log('Abriendo Rava...\n')

  // Escuchar TODAS las respuestas
  page.on('response', async (response) => {
    try {
      const url = response.url()
      const contentType = response.headers()['content-type'] || ''

      // Filtrar respuestas interesantes
      if (
        contentType.includes('application/json') ||
        url.includes('api') ||
        url.includes('json') ||
        url.includes('market') ||
        url.includes('quote') ||
        url.includes('bonos')
      ) {
        console.log('\n====================================')
        console.log('URL:')
        console.log(url)

        console.log('\nSTATUS:')
        console.log(response.status())

        console.log('\nCONTENT TYPE:')
        console.log(contentType)

        // Intentar leer body
        try {
          const body = await response.text()

          console.log('\nBODY (primeros 1000 chars):')
          console.log(body.slice(0, 1000))
        } catch (err) {
          console.log('\nNo se pudo leer el body')
        }

        console.log('====================================\n')
      }
    } catch (err) {
      console.log('Error leyendo response:', err.message)
    }
  })

  await page.goto(
    'https://www.rava.com/cotizaciones/bonos',
    {
      waitUntil: 'networkidle',
      timeout: 60000
    }
  )

  console.log('Página cargada.')

  // Esperar requests async
  await page.waitForTimeout(15000)

  await browser.close()

  console.log('\nBrowser cerrado.')
}

main().catch(console.error)