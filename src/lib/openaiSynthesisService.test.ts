import { describe, expect, it, vi } from 'vitest'
import { selectTopSources, synthesizeAnswer } from './openaiSynthesisService'
import type { RankedResearchItem } from './researchEngine'

const rankedItem: RankedResearchItem = {
  id: 'rag-2020',
  title: 'RAG Paper',
  sourceType: 'paper',
  sourceName: 'NeurIPS',
  url: 'https://arxiv.org/abs/2005.11401',
  year: 2020,
  authors: ['Patrick Lewis'],
  domainTags: ['rag'],
  abstractOrClaim: 'Introduces retrieval augmented generation.',
  citationCount: 5000,
  peerReviewed: true,
  verifiedByHuman: false,
  retracted: false,
  region: 'global',
  trustNotes: 'Demo seed.',
  importedFrom: 'openalex',
  normalizationConfidence: 0.9,
  audit: {
    provenance: 'openalex',
    label: 'Live OpenAlex academic source',
    issues: [],
    completeness: 1,
    hasWarnings: false,
    isUsable: true,
  },
  relevance: 10,
  trustSignal: 30,
  totalScore: 130,
  matchedTerms: ['rag'],
}

function makeItems(count: number): RankedResearchItem[] {
  return Array.from({ length: count }, (_, i) => ({ ...rankedItem, id: `item-${i}` }))
}

function mockProxySuccess(payload: object) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
    }),
  )
}

function mockProxyFail() {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))
}

function mockProxyNonOk(status = 503) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status }))
}

describe('selectTopSources', () => {
  it('limits to max 10 sources and assigns correct markers', () => {
    const items = makeItems(12)
    const sources = selectTopSources(items)
    expect(sources).toHaveLength(10)
    expect(sources[0].marker).toBe('S1')
    expect(sources[9].marker).toBe('S10')
  })

  it('assigns sequential markers starting from S1', () => {
    const items = makeItems(3)
    const sources = selectTopSources(items)
    expect(sources.map((s) => s.marker)).toEqual(['S1', 'S2', 'S3'])
  })
})

describe('synthesizeAnswer — proxy-first behavior', () => {
  it('calls /api/openai/synthesize (backend proxy) as first fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              directAnswer: 'Answer [S1].', detailedAnswer: [], keyEvidence: [],
              sourceComparison: [], limitations: [], researchUsefulness: '', confidence: 'high',
            }),
          },
        }],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)
    await synthesizeAnswer('rag', [rankedItem])
    expect(fetchMock).toHaveBeenCalled()
    const firstCallUrl = fetchMock.mock.calls[0][0] as string
    expect(firstCallUrl).toBe('/api/openai/synthesize')
    vi.unstubAllGlobals()
  })

  it('does not include API key in proxy request body', async () => {
    let capturedBody: string | undefined
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      capturedBody = init?.body as string
      return Promise.resolve({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                directAnswer: 'A.', detailedAnswer: [], keyEvidence: [],
                sourceComparison: [], limitations: [], researchUsefulness: '', confidence: 'high',
              }),
            },
          }],
        }),
      })
    }))
    await synthesizeAnswer('rag', [rankedItem], 'sk-real-key-must-not-appear')
    const body = JSON.parse(capturedBody ?? '{}') as Record<string, unknown>
    expect(body).not.toHaveProperty('apiKey')
    expect(JSON.stringify(body)).not.toContain('sk-real-key-must-not-appear')
    vi.unstubAllGlobals()
  })

  it('succeeds via proxy without needing apiKey param', async () => {
    mockProxySuccess({
      directAnswer: 'RAG improves accuracy [S1].',
      detailedAnswer: ['RAG combines retrieval with generation [S1].'],
      keyEvidence: ['[S1] shows improvement.'],
      sourceComparison: [],
      limitations: [],
      researchUsefulness: 'Useful.',
      confidence: 'high',
    })
    const result = await synthesizeAnswer('rag', [rankedItem])
    expect(result.usedDeterministicFallback).toBe(false)
    expect(result.directAnswer).toContain('[S1]')
    expect(result.confidence).toBe('high')
    vi.unstubAllGlobals()
  })
})

