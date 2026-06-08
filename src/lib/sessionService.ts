import type { ResearchFilters, RankedResearchItem, EvidenceAnswer } from './researchEngine'
import type { SynthesisResult, SynthesisStatus } from './openaiSynthesisService'
import type { CitationFormat } from './citationService'

export interface SavedSessionSource {
  id: string
  title: string
  authors: string[]
  year: number
  sourceName: string
  sourceType: string
  url: string
  doi?: string
  trustNotes: string
  peerReviewed: boolean
  provenance: 'local-seed' | 'openalex' | 'uploaded-pdf'
  uploadedPDFLabel?: string
}

export interface SavedSessionAnswer {
  directAnswer: string
  detailedAnswer: string[]
  keyEvidence: string[]
  sourceComparison: string[]
  limitations: string[]
  researchUsefulness: string
  confidence: 'high' | 'medium' | 'low' | 'insufficient'
  usedDeterministicFallback: boolean
  fallbackReason?: string
  deterministicHeadline?: string
  deterministicSummary?: string
  deterministicKeyPoints?: string[]
}

export interface SavedResearchSession {
  id: string
  schemaVersion: 1
  title: string
  query: string
  createdAt: string
  updatedAt: string
  answer: SavedSessionAnswer | null
  sources: SavedSessionSource[]
  citationFormat?: CitationFormat
  notes: string
  filters: ResearchFilters
}

interface SessionStorageState {
  schemaVersion: 1
  sessions: SavedResearchSession[]
}

const STORAGE_KEY = 'ai_research_sessions'

function generateId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  }
}

export function loadSessions(): SavedResearchSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as SessionStorageState
    if (!parsed || !Array.isArray(parsed.sessions)) return []
    return parsed.sessions
  } catch {
    return []
  }
}

function writeSessions(sessions: SavedResearchSession[]): void {
  const state: SessionStorageState = { schemaVersion: 1, sessions }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export function saveSession(session: SavedResearchSession): void {
  const sessions = loadSessions()
  writeSessions([...sessions, session])
}

export function updateSession(session: SavedResearchSession): void {
  const sessions = loadSessions()
  writeSessions(
    sessions.map(s =>
      s.id === session.id ? { ...session, updatedAt: new Date().toISOString() } : s,
    ),
  )
}

export function deleteSession(id: string): void {
  const sessions = loadSessions()
  writeSessions(sessions.filter(s => s.id !== id))
}

export function createSessionFromCurrentState(
  query: string,
  results: RankedResearchItem[],
  synthesisResult: SynthesisResult | null,
  synthesisStatus: SynthesisStatus,
  answer: EvidenceAnswer,
  filters: ResearchFilters,
  notes: string,
  citationFormat?: CitationFormat,
  existingId?: string,
): SavedResearchSession {
  const now = new Date().toISOString()
  const id = existingId ?? generateId()

  const existingCreatedAt = existingId
    ? (loadSessions().find(s => s.id === existingId)?.createdAt ?? now)
    : now

  const aiReady =
    (synthesisStatus === 'ready' || synthesisStatus === 'insufficient') &&
    synthesisResult !== null

  // Prefer AI-cited sources matched by URL; fall back to top 12 results
  const sourcesToSave: SavedSessionSource[] = (
    aiReady && synthesisResult!.sourcesUsed.length > 0
      ? results.filter(r => synthesisResult!.sourcesUsed.some(s => s.url === r.url))
      : results.slice(0, 12)
  ).map(item => {
    const isUploaded = item.importedFrom === 'uploaded-pdf'
    // Do not store blob: URLs or raw extracted text in sessions
    const safeUrl = item.url.startsWith('blob:') ? '#uploaded-pdf' : item.url
    const provenance: SavedSessionSource['provenance'] = isUploaded ? 'uploaded-pdf' : item.audit.provenance
    const src: SavedSessionSource = {
      id: item.id,
      title: item.title,
      authors: item.authors,
      year: item.year,
      sourceName: item.sourceName,
      sourceType: item.sourceType,
      url: safeUrl,
      doi: item.doi,
      trustNotes: item.trustNotes ?? '',
      peerReviewed: item.peerReviewed,
      provenance,
    }
    if (isUploaded) {
      src.uploadedPDFLabel = 'Uploaded PDF — Not independently verified'
    }
    return src
  })

  let savedAnswer: SavedSessionAnswer | null = null

  if (aiReady && synthesisResult) {
    savedAnswer = {
      directAnswer: synthesisResult.directAnswer,
      detailedAnswer: synthesisResult.detailedAnswer,
      keyEvidence: synthesisResult.keyEvidence,
      sourceComparison: synthesisResult.sourceComparison,
      limitations: synthesisResult.limitations,
      researchUsefulness: synthesisResult.researchUsefulness,
      confidence: synthesisResult.confidence,
      usedDeterministicFallback: false,
      fallbackReason: synthesisResult.fallbackReason,
    }
  } else if (answer.status !== 'empty') {
    savedAnswer = {
      directAnswer: answer.summary,
      detailedAnswer: [],
      keyEvidence: answer.keyPoints,
      sourceComparison: [],
      limitations: answer.caveats,
      researchUsefulness: '',
      confidence: answer.status === 'ready' ? 'medium' : 'low',
      usedDeterministicFallback: true,
      fallbackReason: synthesisResult?.fallbackReason,
      deterministicHeadline: answer.headline,
      deterministicSummary: answer.summary,
      deterministicKeyPoints: answer.keyPoints,
    }
  }

  const trimmed = query.trim()
  const title =
    trimmed.length > 0
      ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1, 60) + (trimmed.length > 60 ? '…' : '')
      : 'Untitled session'

  return {
    id,
    schemaVersion: 1,
    title,
    query,
    createdAt: existingCreatedAt,
    updatedAt: now,
    answer: savedAnswer,
    sources: sourcesToSave,
    citationFormat,
    notes,
    filters,
  }
}

