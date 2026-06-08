import type { ResearchItem } from '../../research'
import type { SynthesisSource } from './openaiSynthesisService'

export interface CitableSource {
  title: string
  authors: string[]
  year: number
  sourceName: string
  sourceType: string
  url: string
  doi?: string
  trustNotes?: string
}

export type CitationFormat = 'APA' | 'BibTeX' | 'MLA' | 'Chicago'

export function fromResearchItem(item: ResearchItem): CitableSource {
  // blob: URLs are local-only and meaningless in citations; replace with DOI URL or placeholder
  const safeUrl =
    item.url.startsWith('blob:')
      ? (item.doi ? `https://doi.org/${item.doi}` : '#uploaded-pdf')
      : item.url
  return {
    title: item.title,
    authors: item.authors,
    year: item.year,
    sourceName: item.sourceName,
    sourceType: item.sourceType,
    url: safeUrl,
    doi: item.doi,
    trustNotes: item.trustNotes,
  }
}

export function fromSynthesisSource(source: SynthesisSource): CitableSource {
  return {
    title: source.title,
    authors: source.authors,
    year: source.year,
    sourceName: source.sourceName,
    sourceType: source.sourceType,
    url: source.url,
    doi: source.doi,
    trustNotes: source.trustNotes,
  }
}

// ── Author parsing ────────────────────────────────────────────────────────────

interface ParsedAuthor {
  last: string
  initials: string
  isOrg: boolean
}

function formatInitials(firstName: string): string {
  return firstName
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((w) => {
      const letter = w.replace(/[^A-Za-z]/g, '')[0]
      return letter ? letter.toUpperCase() + '.' : ''
    })
    .filter(Boolean)
    .join(' ')
}

function parseAuthor(raw: string): ParsedAuthor {
  const trimmed = raw.trim()
  if (!trimmed) return { last: 'Unknown', initials: '', isOrg: true }

  // "Last, First" format
  const commaIdx = trimmed.indexOf(',')
  if (commaIdx !== -1) {
    const last = trimmed.slice(0, commaIdx).trim()
    const first = trimmed.slice(commaIdx + 1).trim()
    return { last, initials: formatInitials(first), isOrg: false }
  }

  const tokens = trimmed.split(/\s+/)

  // Single token — org if all-caps, contains digit, or very short
  if (tokens.length === 1) {
    const token = tokens[0]
    const isOrg = token === token.toUpperCase() || /\d/.test(token) || token.length < 3
    return { last: token, initials: '', isOrg }
  }

  // Multiple tokens — last token = last name, rest = first name
  const last = tokens[tokens.length - 1]
  const first = tokens.slice(0, -1).join(' ')
  return { last, initials: formatInitials(first), isOrg: false }
}

function formatApaAuthorSingle(parsed: ParsedAuthor): string {
  if (parsed.isOrg) return parsed.last
  if (!parsed.initials) return parsed.last
  return `${parsed.last}, ${parsed.initials}`
}

function formatApaAuthors(authors: string[]): string {
  if (authors.length === 0) return 'Unknown'

  const parsed = authors.map(parseAuthor)

  if (parsed.length === 1) return formatApaAuthorSingle(parsed[0])

  if (parsed.length <= 7) {
    const parts = parsed.map(formatApaAuthorSingle)
    const last = parts.pop()!
    return parts.join(', ') + ', & ' + last
  }

  // 8+ authors: first 6, ellipsis, last
  const first6 = parsed.slice(0, 6).map(formatApaAuthorSingle)
  const lastAuthor = formatApaAuthorSingle(parsed[parsed.length - 1])
  return first6.join(', ') + ', . . . ' + lastAuthor
}

// BibTeX author field uses "Last, First and Last2, First2"
function formatBibtexAuthorSingle(parsed: ParsedAuthor): string {
  if (parsed.isOrg) return `{${parsed.last}}`
  if (!parsed.initials) return parsed.last
  return `${parsed.last}, ${parsed.initials}`
}

function formatBibtexAuthors(authors: string[]): string {
  if (authors.length === 0) return 'Unknown'
  return authors.map(parseAuthor).map(formatBibtexAuthorSingle).join(' and ')
}

// MLA/Chicago: first author "Last, First", rest "First Last"
function formatMlaAuthorFirst(parsed: ParsedAuthor): string {
  if (parsed.isOrg) return parsed.last
  if (!parsed.initials) return parsed.last
  return `${parsed.last}, ${parsed.initials}`
}

function formatMlaAuthorSubsequent(parsed: ParsedAuthor): string {
  if (parsed.isOrg) return parsed.last
  if (!parsed.initials) return parsed.last
  return `${parsed.initials} ${parsed.last}`
}

function formatMlaAuthors(authors: string[]): string {
  if (authors.length === 0) return 'Unknown'
  const parsed = authors.map(parseAuthor)
  if (parsed.length === 1) return formatMlaAuthorFirst(parsed[0])
  if (parsed.length === 2) {
    return `${formatMlaAuthorFirst(parsed[0])}, and ${formatMlaAuthorSubsequent(parsed[1])}`
  }
  return `${formatMlaAuthorFirst(parsed[0])}, et al.`
}

