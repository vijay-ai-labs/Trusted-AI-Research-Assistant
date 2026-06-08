// V1.8: API key is no longer read here. Calls route through /api/openai/pdf-analysis
// and /api/openalex/doi/* (backend proxy). Local-dev fallback uses VITE_OPENAI_API_KEY
// only when proxy is unreachable and import.meta.env.DEV === true. Never runs in production.

import type { ResearchItem, PDFAnalysisResult, UploadedPDFState } from '../../research'
import { searchOpenAlex } from './openalexService'

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions'
const TIMEOUT_MS = 30_000
const PROXY_PDF = '/api/openai/pdf-analysis'
const PROXY_PDF_TIMEOUT_MS = 31_000
const PROXY_DOI_BASE = '/api/openalex/doi'

const FALLBACK_RESULT: PDFAnalysisResult = {
  title: null,
  authors: [],
  year: null,
  doi: null,
  researchQuestion: '',
  methodology: '',
  datasetOrSample: '',
  keyFindings: [],
  limitations: [],
  importantQuotesOrClaims: [],
  relatedKeywords: [],
  summaryForPhDStudent: '',
  confidence: 'insufficient',
}

const SYSTEM_PROMPT = `You are a rigorous academic paper analyst. Analyze ONLY the provided PDF text excerpt.

STRICT RULES:
- Use ONLY the provided text. Do NOT use your training knowledge to fill gaps.
- Do NOT invent or guess title, authors, year, DOI, or any metadata not visible in the text.
- If a field cannot be determined from the text, return null (for strings/numbers) or [] (for arrays) or "".
- If the text contains a truncation note, state that extraction was incomplete in summaryForPhDStudent.
- Do not claim results are complete or comprehensive.
- Keep confidence accurate: "high" only if title/authors/abstract are all clearly present; "medium" if some metadata is missing; "low" if text is fragmentary; "insufficient" if text is too short or garbled to analyze.

Return ONLY valid JSON matching this exact schema:
{
  "title": string | null,
  "authors": string[],
  "year": number | null,
  "doi": string | null,
  "researchQuestion": string,
  "methodology": string,
  "datasetOrSample": string,
  "keyFindings": string[],
  "limitations": string[],
  "importantQuotesOrClaims": string[],
  "relatedKeywords": string[],
  "summaryForPhDStudent": string,
  "confidence": "high" | "medium" | "low" | "insufficient"
}`

function parsePDFAnalysisResponse(raw: string): PDFAnalysisResult | null {
  let parsed: Partial<PDFAnalysisResult>
  try {
    parsed = JSON.parse(raw) as Partial<PDFAnalysisResult>
  } catch {
    return null
  }

  return {
    title: parsed.title ?? null,
    authors: Array.isArray(parsed.authors) ? parsed.authors : [],
    year: typeof parsed.year === 'number' ? parsed.year : null,
    doi: parsed.doi ?? null,
    researchQuestion: parsed.researchQuestion ?? '',
    methodology: parsed.methodology ?? '',
    datasetOrSample: parsed.datasetOrSample ?? '',
    keyFindings: Array.isArray(parsed.keyFindings) ? parsed.keyFindings : [],
    limitations: Array.isArray(parsed.limitations) ? parsed.limitations : [],
    importantQuotesOrClaims: Array.isArray(parsed.importantQuotesOrClaims) ? parsed.importantQuotesOrClaims : [],
    relatedKeywords: Array.isArray(parsed.relatedKeywords) ? parsed.relatedKeywords : [],
    summaryForPhDStudent: parsed.summaryForPhDStudent ?? '',
    confidence: (['high', 'medium', 'low', 'insufficient'] as const).includes(parsed.confidence as 'high')
      ? parsed.confidence!
      : 'insufficient',
  }
}

// Calls the backend proxy. Returns null if proxy is unavailable or errors.
async function analyzeViaProxy(extractedText: string): Promise<PDFAnalysisResult | null> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), PROXY_PDF_TIMEOUT_MS)
  try {
    const response = await fetch(PROXY_PDF, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      // No API key in request body — key is server-side only
      body: JSON.stringify({ text: extractedText }),
    })
    clearTimeout(timeoutId)
    if (!response.ok) return null
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
    const raw = data.choices?.[0]?.message?.content ?? ''
    return parsePDFAnalysisResponse(raw)
  } catch {
    clearTimeout(timeoutId)
    return null
  }
}

// LOCAL DEV ONLY — direct OpenAI call when proxy is unreachable.
// Never runs in production.
async function analyzePDFDirect(extractedText: string, apiKey: string): Promise<PDFAnalysisResult | null> {
  const userMessage = `Analyze the following PDF text and return a JSON object matching the specified schema. Do NOT use outside knowledge — only analyze what is explicitly written below.\n\n--- PDF TEXT START ---\n${extractedText}\n--- PDF TEXT END ---`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.1,
        max_tokens: 1500,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
      }),
    })
    clearTimeout(timeout)
    if (!response.ok) return null
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
    const raw = data.choices?.[0]?.message?.content ?? ''
    return parsePDFAnalysisResponse(raw)
  } catch {
    clearTimeout(timeout)
    return null
  }
}

