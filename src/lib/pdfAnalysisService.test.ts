import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PDFAnalysisResult, UploadedPDFState } from '../../research'
import { analyzePDFText, enrichWithOpenAlex, buildResearchItem, SYSTEM_PROMPT } from './pdfAnalysisService'

function makeState(overrides: Partial<UploadedPDFState> = {}): UploadedPDFState {
  const analysis: PDFAnalysisResult = {
    title: 'Test Paper',
    authors: ['Alice Smith'],
    year: 2023,
    doi: null,
    researchQuestion: 'What is the effect of X?',
    methodology: 'RCT',
    datasetOrSample: 'N=500 participants',
    keyFindings: ['Finding 1'],
    limitations: ['Small sample'],
    importantQuotesOrClaims: [],
    relatedKeywords: ['machine learning'],
    summaryForPhDStudent: 'This paper examines X.',
    confidence: 'high',
  }
  return {
    fileName: 'test.pdf',
    status: 'complete',
    statusMessage: 'Analysis complete',
    analysis,
    enrichmentLabel: '',
    objectUrl: 'blob:http://localhost/abc',
    addedToEvidence: false,
    error: null,
    ...overrides,
  }
}

function mockFetchSuccess(data: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => data,
  })
}

function mockFetchFail(status = 429) {
  return vi.fn().mockResolvedValue({ ok: false, status })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('analyzePDFText — proxy-first behavior', () => {
  it('calls /api/openai/pdf-analysis (backend proxy) as first fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({
          title: 'T', authors: [], year: null, doi: null,
          researchQuestion: '', methodology: '', datasetOrSample: '',
          keyFindings: [], limitations: [], importantQuotesOrClaims: [],
          relatedKeywords: [], summaryForPhDStudent: '', confidence: 'high',
        }) } }],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)
    await analyzePDFText('PDF text here', '')
    const firstCallUrl = fetchMock.mock.calls[0][0] as string
    expect(firstCallUrl).toBe('/api/openai/pdf-analysis')
  })

  it('does not include API key in proxy request body', async () => {
    let capturedBody: string | undefined
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      capturedBody = init?.body as string
      return Promise.resolve({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({
            title: null, authors: [], year: null, doi: null,
            researchQuestion: '', methodology: '', datasetOrSample: '',
            keyFindings: [], limitations: [], importantQuotesOrClaims: [],
            relatedKeywords: [], summaryForPhDStudent: '', confidence: 'insufficient',
          }) } }],
        }),
      })
    }))
    await analyzePDFText('PDF text', 'sk-real-key-must-not-appear')
    const body = JSON.parse(capturedBody ?? '{}') as Record<string, unknown>
    expect(body).not.toHaveProperty('apiKey')
    expect(JSON.stringify(body)).not.toContain('sk-real-key-must-not-appear')
  })
})

describe('analyzePDFText', () => {
  it('returns confidence:insufficient when no API key and proxy unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))
    const result = await analyzePDFText('some text', '')
    expect(result.confidence).toBe('insufficient')
  })

  it('returns confidence:insufficient when text is empty', async () => {
    const result = await analyzePDFText('   ', 'sk-test')
    expect(result.confidence).toBe('insufficient')
  })

  it('parses valid OpenAI JSON response into PDFAnalysisResult', async () => {
    const mockResponse: PDFAnalysisResult = {
      title: 'Deep Learning for NLP',
      authors: ['Alice Smith', 'Bob Jones'],
      year: 2022,
      doi: '10.1234/abc',
      researchQuestion: 'Can LLMs reason?',
      methodology: 'Empirical study',
      datasetOrSample: 'GPT-4 outputs',
      keyFindings: ['LLMs can reason to some degree'],
      limitations: ['Black box'],
      importantQuotesOrClaims: ['"LLMs hallucinate"'],
      relatedKeywords: ['LLM', 'reasoning'],
      summaryForPhDStudent: 'Important paper on LLM reasoning.',
      confidence: 'high',
    }
    vi.stubGlobal('fetch', mockFetchSuccess({
      choices: [{ message: { content: JSON.stringify(mockResponse) } }],
    }))
    const result = await analyzePDFText('PDF text here', 'sk-test')
    expect(result.title).toBe('Deep Learning for NLP')
    expect(result.authors).toEqual(['Alice Smith', 'Bob Jones'])
    expect(result.confidence).toBe('high')
    expect(result.keyFindings).toHaveLength(1)
  })

  it('falls back gracefully on invalid JSON response', async () => {
    vi.stubGlobal('fetch', mockFetchSuccess({
      choices: [{ message: { content: 'NOT VALID JSON {{' } }],
    }))
    const result = await analyzePDFText('PDF text here', 'sk-test')
    expect(result.confidence).toBe('insufficient')
  })

  it('falls back on HTTP error', async () => {
    vi.stubGlobal('fetch', mockFetchFail(429))
    const result = await analyzePDFText('PDF text here', 'sk-test')
    expect(result.confidence).toBe('insufficient')
  })

  it('system prompt contains "only the provided text"', () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toContain('only the provided text')
  })

  it('system prompt forbids using training knowledge', () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toContain('do not use')
  })
})