describe('synthesizeAnswer — fallback paths', () => {
  it('returns deterministic fallback when proxy is unavailable (network error)', async () => {
    mockProxyFail()
    const result = await synthesizeAnswer('rag', [rankedItem])
    expect(result.usedDeterministicFallback).toBe(true)
    expect(result.fallbackReason).toBe('proxy-unavailable')
    expect(result.directAnswer.length).toBeGreaterThan(0)
    vi.unstubAllGlobals()
  })

  it('returns deterministic fallback when proxy returns non-ok status', async () => {
    mockProxyNonOk(503)
    const result = await synthesizeAnswer('rag', [rankedItem])
    expect(result.usedDeterministicFallback).toBe(true)
    expect(result.fallbackReason).toBe('proxy-unavailable')
    vi.unstubAllGlobals()
  })

  it('returns deterministic fallback when proxy returns non-JSON content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'not json at all' } }] }),
    }))
    const result = await synthesizeAnswer('rag', [rankedItem])
    expect(result.usedDeterministicFallback).toBe(true)
    expect(result.fallbackReason).toBe('proxy-unavailable')
    vi.unstubAllGlobals()
  })

  it('returns deterministic fallback when rankedItems is empty', async () => {
    const result = await synthesizeAnswer('rag', [])
    expect(result.usedDeterministicFallback).toBe(true)
    expect(result.fallbackReason).toBe('no-sources')
    expect(result.sourcesUsed).toHaveLength(0)
  })

  it('returns deterministic fallback when proxy fails and no apiKey provided', async () => {
    mockProxyFail()
    const result = await synthesizeAnswer('rag', [rankedItem], undefined)
    expect(result.usedDeterministicFallback).toBe(true)
    expect(result.fallbackReason).toBe('proxy-unavailable')
    vi.unstubAllGlobals()
  })
})

describe('synthesizeAnswer — success paths', () => {
  it('returns synthesis result with source markers on valid proxy response', async () => {
    mockProxySuccess({
      directAnswer: 'RAG improves accuracy [S1].',
      detailedAnswer: ['RAG combines parametric memory with non-parametric retrieval [S1].'],
      keyEvidence: ['[S1] Source one shows improvement.'],
      sourceComparison: ['[S1] is the primary source on RAG.'],
      limitations: ['Limited to NLP tasks.'],
      researchUsefulness: 'Useful for grounding LLM outputs.',
      confidence: 'high',
    })
    const result = await synthesizeAnswer('rag', [rankedItem])
    expect(result.usedDeterministicFallback).toBe(false)
    expect(result.directAnswer).toContain('[S1]')
    expect(result.confidence).toBe('high')
    expect(result.sourcesUsed).toHaveLength(1)
    vi.unstubAllGlobals()
  })

  it('passes through insufficient confidence signal without fallback', async () => {
    mockProxySuccess({
      directAnswer: 'The retrieved sources are insufficient to answer this confidently.',
      detailedAnswer: [],
      keyEvidence: [],
      sourceComparison: [],
      limitations: [],
      researchUsefulness: '',
      confidence: 'insufficient',
    })
    const result = await synthesizeAnswer('obscure query', [rankedItem])
    expect(result.usedDeterministicFallback).toBe(false)
    expect(result.confidence).toBe('insufficient')
    vi.unstubAllGlobals()
  })

  it('parses detailedAnswer as array of paragraphs', async () => {
    mockProxySuccess({
      directAnswer: 'Answer [S1].',
      detailedAnswer: ['Para 1 [S1].', 'Para 2 [S1].'],
      keyEvidence: ['[S1] finding.'],
      sourceComparison: [],
      limitations: [],
      researchUsefulness: 'Useful.',
      confidence: 'high',
    })
    const result = await synthesizeAnswer('rag', [rankedItem])
    expect(result.detailedAnswer).toHaveLength(2)
    expect(result.detailedAnswer[0]).toContain('[S1]')
    vi.unstubAllGlobals()
  })

  it('parses sourceComparison as array', async () => {
    mockProxySuccess({
      directAnswer: 'Answer [S1].',
      detailedAnswer: [],
      keyEvidence: [],
      sourceComparison: ['[S1] and [S2] agree on X.'],
      limitations: [],
      researchUsefulness: '',
      confidence: 'medium',
    })
    const result = await synthesizeAnswer('rag', [rankedItem])
    expect(result.sourceComparison).toHaveLength(1)
    expect(result.sourceComparison[0]).toContain('[S1]')
    vi.unstubAllGlobals()
  })
})

describe('selectTopSources — limits and truncation', () => {
  it('selectTopSources limits to 10 by default', () => {
    const items = makeItems(15)
    const sources = selectTopSources(items)
    expect(sources).toHaveLength(10)
    expect(sources[9].marker).toBe('S10')
  })

  it('truncates abstract at 1500 chars', () => {
    const longItem = { ...rankedItem, abstractOrClaim: 'x'.repeat(2000) }
    const sources = selectTopSources([longItem])
    expect(sources[0].abstract).toHaveLength(1501) // 1500 chars + '…'
    expect(sources[0].abstract.endsWith('…')).toBe(true)
  })
})
