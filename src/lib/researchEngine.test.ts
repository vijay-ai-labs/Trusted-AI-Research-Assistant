import { describe, expect, it } from 'vitest'
import type { ResearchItem } from '../../research'
import {
  composeEvidenceAnswer,
  defaultFilters,
  explainSourceTrust,
  rankResearchItem,
  searchResearchItems,
  validateResearchItems,
} from './researchEngine'
import { formatCitation, fromResearchItem } from './citationService'

const baseItem: ResearchItem = {
  id: 'rag-2020',
  title: 'Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks',
  sourceType: 'paper',
  sourceName: 'NeurIPS',
  url: 'https://arxiv.org/abs/2005.11401',
  year: 2020,
  authors: ['Patrick Lewis'],
  domainTags: ['rag', 'retrieval', 'generation'],
  abstractOrClaim: 'Introduces retrieval augmented generation for knowledge intensive language tasks.',
  citationCount: 5000,
  peerReviewed: true,
  verifiedByHuman: true,
  retracted: false,
  region: 'global',
  trustNotes: 'Seed record used for local demo.',
}

describe('researchEngine', () => {
  it('flags copied human verification claims as warnings', () => {
    const [audited] = validateResearchItems([baseItem])

    expect(audited.audit.isUsable).toBe(true)
    expect(audited.audit.issues.some((issue) => issue.field === 'verifiedByHuman')).toBe(true)
  })

  it('catches duplicate IDs and invalid URLs', () => {
    const badItem = { ...baseItem, url: 'not-a-url' }
    const audited = validateResearchItems([badItem, badItem])

    expect(audited.every((item) => item.audit.isUsable === false)).toBe(true)
    expect(audited[0].audit.issues.some((issue) => issue.field === 'id')).toBe(true)
    expect(audited[0].audit.issues.some((issue) => issue.field === 'url')).toBe(true)
  })

  it('ranks matching local sources above unrelated records', () => {
    const unrelated = {
      ...baseItem,
      id: 'policy-1',
      title: 'Education Policy Framework',
      domainTags: ['education'],
      abstractOrClaim: 'A policy framework for schools.',
    }
    const audited = validateResearchItems([baseItem, unrelated])
    const results = searchResearchItems('retrieval augmented generation', defaultFilters, audited)

    expect(results[0].id).toBe('rag-2020')
    expect(results[0].matchedTerms).toContain('retrieval')
  })

  it('does not invent an answer when evidence is weak', () => {
    const audited = validateResearchItems([baseItem])
    const results = searchResearchItems('marine biology coral reefs', defaultFilters, audited)
    const answer = composeEvidenceAnswer('marine biology coral reefs', results)

    expect(answer.status).toBe('limited')
    expect(answer.headline).toContain('Limited evidence')
  })

  it('explainSourceTrust: peer-reviewed paper includes peer-review strength', () => {
    const [audited] = validateResearchItems([{ ...baseItem, peerReviewed: true }])
    const explanation = explainSourceTrust(audited)
    expect(explanation.strengths.some((s) => s.toLowerCase().includes('peer-reviewed'))).toBe(true)
  })

  it('explainSourceTrust: government sourceType includes authority strength', () => {
    const [audited] = validateResearchItems([{ ...baseItem, id: 'gov-1', sourceType: 'government' }])
    const explanation = explainSourceTrust(audited)
    expect(explanation.strengths.some((s) => s.includes('government'))).toBe(true)
  })

  it('explainSourceTrust: openalex source has correct provenanceLabel', () => {
    const [audited] = validateResearchItems([{ ...baseItem, id: 'oa-1', importedFrom: 'openalex' }])
    const explanation = explainSourceTrust(audited)
    expect(explanation.provenanceLabel).toBe('Live OpenAlex academic source')
  })

  it('explainSourceTrust: local seed has correct provenanceLabel and local-source warning', () => {
    const [audited] = validateResearchItems([{ ...baseItem, importedFrom: undefined }])
    const explanation = explainSourceTrust(audited)
    expect(explanation.provenanceLabel).toBe('Local curated demo source')
    expect(explanation.warnings.some((w) => w.toLowerCase().includes('local'))).toBe(true)
  })

  it('explainSourceTrust: retracted source leads warnings with retraction notice', () => {
    const [audited] = validateResearchItems([{ ...baseItem, id: 'ret-1', retracted: true }])
    const explanation = explainSourceTrust(audited)
    expect(explanation.warnings[0].toLowerCase()).toContain('retracted')
    expect(explanation.trustSummary.toLowerCase()).toContain('retracted')
  })

  it('explainSourceTrust: missing DOI and short abstract both appear in warnings', () => {
    const [audited] = validateResearchItems([{ ...baseItem, id: 'sparse-1', doi: undefined, abstractOrClaim: 'Too short.' }])
    const explanation = explainSourceTrust(audited)
    expect(explanation.warnings.some((w) => w.toLowerCase().includes('doi'))).toBe(true)
    expect(explanation.warnings.some((w) => w.toLowerCase().includes('abstract'))).toBe(true)
  })

  it('explainSourceTrust: full metadata not retracted yields metadataQuality strong', () => {
    const [audited] = validateResearchItems([{ ...baseItem, retracted: false }])
    const explanation = explainSourceTrust(audited)
    expect(explanation.metadataQuality).toBe('strong')
  })

  it('explainSourceTrust: sparse metadata yields metadataQuality weak', () => {
    // completeness fields: id, title, sourceName, url, year, authors.length, domainTags.length, abstractOrClaim, trustNotes
    // 4/9 truthy → 0.44 → weak
    const sparseItem: ResearchItem = {
      ...baseItem,
      id: 'weak-1',
      year: 0,
      authors: [],
      domainTags: [],
      abstractOrClaim: '',
      trustNotes: '',
    }
    const audited = validateResearchItems([sparseItem])
    const explanation = explainSourceTrust(audited[0])
    expect(explanation.metadataQuality).toBe('weak')
  })

  it('citation formatting still works on a RankedResearchItem via fromResearchItem', () => {
    const [audited] = validateResearchItems([baseItem])
    const ranked = rankResearchItem(audited, 'retrieval augmented generation')
    const citable = fromResearchItem(ranked)
    const apa = formatCitation(citable, 'APA')
    expect(apa).toContain('Lewis')
    expect(apa).toContain('2020')
  })
})
