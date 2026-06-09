import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCors } from '../_lib/cors'

const OPENALEX_BASE = 'https://api.openalex.org'
const MAILTO = 'aiatozofficial@gmail.com'
const SELECT_FIELDS = [
  'id', 'display_name', 'publication_year', 'cited_by_count',
  'is_retracted', 'type', 'doi', 'open_access', 'authorships',
  'abstract_inverted_index', 'primary_location', 'topics', 'keywords',
].join(',')

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res)) return
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return }

  const q = typeof req.query['q'] === 'string' ? req.query['q'].trim() : ''
  if (!q) { res.status(400).json({ error: 'q query parameter is required' }); return }

  const cleanQ = q.replace(/[\?\*]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!cleanQ) { res.json({ results: [] }); return }

  const params = new URLSearchParams({
    search: cleanQ,
    per_page: '15',
    filter: 'is_retracted:false,has_abstract:true',
    sort: 'relevance_score:desc',
    select: SELECT_FIELDS,
    mailto: MAILTO,
  })
  const OPENALEX_API_KEY = process.env.OPENALEX_API_KEY
  if (OPENALEX_API_KEY) params.set('api_key', OPENALEX_API_KEY)

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 8_000)

  try {
    const upstream = await fetch(`${OPENALEX_BASE}/works?${params.toString()}`, {
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    if (!upstream.ok) { res.status(502).json({ error: 'OpenAlex search unavailable.' }); return }
    const data = await upstream.json()
    res.json(data)
  } catch (err) {
    clearTimeout(timeoutId)
    const msg = err instanceof Error ? err.message : 'Unknown'
    if (msg.includes('abort') || (err instanceof Error && err.name === 'AbortError')) {
      res.status(504).json({ error: 'OpenAlex search timed out.' })
    } else {
      res.status(502).json({ error: 'OpenAlex search unavailable.' })
    }
  }
}
