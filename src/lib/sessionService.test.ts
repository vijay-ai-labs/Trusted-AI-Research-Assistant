import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createSessionFromCurrentState,
  deleteSession,
  exportSessionMarkdown,
  loadSessions,
  saveSession,
  updateSession,
  type SavedResearchSession,
} from './sessionService'
import type { RankedResearchItem, EvidenceAnswer, ResearchFilters } from './researchEngine'
import type { SynthesisResult } from './openaiSynthesisService'

// ── localStorage mock ──────────────────────────────────────────────────────────

const store: Record<string, string> = {}
vi.stubGlobal('localStorage', {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, val: string) => { store[key] = val },
  removeItem: (key: string) => { delete store[key] },
  clear: () => { Object.keys(store).forEach(k => delete store[k]) },
})

beforeEach(() => {
  Object.keys(store).forEach(k => delete store[k])
})

// ── Fixtures ───────────────────────────────────────────────────────────────────

const defaultFilters: ResearchFilters = {
  sourceTypes: ['paper', 'government'],
  peerReviewed: 'any',
  verification: 'any',
  region: 'any',
  yearFrom: 2000,
  yearTo: 2025,
  warnings: 'any',
}

const rankedItem: RankedResearchItem = {
  id: 'rag-001',
  title: 'Retrieval-Augmented Generation for NLP',
  sourceType: 'paper',
  sourceName: 'NeurIPS 2020',
  url: 'https://arxiv.org/abs/2005.11401',
  year: 2020,
  authors: ['Patrick Lewis', 'Ethan Perez'],
  domainTags: ['rag', 'nlp'],
  abstractOrClaim: 'Introduces retrieval augmented generation.',
  citationCount: 5000,
  peerReviewed: true,
  verifiedByHuman: false,
  retracted: false,
  region: 'global',
  trustNotes: 'Foundational RAG paper.',
  importedFrom: 'openalex',
  normalizationConfidence: 0.95,
  audit: {
    provenance: 'openalex',
    label: 'Live OpenAlex academic source',
    issues: [],
    completeness: 1,
    hasWarnings: false,
    isUsable: true,
  },
  relevance: 10,
  trustSignal: 28,
  totalScore: 120,
  matchedTerms: ['retrieval', 'augmented', 'generation'],
}

const aiSynthesisResult: SynthesisResult = {
  directAnswer: 'RAG combines retrieval and generation for grounded responses.',
  detailedAnswer: ['RAG retrieves relevant documents before generating.', 'It reduces hallucinations.'],
  keyEvidence: ['Lewis et al. 2020 introduced RAG.'],
  sourceComparison: ['RAG outperforms pure generation on open-domain QA.'],
  limitations: ['Depends on retrieval quality.'],
  researchUsefulness: 'Highly useful for building grounded AI systems.',
  confidence: 'high',
  sourcesUsed: [
    {
      marker: 'S1',
      title: 'Retrieval-Augmented Generation for NLP',
      authors: ['Patrick Lewis', 'Ethan Perez'],
      year: 2020,
      sourceName: 'NeurIPS 2020',
      sourceType: 'paper',
      peerReviewed: true,
      provenance: 'openalex',
      abstract: 'Introduces RAG.',
      trustNotes: 'Foundational RAG paper.',
      url: 'https://arxiv.org/abs/2005.11401',
    },
  ],
  usedDeterministicFallback: false,
}

const deterministicAnswer: EvidenceAnswer = {
  status: 'ready',
  headline: 'RAG: Retrieval-augmented generation explained',
  summary: 'RAG combines neural retrieval with generative models.',
  keyPoints: ['Retrieves relevant docs', 'Generates grounded responses'],
  caveats: ['Results depend on retrieval quality'],
  citedItems: [rankedItem],
}