function displayYear(year: number): string {
  return year > 0 ? String(year) : 'n.d.'
}

// ── DOI normalisation ─────────────────────────────────────────────────────────

function normaliseDoi(doi: string | undefined): string | undefined {
  if (!doi) return undefined
  if (doi.startsWith('https://') || doi.startsWith('http://')) return doi
  if (doi.startsWith('10.')) return `https://doi.org/${doi}`
  return undefined
}

// ── BibTeX helpers ────────────────────────────────────────────────────────────

const BIBTEX_STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for',
  'with', 'by', 'from', 'that', 'this', 'into', 'about', 'are', 'was', 'how', 'what',
])

export function buildBibtexKey(source: CitableSource): string {
  const firstRaw = source.authors[0] ?? ''
  const firstAuthorLast = firstRaw.trim() ? parseAuthor(firstRaw).last : 'unknown'
  const authorPart = firstAuthorLast.toLowerCase().replace(/[^a-z0-9]/g, '') || 'unknown'

  const yearPart = String(source.year)

  const titleWords = source.title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 0)

  const significantWord =
    titleWords.find((w) => !BIBTEX_STOP_WORDS.has(w) && w.length >= 4) ??
    titleWords.find((w) => !BIBTEX_STOP_WORDS.has(w) && w.length >= 2) ??
    titleWords[0] ??
    'untitled'

  return `${authorPart}${yearPart}${significantWord}`
}

function escapeBibtex(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/\$/g, '\\$')
    .replace(/#/g, '\\#')
    .replace(/_/g, '\\_')
}

function bibtexEntryType(sourceType: string): '@article' | '@techreport' | '@misc' {
  if (sourceType === 'paper' || sourceType === 'article') return '@article'
  if (sourceType === 'report' || sourceType === 'government' || sourceType === 'standard') return '@techreport'
  return '@misc'
}

// ── Format functions ──────────────────────────────────────────────────────────

export function formatApa(source: CitableSource): string {
  const authors = formatApaAuthors(source.authors)
  const link = normaliseDoi(source.doi) ?? source.url
  return `${authors} (${displayYear(source.year)}). ${source.title}. ${source.sourceName}. ${link}`
}

export function formatBibtex(source: CitableSource): string {
  const entryType = bibtexEntryType(source.sourceType)
  const key = buildBibtexKey(source)
  const authorField = formatBibtexAuthors(source.authors)
  const doiNorm = normaliseDoi(source.doi)

  const lines: string[] = [
    `${entryType}{${key},`,
    `  author    = {${escapeBibtex(authorField)}},`,
    `  title     = {${escapeBibtex(source.title)}},`,
    `  year      = {${displayYear(source.year)}},`,
  ]

  if (entryType === '@article') {
    lines.push(`  journal   = {${escapeBibtex(source.sourceName)}},`)
  } else if (entryType === '@techreport') {
    lines.push(`  institution = {${escapeBibtex(source.sourceName)}},`)
  }

  if (doiNorm) lines.push(`  doi       = {${doiNorm}},`)
  lines.push(`  url       = {${source.url}},`)
  if (source.trustNotes) lines.push(`  note      = {${escapeBibtex(source.trustNotes)}},`)

  lines.push('}')
  return lines.join('\n')
}

export function formatMla(source: CitableSource): string {
  const authors = formatMlaAuthors(source.authors)
  const link = normaliseDoi(source.doi) ?? source.url
  return `${authors}. "${source.title}." ${source.sourceName}, ${displayYear(source.year)}, ${link}.`
}

export function formatChicago(source: CitableSource): string {
  const parsed = source.authors.map(parseAuthor)
  let authors: string
  if (parsed.length === 0) {
    authors = 'Unknown'
  } else if (parsed.length === 1) {
    authors = formatMlaAuthorFirst(parsed[0])
  } else if (parsed.length === 2) {
    authors = `${formatMlaAuthorFirst(parsed[0])}, and ${formatMlaAuthorSubsequent(parsed[1])}`
  } else {
    authors = `${formatMlaAuthorFirst(parsed[0])}, et al.`
  }
  const link = normaliseDoi(source.doi) ?? source.url
  return `${authors}. ${displayYear(source.year)}. "${source.title}." ${source.sourceName}. ${link}`
}

export function formatCitation(source: CitableSource, format: CitationFormat): string {
  switch (format) {
    case 'APA': return formatApa(source)
    case 'BibTeX': return formatBibtex(source)
    case 'MLA': return formatMla(source)
    case 'Chicago': return formatChicago(source)
  }
}

export function formatAllCitations(sources: CitableSource[], format: CitationFormat): string {
  return sources.map((s) => formatCitation(s, format)).join('\n\n')
}
