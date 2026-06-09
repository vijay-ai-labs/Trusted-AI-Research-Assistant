import { describe, expect, it, vi } from 'vitest'
import {
  filterWorks,
  mapWorkToResearchItem,
  reconstructAbstract,
  searchOpenAlex,
  type OpenAlexWork,
} from './openalexService'

const baseWork: OpenAlexWork = {
  id: 'https://openalex.org/W1234567',
  display_name: 'Attention Is All You Need',
  publication_year: 2017,
  cited_by_count: 90000,
  is_retracted: false,
  type: 'article',
  doi: 'https://doi.org/10.48550/arXiv.1706.03762',
  open_access: { is_oa: true, oa_url: 'https://arxiv.org/abs/1706.03762' },
  authorships: [
    { author: { display_name: 'Ashish Vaswani' } },
    { author: { display_name: 'Noam Shazeer' } },
  ],
  abstract_inverted_index: {
    The: [0],
    dominant: [1],
    sequence: [2],
    transduction: [3],
    models: [4],
  },
  primary_location: { source: { display_name: 'arXiv' } },
  topics: [{ display_name: 'Transformer Models' }, { display_name: 'Natural Language Processing' }],
  keywords: [{ display_name: 'attention mechanism' }],
}

describe('reconstructAbstract', () => {
  it('reconstructs text from inverted index', () => {
    const result = reconstructAbstract({ The: [0], quick: [1], fox: [2] })
    expect(result).toBe('The quick fox')
  })

  it('returns empty string for null input', () => {
    expect(reconstructAbstract(null)).toBe('')
  })

  it('returns empty string for empty object', () => {
    expect(reconstructAbstract({})).toBe('')
  })

  it('reconstructs baseWork abstract correctly', () => {
    const result = reconstructAbstract(baseWork.abstract_inverted_index)
    expect(result).toBe('The dominant sequence transduction models')
  })
})

describe('filterWorks', () => {
  it('removes retracted works', () => {
    const retracted = { ...baseWork, is_retracted: true }
    expect(filterWorks([retracted])).toHaveLength(0)
  })

  it('removes works with no title', () => {
    const noTitle = { ...baseWork, display_name: null }
    expect(filterWorks([noTitle])).toHaveLength(0)
  })

  it('removes works with blank title', () => {
    const blankTitle = { ...baseWork, display_name: '   ' }
    expect(filterWorks([blankTitle])).toHaveLength(0)
  })

  it('keeps valid non-retracted works', () => {
    expect(filterWorks([baseWork])).toHaveLength(1)
  })
})

describe('mapWorkToResearchItem', () => {
  it('maps core fields correctly', () => {
    const item = mapWorkToResearchItem(baseWork)

    expect(item.id).toBe('oa-W1234567')
    expect(item.title).toBe('Attention Is All You Need')
    expect(item.year).toBe(2017)
    expect(item.citationCount).toBe(90000)
    expect(item.peerReviewed).toBe(true)
    expect(item.sourceType).toBe('paper')
    expect(item.sourceName).toBe('arXiv')
  })

  it('sets importedFrom and verifiedByHuman', () => {
    const item = mapWorkToResearchItem(baseWork)
    expect(item.importedFrom).toBe('openalex')
    expect(item.verifiedByHuman).toBe(false)
    expect(item.normalizationConfidence).toBe(0.7)
  })

  it('uses oa_url as primary url', () => {
    const item = mapWorkToResearchItem(baseWork)
    expect(item.url).toBe('https://arxiv.org/abs/1706.03762')
  })

  it('falls back to doi url when no oa_url', () => {
    const work = { ...baseWork, open_access: { is_oa: false, oa_url: null } }
    const item = mapWorkToResearchItem(work)
    expect(item.url).toBe('https://doi.org/10.48550/arXiv.1706.03762')
  })

  it('falls back to openalex url when no oa_url and no doi', () => {
    const work = { ...baseWork, open_access: null, doi: null }
    const item = mapWorkToResearchItem(work)
    expect(item.url).toBe('https://openalex.org/W1234567')
  })

  it('populates authors from authorships', () => {
    const item = mapWorkToResearchItem(baseWork)
    expect(item.authors).toContain('Ashish Vaswani')
    expect(item.authors).toContain('Noam Shazeer')
  })

  it('populates domainTags from topics and keywords', () => {
    const item = mapWorkToResearchItem(baseWork)
    expect(item.domainTags.length).toBeGreaterThan(0)
    expect(item.domainTags.some((t) => t.includes('Transformer') || t.includes('attention'))).toBe(true)
  })

  it('reconstructs abstract from inverted index', () => {
    const item = mapWorkToResearchItem(baseWork)
    expect(item.abstractOrClaim).toContain('dominant')
  })

  it('marks non-article types as not peer reviewed', () => {
    const preprint = { ...baseWork, type: 'preprint' }
    const item = mapWorkToResearchItem(preprint)
    expect(item.peerReviewed).toBe(false)
  })

  it('strips doi prefix from doi field', () => {
    const item = mapWorkToResearchItem(baseWork)
    expect(item.doi).toBe('10.48550/arXiv.1706.03762')
  })
})