describe('enrichWithOpenAlex — proxy routing', () => {
  it('routes DOI lookup through /api/openalex/doi/ proxy', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        doi: 'https://doi.org/10.1234/abc',
        publication_year: 2021,
        cited_by_count: 99,
        authorships: [{ author: { display_name: 'Jane Doe' } }],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const analysis = {
      title: 'Test', authors: [], year: null, doi: '10.1234/abc',
      researchQuestion: '', methodology: '', datasetOrSample: '',
      keyFindings: [], limitations: [], importantQuotesOrClaims: [],
      relatedKeywords: [], summaryForPhDStudent: '', confidence: 'medium' as const,
    }
    await enrichWithOpenAlex(analysis)
    const firstCallUrl = fetchMock.mock.calls[0][0] as string
    expect(firstCallUrl).toContain('/api/openalex/doi/')
  })
})

describe('enrichWithOpenAlex', () => {
  it('returns no enrichment when no title and no DOI', async () => {
    const analysis: PDFAnalysisResult = {
      title: null, authors: [], year: null, doi: null,
      researchQuestion: '', methodology: '', datasetOrSample: '',
      keyFindings: [], limitations: [], importantQuotesOrClaims: [],
      relatedKeywords: [], summaryForPhDStudent: '', confidence: 'insufficient',
    }
    const result = await enrichWithOpenAlex(analysis)
    expect(result.enriched).toBeNull()
  })

  it('does NOT overwrite analysis title with OpenAlex title', async () => {
    // Simulate a weak title match from OpenAlex (different title)
    vi.stubGlobal('fetch', mockFetchSuccess({
      results: [{
        id: 'https://openalex.org/W123',
        display_name: 'Completely Different Paper About Something Else',
        publication_year: 2020,
        cited_by_count: 50,
        is_retracted: false,
        type: 'article',
        doi: null,
        open_access: null,
        authorships: [],
        abstract_inverted_index: null,
        primary_location: null,
        topics: [],
        keywords: [],
      }],
    }))
    const analysis: PDFAnalysisResult = {
      title: 'My Specific Paper Title', authors: [], year: null, doi: null,
      researchQuestion: '', methodology: '', datasetOrSample: '',
      keyFindings: [], limitations: [], importantQuotesOrClaims: [],
      relatedKeywords: [], summaryForPhDStudent: '', confidence: 'medium',
    }
    const result = await enrichWithOpenAlex(analysis)
    // Weak match — should not enrich
    expect(result.enriched).toBeNull()
    expect(result.label).toBe('OpenAlex match not found')
  })

  it('returns enriched fields on strong DOI match', async () => {
    vi.stubGlobal('fetch', mockFetchSuccess({
      doi: 'https://doi.org/10.1234/abc',
      publication_year: 2021,
      cited_by_count: 120,
      authorships: [{ author: { display_name: 'Jane Doe' } }],
    }))
    const analysis: PDFAnalysisResult = {
      title: 'Test Paper', authors: [], year: null, doi: '10.1234/abc',
      researchQuestion: '', methodology: '', datasetOrSample: '',
      keyFindings: [], limitations: [], importantQuotesOrClaims: [],
      relatedKeywords: [], summaryForPhDStudent: '', confidence: 'medium',
    }
    const result = await enrichWithOpenAlex(analysis)
    expect(result.enriched).not.toBeNull()
    expect(result.enriched?.citationCount).toBe(120)
    expect(result.enriched?.year).toBe(2021)
    expect(result.label).toContain('OpenAlex')
  })
})

describe('buildResearchItem', () => {
  it('sets importedFrom to uploaded-pdf', () => {
    const state = makeState()
    const item = buildResearchItem(state, null)
    expect(item.importedFrom).toBe('uploaded-pdf')
  })

  it('sets verifiedByHuman to false', () => {
    const state = makeState()
    const item = buildResearchItem(state, null)
    expect(item.verifiedByHuman).toBe(false)
  })

  it('trustNotes contains "Not independently verified"', () => {
    const state = makeState()
    const item = buildResearchItem(state, null)
    expect(item.trustNotes).toContain('Not independently verified')
  })

  it('does not invent year when analysis.year is null', () => {
    const state = makeState({
      analysis: {
        ...makeState().analysis!,
        year: null,
      },
    })
    const item = buildResearchItem(state, null)
    expect(item.year).toBe(0)
  })

  it('applies enrichment year when enrichment is provided', () => {
    const state = makeState()
    const item = buildResearchItem(state, { year: 2020, citationCount: 50 })
    expect(item.year).toBe(2020)
    expect(item.citationCount).toBe(50)
  })

  it('url falls back to #uploaded-pdf when objectUrl is null', () => {
    const state = makeState({ objectUrl: null })
    const item = buildResearchItem(state, null)
    expect(item.url).toBe('#uploaded-pdf')
  })

  it('sourceType is paper', () => {
    const state = makeState()
    const item = buildResearchItem(state, null)
    expect(item.sourceType).toBe('paper')
  })
})
