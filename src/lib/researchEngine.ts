import type { Region, ResearchItem, SourceType } from '../../research'

export type ValidationSeverity = 'info' | 'warning' | 'error'

export interface ValidationIssue {
  severity: ValidationSeverity
  field: string
  message: string
}

export interface AuditedResearchItem extends ResearchItem {
  audit: {
    provenance: 'local-seed' | 'openalex'
    label: string
    issues: ValidationIssue[]
    completeness: number
    hasWarnings: boolean
    isUsable: boolean
  }
}

export interface ResearchFilters {
  sourceTypes: SourceType[]
  peerReviewed: 'any' | 'yes' | 'no'
  verification: 'any' | 'claims-verified' | 'needs-review'
  region: Region | 'any'
  yearFrom: number
  yearTo: number
  warnings: 'any' | 'hide-warning'
}

export interface RankedResearchItem extends AuditedResearchItem {
  relevance: number
  trustSignal: number
  totalScore: number
  matchedTerms: string[]
}

export interface EvidenceAnswer {
  status: 'ready' | 'limited' | 'empty'
  headline: string
  summary: string
  keyPoints: string[]
  caveats: string[]
  citedItems: RankedResearchItem[]
}

export interface TrustExplanation {
  strengths: string[]
  warnings: string[]
  metadataQuality: 'strong' | 'moderate' | 'weak'
  provenanceLabel: string
  trustSummary: string
}

export const sourceTypes: SourceType[] = [
  'paper',
  'government',
  'legal',
  'standard',
  'dataset',
  'article',
  'report',
  'documentation',
]

export const sourceTypeLabels: Record<SourceType, string> = {
  paper: 'Peer-reviewed and academic papers',
  government: 'Official and government sources',
  legal: 'Legal and policy documents',
  standard: 'Standards and frameworks',
  dataset: 'Datasets and statistical sources',
  article: 'Trusted articles',
  report: 'Institutional reports',
  documentation: 'Documentation',
}

const validRegions: Region[] = ['global', 'us', 'eu', 'uk', 'cn', 'in', 'other']
const currentYear = new Date().getFullYear()
const stopWords = new Set([
  'about',
  'and',
  'are',
  'data',
  'does',
  'for',
  'from',
  'how',
  'into',
  'research',
  'researcher',
  'researchers',
  'study',
  'studies',
  'the',
  'this',
  'what',
  'when',
  'where',
  'which',
  'with',
])

export const defaultFilters: ResearchFilters = {
  sourceTypes: [...sourceTypes],
  peerReviewed: 'any',
  verification: 'any',
  region: 'any',
  yearFrom: 1980,
  yearTo: currentYear,
  warnings: 'any',
}

export function validateResearchItems(items: ResearchItem[]): AuditedResearchItem[] {
  const seen = new Map<string, number>()

  items.forEach((item) => {
    seen.set(item.id, (seen.get(item.id) ?? 0) + 1)
  })

  return items.map((item) => {
    const issues: ValidationIssue[] = []

    requireText(item.id, 'id', issues)
    requireText(item.title, 'title', issues)
    requireText(item.sourceName, 'sourceName', issues)
    requireText(item.abstractOrClaim, 'abstractOrClaim', issues)
    requireText(item.trustNotes, 'trustNotes', issues)

    if ((seen.get(item.id) ?? 0) > 1) {
      issues.push({ severity: 'error', field: 'id', message: 'Duplicate source ID detected.' })
    }

    if (!sourceTypes.includes(item.sourceType)) {
      issues.push({ severity: 'error', field: 'sourceType', message: 'Unsupported source type.' })
    }

    if (!validRegions.includes(item.region)) {
      issues.push({ severity: 'warning', field: 'region', message: 'Unsupported or missing region label.' })
    }

    if (!isLikelyUrl(item.url)) {
      issues.push({ severity: 'error', field: 'url', message: 'URL is missing or not a valid HTTP(S)/DOI link.' })
    }

    if (!Number.isFinite(item.year) || item.year < 1800 || item.year > currentYear + 1) {
      issues.push({ severity: 'warning', field: 'year', message: 'Publication year needs review.' })
    }

    if (!Array.isArray(item.authors) || item.authors.length === 0) {
      issues.push({ severity: 'warning', field: 'authors', message: 'Author metadata is missing.' })
    }

    if (!Array.isArray(item.domainTags) || item.domainTags.length === 0) {
      issues.push({ severity: 'warning', field: 'domainTags', message: 'Domain tags are missing.' })
    }

    if (item.retracted) {
      issues.push({ severity: 'warning', field: 'retracted', message: 'Marked as retracted in local data.' })
    }

    if (item.verifiedByHuman) {
      issues.push({
        severity: 'info',
        field: 'verifiedByHuman',
        message: 'Copied human-verification claim is not independently verified in this app.',
      })
    }

    const completenessFields = [
      item.id,
      item.title,
      item.sourceName,
      item.url,
      item.year,
      item.authors?.length,
      item.domainTags?.length,
      item.abstractOrClaim,
      item.trustNotes,
    ]
    const completeness = completenessFields.filter(Boolean).length / completenessFields.length
    const isUsable = !issues.some((issue) => issue.severity === 'error')

    const isLive = item.importedFrom === 'openalex'

    return {
      ...item,
      audit: {
        provenance: isLive ? 'openalex' : 'local-seed',
        label: isLive ? 'Live OpenAlex academic source' : 'Local curated demo source',
        issues,
        completeness,
        hasWarnings: issues.some((issue) => issue.severity !== 'info'),
        isUsable,
      },
    }
  })
}