export async function analyzePDFText(
  extractedText: string,
  apiKey: string,
): Promise<PDFAnalysisResult> {
  if (!extractedText.trim()) return { ...FALLBACK_RESULT }

  // Step 1: Try backend proxy
  const proxyResult = await analyzeViaProxy(extractedText)
  if (proxyResult !== null) return proxyResult

  // Step 2: LOCAL DEV ONLY fallback — direct OpenAI call when proxy unreachable.
  // This path should never execute in production.
  if (import.meta.env.DEV && apiKey) {
    const directResult = await analyzePDFDirect(extractedText, apiKey)
    if (directResult !== null) return directResult
  }

  return { ...FALLBACK_RESULT }
}

function diceCoefficient(a: string, b: string): number {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim()
  const bigrams = (s: string): Set<string> => {
    const set = new Set<string>()
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2))
    return set
  }
  const na = normalize(a)
  const nb = normalize(b)
  if (!na || !nb) return 0
  const ba = bigrams(na)
  const bb = bigrams(nb)
  let intersection = 0
  for (const bg of ba) { if (bb.has(bg)) intersection++ }
  return (2 * intersection) / (ba.size + bb.size)
}

export async function enrichWithOpenAlex(
  analysis: PDFAnalysisResult,
): Promise<{ enriched: Partial<ResearchItem> | null; label: string }> {
  const noMatch = { enriched: null, label: 'OpenAlex match not found' }

  // Try DOI lookup first — routed through backend proxy
  if (analysis.doi) {
    const cleanDoi = analysis.doi.replace(/^https?:\/\/doi\.org\//, '')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    try {
      const resp = await fetch(
        `${PROXY_DOI_BASE}/${encodeURIComponent(cleanDoi)}`,
        { signal: controller.signal },
      )
      clearTimeout(timeout)
      if (resp.ok) {
        const work = await resp.json() as {
          doi?: string | null
          publication_year?: number | null
          cited_by_count?: number
          authorships?: Array<{ author: { display_name: string } }>
        }
        const enriched: Partial<ResearchItem> = {}
        if (work.doi) enriched.doi = work.doi.replace(/^https?:\/\/doi\.org\//, '')
        if (work.publication_year) enriched.year = work.publication_year
        if (work.cited_by_count !== undefined) enriched.citationCount = work.cited_by_count
        if (work.authorships?.length) {
          enriched.authors = work.authorships.slice(0, 5).map((a) => a.author.display_name)
        }
        return { enriched, label: 'Uploaded PDF enriched with OpenAlex metadata' }
      }
    } catch {
      clearTimeout(timeout)
    }
  }

  // Try title search — searchOpenAlex already uses proxy internally
  if (analysis.title) {
    const result = await searchOpenAlex(analysis.title)
    if (result.status === 'success' && result.items.length > 0) {
      const top = result.items[0]
      const score = diceCoefficient(analysis.title, top.title)
      if (score >= 0.75) {
        const enriched: Partial<ResearchItem> = {}
        if (top.doi) enriched.doi = top.doi
        if (top.year) enriched.year = top.year
        if (top.citationCount !== undefined) enriched.citationCount = top.citationCount
        if (top.authors.length) enriched.authors = top.authors
        return { enriched, label: 'Uploaded PDF enriched with OpenAlex metadata' }
      }
    }
  }

  return noMatch
}

export function buildResearchItem(
  state: UploadedPDFState,
  enrichment: Partial<ResearchItem> | null,
): ResearchItem {
  const analysis = state.analysis!
  const confidence = analysis.confidence

  const normalizationConfidence =
    confidence === 'high' ? 0.8 :
    confidence === 'medium' ? 0.5 :
    confidence === 'low' ? 0.3 : 0.1

  const base: ResearchItem = {
    id: `uploaded-pdf-${Date.now()}`,
    title: analysis.title ?? state.fileName,
    sourceType: 'paper',
    sourceName: 'Uploaded PDF',
    url: state.objectUrl ?? '#uploaded-pdf',
    year: analysis.year ?? 0,
    authors: analysis.authors.length ? analysis.authors : ['Unknown'],
    domainTags: analysis.relatedKeywords.slice(0, 3),
    abstractOrClaim: analysis.summaryForPhDStudent || analysis.researchQuestion || 'No summary extracted.',
    citationCount: 0,
    peerReviewed: false,
    verifiedByHuman: false,
    retracted: false,
    region: 'global',
    trustNotes: 'User-provided source. Not independently verified. Analysis generated from extracted PDF text.',
    doi: analysis.doi ?? undefined,
    importedFrom: 'uploaded-pdf',
    normalizationConfidence,
  }

  if (!enrichment) return base

  return {
    ...base,
    ...(enrichment.doi !== undefined && { doi: enrichment.doi }),
    ...(enrichment.year !== undefined && enrichment.year > 0 && { year: enrichment.year }),
    ...(enrichment.authors !== undefined && enrichment.authors.length > 0 && { authors: enrichment.authors }),
    ...(enrichment.citationCount !== undefined && { citationCount: enrichment.citationCount }),
  }
}

// Exported for test access
export { SYSTEM_PROMPT }