const baseSession: SavedResearchSession = {
  id: 'test-id-001',
  schemaVersion: 1,
  title: 'Test session',
  query: 'retrieval augmented generation',
  createdAt: '2026-05-22T10:00:00.000Z',
  updatedAt: '2026-05-22T10:00:00.000Z',
  answer: null,
  sources: [],
  notes: '',
  filters: defaultFilters,
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('sessionService', () => {
  it('loadSessions returns empty array when localStorage is empty', () => {
    expect(loadSessions()).toEqual([])
  })

  it('loadSessions returns empty array and does not throw on malformed JSON', () => {
    store['ai_research_sessions'] = 'NOT_VALID_JSON{{{'
    expect(() => loadSessions()).not.toThrow()
    expect(loadSessions()).toEqual([])
  })

  it('saveSession + loadSessions round-trip preserves all fields', () => {
    saveSession(baseSession)
    const loaded = loadSessions()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].id).toBe('test-id-001')
    expect(loaded[0].query).toBe('retrieval augmented generation')
    expect(loaded[0].schemaVersion).toBe(1)
    expect(loaded[0].title).toBe('Test session')
  })

  it('saving two sessions does not overwrite the first', () => {
    saveSession(baseSession)
    saveSession({ ...baseSession, id: 'test-id-002', title: 'Second session' })
    const loaded = loadSessions()
    expect(loaded).toHaveLength(2)
    expect(loaded.map(s => s.id)).toContain('test-id-001')
    expect(loaded.map(s => s.id)).toContain('test-id-002')
  })

  it('updateSession replaces by id and updates updatedAt without touching other sessions', () => {
    const other = { ...baseSession, id: 'other-id', title: 'Other' }
    saveSession(baseSession)
    saveSession(other)
    const originalUpdatedAt = baseSession.updatedAt
    updateSession({ ...baseSession, title: 'Renamed session' })
    const loaded = loadSessions()
    const updated = loaded.find(s => s.id === 'test-id-001')!
    expect(updated.title).toBe('Renamed session')
    expect(updated.updatedAt).not.toBe(originalUpdatedAt)
    const untouched = loaded.find(s => s.id === 'other-id')!
    expect(untouched.title).toBe('Other')
  })

  it('deleteSession removes by id and leaves other sessions intact', () => {
    saveSession(baseSession)
    saveSession({ ...baseSession, id: 'test-id-002', title: 'Keep me' })
    deleteSession('test-id-001')
    const loaded = loadSessions()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].id).toBe('test-id-002')
  })

  it('deleteSession results in empty array when last session deleted', () => {
    saveSession(baseSession)
    deleteSession('test-id-001')
    expect(loadSessions()).toEqual([])
  })

  it('createSessionFromCurrentState with AI synthesis produces correct session shape', () => {
    const session = createSessionFromCurrentState(
      'retrieval augmented generation',
      [rankedItem],
      aiSynthesisResult,
      'ready',
      deterministicAnswer,
      defaultFilters,
      'My notes',
    )
    expect(session.schemaVersion).toBe(1)
    expect(session.id).toBeTruthy()
    expect(session.id.length).toBeGreaterThan(0)
    expect(session.title).toBeTruthy()
    expect(session.query).toBe('retrieval augmented generation')
    expect(session.answer).not.toBeNull()
    expect(session.answer!.usedDeterministicFallback).toBe(false)
    expect(session.answer!.directAnswer).toBe(aiSynthesisResult.directAnswer)
    expect(session.notes).toBe('My notes')
    // Verify no API keys stored
    const serialized = JSON.stringify(session)
    expect(serialized).not.toMatch(/sk-[a-zA-Z0-9]/)
  })

  it('createSessionFromCurrentState with fallback status uses deterministic answer', () => {
    const session = createSessionFromCurrentState(
      'retrieval augmented generation',
      [rankedItem],
      null,
      'fallback',
      deterministicAnswer,
      defaultFilters,
      '',
    )
    expect(session.answer).not.toBeNull()
    expect(session.answer!.usedDeterministicFallback).toBe(true)
    expect(session.answer!.deterministicHeadline).toBe('RAG: Retrieval-augmented generation explained')
    expect(session.answer!.deterministicKeyPoints).toContain('Retrieves relevant docs')
  })

  it('exportSessionMarkdown includes title, query, sources, notes, and footer caveat', () => {
    const session: SavedResearchSession = {
      ...baseSession,
      title: 'RAG Research',
      query: 'retrieval augmented generation',
      notes: 'Interesting papers here.',
      sources: [
        {
          id: 'rag-001',
          title: 'RAG Paper',
          authors: ['Patrick Lewis'],
          year: 2020,
          sourceName: 'NeurIPS 2020',
          sourceType: 'paper',
          url: 'https://arxiv.org/abs/2005.11401',
          trustNotes: 'Foundational.',
          peerReviewed: true,
          provenance: 'openalex',
        },
      ],
    }
    const md = exportSessionMarkdown(session)
    expect(md).toContain('# RAG Research')
    expect(md).toContain('**Query:** retrieval augmented generation')
    expect(md).toContain('## Sources')
    expect(md).toContain('RAG Paper')
    expect(md).toContain('## Notes')
    expect(md).toContain('Interesting papers here.')
    expect(md).toContain('Verify all sources against originals')
  })

  it('exportSessionMarkdown renders (none) when notes is empty string', () => {
    const session: SavedResearchSession = { ...baseSession, notes: '' }
    const md = exportSessionMarkdown(session)
    expect(md).toContain('## Notes')
    expect(md).toContain('(none)')
  })

  // ── Uploaded PDF session integration ────────────────────────────────────────

  it('createSessionFromCurrentState sets provenance to uploaded-pdf for uploaded items', () => {
    const uploadedItem: RankedResearchItem = {
      ...rankedItem,
      id: 'uploaded-pdf-123',
      importedFrom: 'uploaded-pdf',
      url: '#uploaded-pdf',
      audit: { ...rankedItem.audit, provenance: 'local-seed' },
    }
    const session = createSessionFromCurrentState(
      'machine learning',
      [uploadedItem],
      null,
      'fallback',
      deterministicAnswer,
      defaultFilters,
      '',
    )
    const uploadedSource = session.sources.find(s => s.id === 'uploaded-pdf-123')
    expect(uploadedSource).toBeDefined()
    expect(uploadedSource!.provenance).toBe('uploaded-pdf')
  })

  it('createSessionFromCurrentState sets uploadedPDFLabel on uploaded-pdf sources', () => {
    const uploadedItem: RankedResearchItem = {
      ...rankedItem,
      id: 'uploaded-pdf-456',
      importedFrom: 'uploaded-pdf',
      url: '#uploaded-pdf',
      audit: { ...rankedItem.audit, provenance: 'local-seed' },
    }
    const session = createSessionFromCurrentState(
      'test query',
      [uploadedItem],
      null,
      'fallback',
      deterministicAnswer,
      defaultFilters,
      '',
    )
    const src = session.sources.find(s => s.id === 'uploaded-pdf-456')
    expect(src?.uploadedPDFLabel).toBe('Uploaded PDF — Not independently verified')
  })

  it('createSessionFromCurrentState does not store blob: URL in session', () => {
    const uploadedItem: RankedResearchItem = {
      ...rankedItem,
      id: 'uploaded-pdf-789',
      importedFrom: 'uploaded-pdf',
      url: 'blob:http://localhost/some-uuid',
      audit: { ...rankedItem.audit, provenance: 'local-seed' },
    }
    const session = createSessionFromCurrentState(
      'test query',
      [uploadedItem],
      null,
      'fallback',
      deterministicAnswer,
      defaultFilters,
      '',
    )
    const src = session.sources.find(s => s.id === 'uploaded-pdf-789')
    expect(src?.url).not.toMatch(/^blob:/)
    expect(src?.url).toBe('#uploaded-pdf')
  })

  it('serialized session does not include huge raw text fields (> 5000 chars)', () => {
    const session = createSessionFromCurrentState(
      'machine learning',
      [rankedItem],
      null,
      'fallback',
      deterministicAnswer,
      defaultFilters,
      '',
    )
    const serialized = JSON.stringify(session)
    // Find any string field > 5000 chars — there should be none
    const hasHugeField = JSON.parse(serialized).sources.some((s: Record<string, unknown>) =>
      Object.values(s).some(v => typeof v === 'string' && v.length > 5000)
    )
    expect(hasHugeField).toBe(false)
  })
})