export function searchResearchItems(
  query: string,
  filters: ResearchFilters,
  items: AuditedResearchItem[],
): RankedResearchItem[] {
  const terms = tokenize(query)
  const queryIsEmpty = terms.length === 0

  return items
    .filter((item) => item.audit.isUsable)
    .filter((item) => filters.sourceTypes.includes(item.sourceType))
    .filter((item) => filters.peerReviewed === 'any' || item.peerReviewed === (filters.peerReviewed === 'yes'))
    .filter((item) =>
      filters.verification === 'any'
        ? true
        : filters.verification === 'claims-verified'
          ? item.verifiedByHuman
          : !item.verifiedByHuman || item.audit.hasWarnings,
    )
    .filter((item) => filters.region === 'any' || item.region === filters.region)
    .filter((item) => item.year === 0 || (item.year >= filters.yearFrom && item.year <= filters.yearTo))
    .filter((item) => filters.warnings === 'any' || !item.audit.hasWarnings)
    .map((item) => rankResearchItem(item, terms, queryIsEmpty))
    .filter((item) => queryIsEmpty || item.relevance > 0)
    .sort((a, b) => b.totalScore - a.totalScore)
}

export function rankResearchItem(
  item: AuditedResearchItem,
  termsOrQuery: string[] | string,
  queryIsEmpty = false,
): RankedResearchItem {
  const terms = Array.isArray(termsOrQuery) ? termsOrQuery : tokenize(termsOrQuery)
  const haystack = buildSearchText(item)
  const matchedTerms = terms.filter((term) => haystack.includes(term))
  const titleText = normalize(item.title)
  const tagText = normalize(item.domainTags.join(' '))
  const abstractText = normalize(item.abstractOrClaim)

  const relevance = queryIsEmpty
    ? 1
    : terms.reduce((score, term) => {
        if (titleText.includes(term)) return score + 9
        if (tagText.includes(term)) return score + 6
        if (abstractText.includes(term)) return score + 4
        if (haystack.includes(term)) return score + 2
        return score
      }, 0)

  const trustSignal =
    (item.peerReviewed ? 12 : 0) +
    (['government', 'legal', 'standard'].includes(item.sourceType) ? 12 : 0) +
    (item.retracted ? -25 : 8) +
    item.audit.completeness * 8 +
    Math.min(Math.log10(Math.max(item.citationCount, 0) + 1) * 4, 18) +
    Math.max(0, Math.min(8, (item.year - 2000) / 3))

  return {
    ...item,
    relevance,
    trustSignal,
    totalScore: relevance * 10 + trustSignal,
    matchedTerms,
  }
}

export function groupSources(items: RankedResearchItem[]): Record<SourceType, RankedResearchItem[]> {
  return sourceTypes.reduce(
    (groups, type) => {
      groups[type] = items.filter((item) => item.sourceType === type)
      return groups
    },
    {} as Record<SourceType, RankedResearchItem[]>,
  )
}

export function composeEvidenceAnswer(query: string, rankedItems: RankedResearchItem[]): EvidenceAnswer {
  const topItems = rankedItems.slice(0, 5)
  const strongItems = topItems.filter((item) => item.relevance >= 6)

  if (!query.trim()) {
    return {
      status: 'empty',
      headline: 'Ask a research question to inspect the local evidence base.',
      summary:
        'This offline v1 searches a copied seed dataset after validation. It does not call OpenAI or live academic APIs.',
      keyPoints: ['Use the example questions or type your own topic.', 'Source cards on the right show provenance and warnings.'],
      caveats: ['The current source base is local demo data and should be verified before real academic use.'],
      citedItems: topItems,
    }
  }

  if (topItems.length === 0 || strongItems.length === 0) {
    return {
      status: 'limited',
      headline: 'Limited evidence found in the local dataset.',
      summary:
        'The offline seed data does not contain enough strong matches to answer this question confidently. Try broader terms or wait for the future live-source integration.',
      keyPoints: rankedItems.slice(0, 3).map((item) => `Closest local source: ${item.title} (${item.year}).`),
      caveats: [
        'No facts are generated beyond matched local source records.',
        'A future OpenAlex/government-source integration should verify or expand this result.',
      ],
      citedItems: topItems,
    }
  }

  const primary = topItems[0]
  const categories = [...new Set(topItems.map((item) => item.sourceType))]
  const keyPoints = topItems.slice(0, 4).map((item, index) => {
    const marker = `[S${index + 1}]`
    return `${marker} ${item.abstractOrClaim}`
  })

  return {
    status: 'ready',
    headline: `Source-backed answer for "${query.trim()}"`,
    summary: `${primary.title} is the strongest local match. Across ${topItems.length} matched sources, the evidence comes from ${categories
      .map((type) => type.replace('-', ' '))
      .join(', ')} records, with source cards available for inspection.`,
    keyPoints,
    caveats: [
      'This is deterministic offline synthesis from local seed records, not an LLM answer.',
      'Copied verification flags are displayed as claims and should be confirmed with live academic/government APIs later.',
    ],
    citedItems: topItems,
  }
}

