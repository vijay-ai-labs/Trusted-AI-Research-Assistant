import { describe, expect, it } from 'vitest'
import {
  type CitableSource,
  formatAllCitations,
  formatCitation,
} from './citationService'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const seedItem: CitableSource = {
  title: 'Attention Is All You Need',
  authors: ['Ashish Vaswani', 'Noam Shazeer', 'Niki Parmar', 'Jakob Uszkoreit',
            'Llion Jones', 'Aidan Gomez', 'Lukasz Kaiser', 'Illia Polosukhin'],
  year: 2017,
  sourceName: 'NeurIPS 2017',
  sourceType: 'paper',
  url: 'https://arxiv.org/abs/1706.03762',
  doi: '10.48550/arXiv.1706.03762',
  trustNotes: 'Foundational transformer paper.',
}

const openAlexItem: CitableSource = {
  title: 'GPT-4 Technical Report',
  authors: ['OpenAI'],
  year: 2023,
  sourceName: 'OpenAI',
  sourceType: 'report',
  url: 'https://arxiv.org/abs/2303.08774',
  doi: 'https://doi.org/10.48550/arXiv.2303.08774',
  trustNotes: 'Industry technical report.',
}

const govItem: CitableSource = {
  title: 'EU Artificial Intelligence Act',
  authors: ['WHO', 'UNESCO'],
  year: 2024,
  sourceName: 'World Health Organization',
  sourceType: 'government',
  url: 'https://eur-lex.europa.eu/ai-act',
  trustNotes: 'Official legislation.',
}

const specialCharsItem: CitableSource = {
  title: 'Learning & Inference: cost_benefit at $scale',
  authors: ['Smith, James'],
  year: 2022,
  sourceName: 'Proc. of the 50% Conference',
  sourceType: 'paper',
  url: 'https://example.com/paper',
  trustNotes: '',
}

const noDoiItem: CitableSource = {
  title: 'NIST AI Risk Management Framework',
  authors: ['NIST'],
  year: 2023,
  sourceName: 'NIST',
  sourceType: 'standard',
  url: 'https://nvlpubs.nist.gov/nistpubs/ai/nist.ai.100-1.pdf',
}

const twoAuthorItem: CitableSource = {
  title: 'Neural Networks for Text Classification',
  authors: ['Kim, Yoon', 'Manning, Christopher D.'],
  year: 2014,
  sourceName: 'ACL 2014',
  sourceType: 'paper',
  url: 'https://example.com/kim2014',
  doi: '10.18653/v1/P14-1000',
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('citationService', () => {
  // 1. APA: 8-author → first 6 + ellipsis + last
  it('formats APA with 8 authors using first-6 ellipsis rule', () => {
    const result = formatCitation(seedItem, 'APA')
    // Must contain first author
    expect(result).toContain('Vaswani')
    // Must contain ellipsis marker
    expect(result).toContain('. . .')
    // Must contain last author
    expect(result).toContain('Polosukhin')
    // Must NOT list all 8 with ampersand (that would be the ≤7 rule)
    expect(result).not.toContain('Kaiser, L., &')
  })

  // 2. APA: org author used as-is
  it('formats APA with org author without appending initials', () => {
    const result = formatCitation(openAlexItem, 'APA')
    expect(result).toContain('OpenAI')
    // No comma after org name (which would indicate "Last, I." formatting)
    expect(result).not.toMatch(/OpenAI,\s+[A-Z]\./)
  })

  // 3. APA: bare DOI prefixed to https://doi.org/
  it('formats APA with bare doi prefixed to full URL', () => {
    const result = formatCitation(seedItem, 'APA')
    expect(result).toContain('https://doi.org/10.48550/arXiv.1706.03762')
  })

  // 4. APA: already-URL doi unchanged
  it('formats APA with already-URL doi used as-is', () => {
    const result = formatCitation(openAlexItem, 'APA')
    expect(result).toContain('https://doi.org/10.48550/arXiv.2303.08774')
    // Must not double-prefix
    expect(result).not.toContain('https://doi.org/https://')
  })

  // 5. BibTeX: entry type mapping
  it('produces correct BibTeX entry type for each source type', () => {
    const paperResult = formatCitation(seedItem, 'BibTeX')
    expect(paperResult).toMatch(/^@article\{/)

    const reportResult = formatCitation(openAlexItem, 'BibTeX')
    expect(reportResult).toMatch(/^@techreport\{/)

    const datasetItem: CitableSource = { ...seedItem, sourceType: 'dataset' }
    const datasetResult = formatCitation(datasetItem, 'BibTeX')
    expect(datasetResult).toMatch(/^@misc\{/)
  })

  // 6. BibTeX: key from first author last name + year + first significant title word
  it('builds correct BibTeX key from author/year/title', () => {
    // seedItem: first author "Ashish Vaswani" → last "vaswani", year 2017, title "Attention Is All You Need"
    // significant word: "attention" (skip stop words "is", "all", "you", "need")
    const result = formatCitation(seedItem, 'BibTeX')
    expect(result).toContain('vaswani2017attention')
  })

  // 7. BibTeX: special characters are escaped
  it('escapes & % $ # _ in BibTeX title', () => {
    const result = formatCitation(specialCharsItem, 'BibTeX')
    expect(result).toContain('\\&')
    expect(result).toContain('\\%')
    expect(result).toContain('\\$')
    expect(result).toContain('\\_')
  })

  // 8. MLA: two org authors joined with ", and "
  it('formats MLA with two org authors using "and" conjunction', () => {
    const result = formatCitation(govItem, 'MLA')
    expect(result).toContain('WHO')
    expect(result).toContain('and')
    expect(result).toContain('UNESCO')
  })

  // 9. Chicago: org author, no DOI → uses URL
  it('formats Chicago with org author and url when no doi present', () => {
    const result = formatCitation(noDoiItem, 'Chicago')
    expect(result).toContain('NIST')
    expect(result).toContain('https://nvlpubs.nist.gov')
    expect(result).not.toContain('doi.org')
  })

  // 10. formatAllCitations: N citations separated by blank line
  it('formatAllCitations returns all citations separated by blank line', () => {
    const result = formatAllCitations([seedItem, openAlexItem, govItem], 'APA')
    const parts = result.split('\n\n')
    expect(parts).toHaveLength(3)
    expect(parts[0]).toContain('Vaswani')
    expect(parts[1]).toContain('OpenAI')
    expect(parts[2]).toContain('WHO')
  })
})