describe('searchOpenAlex — proxy-first behavior', () => {
  it('calls /api/openalex/search as first fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [baseWork] }),
    })
    vi.stubGlobal('fetch', fetchMock)
    await searchOpenAlex('attention mechanism')
    expect(fetchMock).toHaveBeenCalled()
    const firstCallUrl = fetchMock.mock.calls[0][0] as string
    expect(firstCallUrl).toContain('/api/openalex/search')
    expect(firstCallUrl).toContain('q=')
    vi.unstubAllGlobals()
  })

  it('returns success via proxy without apiKey param', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [baseWork] }),
    }))
    const result = await searchOpenAlex('attention')
    expect(result.status).toBe('success')
    expect(result.items).toHaveLength(1)
    vi.unstubAllGlobals()
  })
})

describe('searchOpenAlex fallback', () => {
  it('returns failed status when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))
    const result = await searchOpenAlex('transformer architecture')
    expect(result.status).toBe('failed')
    expect(result.items).toHaveLength(0)
    vi.unstubAllGlobals()
  })

  it('returns failed status on non-200 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))
    const result = await searchOpenAlex('language models')
    expect(result.status).toBe('failed')
    vi.unstubAllGlobals()
  })

  it('returns empty status when results array is empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ results: [] }),
      }),
    )
    const result = await searchOpenAlex('xyzzy nonsense query')
    expect(result.status).toBe('empty')
    expect(result.items).toHaveLength(0)
    vi.unstubAllGlobals()
  })

  it('returns success and mapped items on valid response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ results: [baseWork] }),
      }),
    )
    const result = await searchOpenAlex('attention mechanism')
    expect(result.status).toBe('success')
    expect(result.items).toHaveLength(1)
    expect(result.items[0].importedFrom).toBe('openalex')
    vi.unstubAllGlobals()
  })

  it('filters retracted works from API response', async () => {
    const retractedWork = { ...baseWork, is_retracted: true }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ results: [retractedWork, baseWork] }),
      }),
    )
    const result = await searchOpenAlex('attention mechanism')
    expect(result.status).toBe('success')
    expect(result.items).toHaveLength(1)
    vi.unstubAllGlobals()
  })

  it('sanitizes wildcards like ? and * from the query', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [baseWork] }),
    })
    vi.stubGlobal('fetch', fetchMock)
    
    await searchOpenAlex('What is retrieval augmented generation??**')
    
    expect(fetchMock).toHaveBeenCalled()
    const callUrl = fetchMock.mock.calls[0][0] as string
    expect(callUrl).toContain('q=What%20is%20retrieval%20augmented%20generation')
    expect(callUrl).not.toContain('%3F') // ?
    expect(callUrl).not.toContain('%2A') // *
    
    vi.unstubAllGlobals()
  })
})