export function getDataHealth(items: AuditedResearchItem[]) {
  const warningCount = items.filter((item) => item.audit.hasWarnings).length
  const errorCount = items.filter((item) => !item.audit.isUsable).length
  const sourceCount = items.length

  return {
    sourceCount,
    usableCount: sourceCount - errorCount,
    warningCount,
    errorCount,
  }
}

export function explainSourceTrust(item: AuditedResearchItem): TrustExplanation {
  const strengths: string[] = []
  const warnings: string[] = []

  const isOpenAlex = item.importedFrom === 'openalex'
  const provenanceLabel = isOpenAlex ? 'Live OpenAlex academic source' : 'Local curated demo source'

  if (item.retracted) {
    warnings.push(
      'This source has been marked as retracted. Do not rely on its findings without independent verification.',
    )
  }

  if (item.peerReviewed) {
    strengths.push('Published in a peer-reviewed venue, indicating editorial and expert review before publication.')
  }

  if (['government', 'legal', 'standard'].includes(item.sourceType)) {
    strengths.push(`Source type is "${item.sourceType}", which carries official or standards-body authority.`)
  }

  if (item.citationCount > 50) {
    strengths.push(
      `Cited ${item.citationCount} times — widely referenced in the field. High citation count is a signal of influence, not a proof of correctness.`,
    )
  } else if (item.citationCount > 10) {
    strengths.push(`Cited ${item.citationCount} times — moderate citation presence, suggesting some community uptake.`)
  }

  if (item.doi) {
    strengths.push('A DOI is present, allowing independent verification via doi.org.')
  }

  if (isOpenAlex) {
    strengths.push(
      'Metadata fetched live from OpenAlex. Fields such as citation count and authorship reflect current academic records, though interpretation remains your responsibility.',
    )
  }

  if (!item.doi) {
    warnings.push('No DOI recorded. Independent verification via a persistent identifier is not directly possible.')
  }

  if ((item.abstractOrClaim ?? '').trim().length < 50) {
    warnings.push(
      'Abstract or claim is missing or too short (<50 characters). Context for evaluating this source is limited.',
    )
  }

  if (!Array.isArray(item.authors) || item.authors.length === 0) {
    warnings.push('No author information available. Authorship cannot be attributed or verified.')
  }

  if (!Array.isArray(item.domainTags) || item.domainTags.length === 0) {
    warnings.push('No domain tags recorded. Topical relevance cannot be confirmed from metadata alone.')
  }

  if (!isOpenAlex) {
    warnings.push(
      'This is a local curated demo source. It has not been independently verified against a live academic or government database.',
    )
  }

  const metadataQuality: 'strong' | 'moderate' | 'weak' =
    item.audit.completeness >= 0.8 && !item.retracted ? 'strong' : item.audit.completeness >= 0.5 ? 'moderate' : 'weak'

  const retractedClause = item.retracted
    ? ' Note: this source has been marked as retracted and should not be used without further investigation.'
    : ''

  const qualityClause =
    metadataQuality === 'strong'
      ? 'Metadata completeness is strong.'
      : metadataQuality === 'moderate'
        ? 'Metadata completeness is moderate; some fields are missing.'
        : 'Metadata completeness is weak; treat this source with extra caution.'

  const provenanceClause = isOpenAlex
    ? 'Live OpenAlex metadata provides a traceable academic record.'
    : 'This is a local demo source and has not been independently verified.'

  const trustSummary =
    `${provenanceClause} ${qualityClause}${retractedClause} ` +
    `Strengths and warnings above reflect available metadata signals — ` +
    `they are not a guarantee of accuracy or reliability. Always verify claims against primary sources before citing.`

  return { strengths, warnings, metadataQuality, provenanceLabel, trustSummary }
}

function requireText(value: unknown, field: string, issues: ValidationIssue[]) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    issues.push({ severity: 'error', field, message: `${field} is required.` })
  }
}

function isLikelyUrl(value: string) {
  if (!value) return false
  if (value.startsWith('https://doi.org/')) return true

  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

function buildSearchText(item: ResearchItem) {
  return normalize(
    [
      item.title,
      item.sourceType,
      item.sourceName,
      item.category ?? '',
      item.region,
      item.authors.join(' '),
      item.domainTags.join(' '),
      item.abstractOrClaim,
      item.trustNotes,
    ].join(' '),
  )
}

function tokenize(query: string) {
  return normalize(query)
    .split(/\s+/)
    .filter((term) => term.length >= 2 && !stopWords.has(term))
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}
