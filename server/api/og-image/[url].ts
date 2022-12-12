import opengraph from 'opengraph-io'

// This API-Endpoint will be cached via nuxt.config.ts -> nitro.routeRules['/api/og-image/**']

type OpenGraphClient = ReturnType<typeof opengraph>

let openGraphClient: OpenGraphClient

function getOpenGraphClient(): OpenGraphClient {
  const appId = useRuntimeConfig().opengraphApi
  if (typeof appId !== 'string')
    throw new Error('Missing NUXT_OPENGRAPH_API environment variable.')

  if (!openGraphClient)
    openGraphClient = opengraph({ appId, fullRender: true })!

  return openGraphClient
}

function extractOgImageUrl(html: string): string {
  const match = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"|<meta[^>]*content="([^"]+)"[^>]*property="og:image"/)
  return match?.[1] ?? match?.[2] ?? ''
}

async function resolveOgImageUrlManually(cardUrl: string): Promise<string> {
  const html = await $fetch<string>(cardUrl)

  const ogImageUrl = extractOgImageUrl(html)

  if (!ogImageUrl) {
    // Throw an error so we can try to apply another fallback
    throw new Error('Could not find og:image in html.')
  }

  return ogImageUrl
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const { url } = getRouterParams(event)

  const cardUrl = decodeURIComponent(url)

  if (!cardUrl) {
    throw createError({
      statusCode: 422,
      statusMessage: 'Missing cardUrl.',
    })
  }

  if (typeof cardUrl !== 'string') {
    throw createError({
      statusCode: 422,
      statusMessage: 'cardUrl must be string.',
    })
  }

  // If anything goes wrong, fail gracefully
  try {
    // First we want to try to get the og:image from the html
    // But sometimes it is not included due to async JS loading
    let ogImageUrl = await resolveOgImageUrlManually(cardUrl).catch(() =>
      // Try another fallback
      '',
    )

    if (config.opengraphApi) {
      // If no og:image was found, try to get it from opengraph.io
      if (!ogImageUrl) {
        const response = await getOpenGraphClient().getSiteInfo(cardUrl).catch(() =>
          // Try another fallback
          null,
        )

        ogImageUrl = response?.openGraph?.image?.url || response?.hybridGraph?.image || ''
      }
    }

    if (!ogImageUrl.startsWith('https')) {
      // If the og:image is not https, we can't use it
      sendError(event, {
        statusCode: 404, // Must be 404 so the srcset can fallback to the default image
        fatal: false,
        message: 'og:image must be https.',
        name: 'OgImageError',
        unhandled: false,
      })
      return
    }

    if (!ogImageUrl) {
      // If nothing helped, send 404 so the srcset can fallback to the default image
      sendError(event, {
        statusCode: 404,
        fatal: false,
        message: 'Could not find og:image.',
        name: 'OgImageError',
        unhandled: false,
      })
      return
    }

    await sendRedirect(event, ogImageUrl)
  }
  catch (error) {
    throw createError({
      statusCode: 500,
      statusMessage: (error as Error)?.message || 'Unknown error.',
      cause: error,
    })
  }
})
