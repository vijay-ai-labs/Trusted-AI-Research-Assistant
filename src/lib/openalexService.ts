// V1.8: Calls route through /api/openalex/search (backend proxy).
// LOCAL DEV ONLY fallback calls OpenAlex directly when proxy is unreachable
// and import.meta.env.DEV === true. Never runs in production.

import type { ResearchItem } from '../../research'

const BASE_URL = 'https://api.openalex.org'
const MAILTO = 'aiatozofficial@gmail.com'
const TIMEOUT_MS = 8000
const PROXY_TIMEOUT_MS = 9_000
const PER_PAGE = 15
const SELECT_FIELDS = [
  'id',
  'display_name',
  'publication_year',
  'cited_by_count',
  'is_retracted',
  'type',
  'doi',
  'open_access',
  'authorships',
  'abstract_inverted_index',
  'primary_location',
  'topics',
  'keywords',
].join(',')

const PROXY_SEARCH = '/api/openalex/search'

export interface OpenAlexWork {
  id: string
  display_name: string | null
  publication_year: number | null
  cited_by_count: number
  is_retracted: boolean
  type: string
  doi: string | null
  open_access: { is_oa: boolean; oa_url: string | null } | null
  authorships: Array<{ author: { display_name: string } }>
  abstract_inverted_index: Record<string, number[]> | null
  primary_location: { source: { display_name: string } | null } | null
  topics: Array<{ display_name: string }> | null
  keywords: Array<{ display_name: string }> | null
}

export interface OpenAlexSearchResult {
  items: ResearchItem[]
  status: 'success' | 'failed' | 'empty'
  error?: string
}

export function reconstructAbstract(invertedIndex: Record<string, number[]> | null | undefined): string {
  if (!invertedIndex || typeof invertedIndex !== 'object' || Object.keys(invertedIndex).length === 0) return ''

  try {
    const allPositions = Object.values(invertedIndex).flat()
    if (allPositions.length === 0) return ''

    const maxPos = Math.max(...allPositions)
    if (isNaN(maxPos) || maxPos < 0 || maxPos > 100000) return ''
    const words: string[] = new Array(maxPos + 1).fill('')

    for (const [word, positions] of Object.entries(invertedIndex)) {
      if (!Array.isArray(positions)) continue
      for (const pos of positions) {
        if (typeof pos === 'number' && pos >= 0 && pos <= maxPos) {
          words[pos] = word
        }
      }
    }

    return words.join(' ').trim()
  } catch {
    return ''
  }
}

export function filterWorks(works: OpenAlexWork[]): OpenAlexWork[] {
  if (!Array.isArray(works)) return []
  return works.filter((work) => {
    if (!work) return false
    if (work.is_retracted) return false
    if (typeof work.display_name !== 'string' || !work.display_name.trim()) return false
    return true
  })
}

export function mapWorkToResearchItem(work: OpenAlexWork): ResearchItem {
  const shortId = typeof work?.id === 'string' ? (work.id.split('/').pop() ?? work.id) : 'unknown'

  const abstract = reconstructAbstract(work?.abstract_inverted_index)

  const authors = Array.isArray(work?.authorships)
    ? work.authorships
        .slice(0, 5)
        .map((a) => a?.author?.display_name)
        .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
    : []

  const domainTags = [
    ...(Array.isArray(work?.topics) ? work.topics : []).slice(0, 2).map((t) => t?.display_name),
    ...(Array.isArray(work?.keywords) ? work.keywords : []).slice(0, 2).map((k) => k?.display_name),
  ]
    .filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
    .slice(0, 3)

  const sourceName = work?.primary_location?.source?.display_name ?? 'OpenAlex'

  const rawDoi = typeof work?.doi === 'string' ? work.doi.replace(/^https?:\/\/doi\.org\//, '') : null

  const url =
    work?.open_access?.oa_url ??
    (rawDoi ? `https://doi.org/${rawDoi}` : null) ??
    `https://openalex.org/${shortId}`

  return {
    id: `oa-${shortId}`,
    title: work?.display_name ?? 'Untitled Paper',
    sourceType: 'paper',
    sourceName,
    url,
    year: typeof work?.publication_year === 'number' ? work.publication_year : 0,
    authors: authors.length ? authors : ['Unknown'],
    domainTags: domainTags.length ? domainTags : ['academic'],
    abstractOrClaim: abstract || 'Abstract not available.',
    citationCount: typeof work?.cited_by_count === 'number' ? work.cited_by_count : 0,
    peerReviewed: work?.type === 'article' || work?.type === 'review',
    verifiedByHuman: false,
    retracted: !!work?.is_retracted,
    region: 'global',
    trustNotes: 'Source-backed via OpenAlex. High-confidence metadata. Needs independent verification for claims.',
    doi: rawDoi ?? undefined,
    importedFrom: 'openalex',
    normalizationConfidence: 0.7,
  }
}

// Calls the backend proxy. Returns null if proxy is unavailable or errors.
async function searchViaProxy(query: string): Promise<OpenAlexSearchResult | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS)
  try {
    const response = await fetch(`${PROXY_SEARCH}?q=${encodeURIComponent(query)}`, {
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (!response.ok) return null
    const data = await response.json() as { results: OpenAlexWork[] }
    const works = data.results ?? []
    if (works.length === 0) return { items: [], status: 'empty' }
    const filtered = filterWorks(works)
    if (filtered.length === 0) return { items: [], status: 'empty' }
    return { items: filtered.map(mapWorkToResearchItem), status: 'success' }
  } catch {
    clearTimeout(timeout)
    return null
  }
}

// Direct OpenAlex call — used when proxy is unreachable.
// OpenAlex returns Access-Control-Allow-Origin: * so browser calls work.
async function searchOpenAlexDirect(query: string, apiKey?: string): Promise<OpenAlexSearchResult> {
  const params = new URLSearchParams({
    search: query,
    per_page: String(PER_PAGE),
    filter: 'is_retracted:false,has_abstract:true',
    sort: 'relevance_score:desc',
    select: SELECT_FIELDS,
    mailto: MAILTO,
  })

  if (apiKey) params.set('api_key', apiKey)

  const url = `${BASE_URL}/works?${params.toString()}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const response = await fetch(url, { signal: controller.signal })
    clearTimeout(timeout)

    if (!response.ok) {
      return { items: [], status: 'failed', error: `OpenAlex returned HTTP ${response.status}` }
    }

    const data = (await response.json()) as { results: OpenAlexWork[] }
    const works = data.results ?? []

    if (works.length === 0) {
      return { items: [], status: 'empty' }
    }

    const filtered = filterWorks(works)

    if (filtered.length === 0) {
      return { items: [], status: 'empty' }
    }

    const items = filtered.map(mapWorkToResearchItem)

    return { items, status: 'success' }
  } catch (err) {
    clearTimeout(timeout)
    const message = err instanceof Error ? err.message : String(err)
    return { items: [], status: 'failed', error: message }
  }
}

export async function searchOpenAlex(query: string, apiKey?: string): Promise<OpenAlexSearchResult> {
  const cleanQuery = query.replace(/[\?\*]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!cleanQuery) {
    return { items: [], status: 'empty' }
  }

  // Step 1: Try backend proxy
  const proxyResult = await searchViaProxy(cleanQuery)
  if (proxyResult !== null) return proxyResult

  // Step 2: Direct fallback when proxy unreachable.
  // OpenAlex is a public CORS-enabled API; no key required for basic access.
  return searchOpenAlexDirect(cleanQuery, apiKey)
}
