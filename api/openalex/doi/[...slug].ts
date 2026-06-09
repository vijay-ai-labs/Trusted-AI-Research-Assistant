import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCors } from '../../_lib/cors.js'

const OPENALEX_BASE = 'https://api.openalex.org'

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res)) return
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return }

  // slug is a string[] from the catch-all route — join and decode to reconstruct the DOI
  const slugParam = req.query['slug']
  const rawSlug = Array.isArray(slugParam) ? slugParam.join('/') : String(slugParam ?? '')
  const doi = decodeURIComponent(rawSlug).trim()

  if (!doi) { res.status(400).json({ error: 'DOI path parameter is required' }); return }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 8_000)

  try {
    const upstream = await fetch(
      `${OPENALEX_BASE}/works/doi:${encodeURIComponent(doi)}`,
      { signal: controller.signal },
    )
    clearTimeout(timeoutId)

    if (!upstream.ok) {
      const status = upstream.status === 404 ? 404 : 502
      res.status(status).json({ error: 'OpenAlex DOI lookup failed.' }); return
    }
    const data = await upstream.json()
    res.json(data)
  } catch (err) {
    clearTimeout(timeoutId)
    const msg = err instanceof Error ? err.message : 'Unknown'
    if (msg.includes('abort') || (err instanceof Error && err.name === 'AbortError')) {
      res.status(504).json({ error: 'OpenAlex DOI lookup timed out.' })
    } else {
      res.status(502).json({ error: 'OpenAlex DOI lookup unavailable.' })
    }
  }
}