export function exportSessionMarkdown(session: SavedResearchSession): string {
  const lines: string[] = []
  const dateStr = new Date(session.createdAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  lines.push(`# ${session.title}`)
  lines.push(`**Query:** ${session.query}`)
  lines.push(`**Saved:** ${dateStr}`)
  lines.push(`**Sessions stored:** Browser localStorage only`)
  lines.push('')

  if (session.answer) {
    lines.push('## Answer')
    lines.push('')

    if (!session.answer.usedDeterministicFallback) {
      lines.push('### Direct Answer')
      lines.push(session.answer.directAnswer)
      lines.push('')

      if (session.answer.detailedAnswer.length > 0) {
        lines.push('### Detailed Explanation')
        session.answer.detailedAnswer.forEach(p => {
          lines.push(p)
          lines.push('')
        })
      }

      if (session.answer.keyEvidence.length > 0) {
        lines.push('### Key Evidence')
        session.answer.keyEvidence.forEach(e => lines.push(`- ${e}`))
        lines.push('')
      }

      if (session.answer.sourceComparison.length > 0) {
        lines.push('### Source Comparison')
        session.answer.sourceComparison.forEach(c => lines.push(`- ${c}`))
        lines.push('')
      }

      if (session.answer.limitations.length > 0) {
        lines.push('### Limitations')
        session.answer.limitations.forEach(l => lines.push(`- ${l}`))
        lines.push('')
      }

      if (session.answer.researchUsefulness) {
        lines.push('### Research Usefulness')
        lines.push(session.answer.researchUsefulness)
        lines.push('')
      }
    } else {
      lines.push('### Direct Answer')
      lines.push(session.answer.deterministicSummary ?? session.answer.directAnswer)
      lines.push('')

      const keyPoints = session.answer.deterministicKeyPoints ?? []
      if (keyPoints.length > 0) {
        lines.push('### Key Evidence')
        keyPoints.forEach(p => lines.push(`- ${p}`))
        lines.push('')
      }

      if (session.answer.limitations.length > 0) {
        lines.push('### Limitations / Caveats')
        session.answer.limitations.forEach(l => lines.push(`- ${l}`))
        lines.push('')
      }
    }
  }

  lines.push('## Notes')
  lines.push(session.notes.trim() || '(none)')
  lines.push('')

  if (session.sources.length > 0) {
    lines.push('## Sources')
    session.sources.forEach((src, i) => {
      const authStr =
        src.authors.length === 0
          ? 'Unknown'
          : src.authors.slice(0, 3).join(', ') + (src.authors.length > 3 ? ' et al.' : '')
      lines.push(
        `${i + 1}. [S${i + 1}] ${src.title} (${src.year}) — ${authStr} — ${src.sourceName} [${src.provenance}]`,
      )
      if (src.url) lines.push(`   URL: ${src.url}`)
      if (src.doi) lines.push(`   DOI: ${src.doi}`)
      if (src.trustNotes) lines.push(`   Trust: ${src.trustNotes}`)
    })
    lines.push('')
  }

  lines.push('---')
  lines.push('*Verify all sources against originals. This export reflects a saved snapshot.*')

  return lines.join('\n')
}
