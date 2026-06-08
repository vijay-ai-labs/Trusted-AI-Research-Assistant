// V1.8: API key is no longer read here. Calls route through /api/openai/synthesize
// (backend proxy). Local-dev fallback uses VITE_OPENAI_API_KEY only when proxy
// is unreachable and import.meta.env.DEV === true. Never runs in production.

import type { RankedResearchItem } from './researchEngine'
import type { AgentMode } from './agentModes'


export interface SynthesisSource {
  marker: string
  title: string
  authors: string[]
  year: number
  sourceName: string
  sourceType: string
  peerReviewed: boolean
  provenance: 'openalex' | 'local-seed' | 'uploaded-pdf'
  abstract: string
  trustNotes: string
  url: string
  doi?: string
}

export interface SynthesisResult {
  directAnswer: string
  detailedAnswer: string[]
  keyEvidence: string[]
  sourceComparison: string[]
  limitations: string[]
  researchUsefulness: string
  confidence: 'high' | 'medium' | 'low' | 'insufficient'
  sourcesUsed: SynthesisSource[]
  usedDeterministicFallback: boolean
  fallbackReason?: string
}

export type SynthesisStatus = 'idle' | 'loading' | 'ready' | 'fallback' | 'insufficient'

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions'
const OPENAI_MODEL = 'gpt-4o-mini'
const OPENAI_TIMEOUT_MS = 25000
const PROXY_SYNTHESIZE = '/api/openai/synthesize'
const PROXY_SYNTHESIZE_STREAM = '/api/openai/synthesize/stream'
const PROXY_TIMEOUT_MS = 27_000
const MAX_SOURCES = 10
const ABSTRACT_CHAR_LIMIT = 1500

const SYSTEM_PROMPT = `You are a PhD-level research synthesis assistant. Answer the user's question using ONLY the provided source excerpts. You MUST NOT use knowledge from your training data. Every important factual claim must be traceable to a source marker [S1], [S2], etc.

STRICT RULES:
1. Use ONLY the provided sources. No training data knowledge.
2. Every paragraph in detailedAnswer must include at least one inline citation [S1], [S2], etc. Not every sentence needs a citation, but every important claim must be traceable.
3. If sources lack sufficient information to answer confidently, set confidence to "insufficient" and directAnswer to: "The retrieved sources are insufficient to answer this confidently."
4. Do NOT speculate or add context not found in sources.
5. Use precise academic language. Focus on a highly thorough, detailed, and deep explanation covering background definitions, analysis of mechanisms, methodologies, findings, nuances, and arguments. Ensure the detailedAnswer is comprehensive and of the highest intellectual quality.

Respond with a single JSON object, no markdown, no code fences:
{
  "detailedAnswer": [
    "<paragraph 1: thorough background, core concepts, and definitions with citations>",
    "<paragraph 2: comprehensive analysis of mechanisms, methodologies, or findings with citations>",
    "<paragraph 3: detailed comparison of arguments, variants, or applications with citations>",
    "<paragraph 4+: deep dive into nuances, limitations, or research implications backed by sources with citations>"
  ],
  "directAnswer": "<2-4 sentence summary of key conclusions citing key sources>",
  "confidence": "high" | "medium" | "low" | "insufficient"
}`

const FOLLOWUP_SYSTEM_PROMPT = `You are a PhD-level research synthesis assistant. Answer the user's follow-up question using ONLY the provided source excerpts. You MUST NOT use knowledge from your training data. Every important factual claim must be traceable to a source marker [S1], [S2], etc.

STRICT RULES:
1. Use ONLY the provided sources. No training data knowledge.
2. Every important claim must include at least one inline citation [S1], [S2], etc.
3. Do NOT speculate or add context not found in sources.
4. Focus directly and precisely on answering the follow-up question. Do NOT repeat previous answers, re-introduce the topic, or summarize unrelated details. Answer the query exactly and directly using the sources.
5. Your response MUST be a detailed explanation (DETAIL) only. Remove all other sections and headers such as DIRECT, EVIDENCE, COMPARE:, LIMIT, or USEFUL. Do NOT use any section headers or prefixes like DIRECT:, DETAIL:, EVIDENCE:, COMPARE:, LIMIT:, USEFUL:, or CONFIDENCE:.
6. Respond with a single JSON object, no markdown wrapper around the JSON, no code fences:
{
  "content": "<your detailed markdown formatted explanation with inline citations>"
}`

const FOLLOWUP_STREAMING_SYSTEM_PROMPT = `You are a PhD-level research synthesis assistant. Answer the user's follow-up question using ONLY the provided source excerpts. You MUST NOT use knowledge from your training data. Every important factual claim must be traceable to a source marker [S1], [S2], etc.

STRICT RULES:
1. Use ONLY the provided sources. No training data knowledge.
2. Cite sources inline as [S1], [S2], etc. — every important claim must be traceable.
3. Do NOT speculate or add context not found in sources.
4. Focus directly and precisely on answering the follow-up question. Do NOT repeat previous answers, re-introduce the topic, or summarize unrelated details. Answer the query exactly and directly using the sources.
5. Your response MUST be a detailed explanation (DETAIL) only. Remove all other sections and headers such as DIRECT, EVIDENCE, COMPARE:, LIMIT, or USEFUL. Do NOT use any section headers or prefixes like DIRECT:, DETAIL:, EVIDENCE:, COMPARE:, LIMIT:, USEFUL:, or CONFIDENCE:.
6. Output your response as clean text/markdown with inline citations.`

export function selectTopSources(rankedItems: RankedResearchItem[], max = MAX_SOURCES): SynthesisSource[] {
  return rankedItems.slice(0, max).map((item, index) => ({
    marker: `S${index + 1}`,
    title: item.title,
    authors: item.authors,
    year: item.year,
    sourceName: item.sourceName,
    sourceType: item.sourceType,
    peerReviewed: item.peerReviewed,
    provenance: item.importedFrom === 'openalex' ? 'openalex' : 'local-seed',
    abstract:
      item.abstractOrClaim.length > ABSTRACT_CHAR_LIMIT
        ? item.abstractOrClaim.slice(0, ABSTRACT_CHAR_LIMIT) + '…'
        : item.abstractOrClaim,
    trustNotes: item.trustNotes,
    url: item.url,
    doi: item.doi,
  }))
}

function buildUserMessage(query: string, sources: SynthesisSource[]): string {
  const sourceBlocks = sources
    .map((s) => {
      const authorsStr = s.authors.length > 0 ? s.authors.join(', ') : 'Unknown'
      const peerReviewed = s.peerReviewed ? 'yes' : 'no'
      return [
        `[${s.marker}] Title: ${s.title} | Authors: ${authorsStr} | Year: ${s.year} | Venue: ${s.sourceName} | Provenance: ${s.provenance} | Peer-reviewed: ${peerReviewed}`,
        `Abstract: ${s.abstract}`,
        `Trust notes: ${s.trustNotes}`,
        `URL: ${s.url}`,
      ].join('\n')
    })
    .join('\n\n')

  return `Question: ${query}\n\nSources:\n${sourceBlocks}`
}

function buildDeterministicFallback(reason: string, sources: SynthesisSource[]): SynthesisResult {
  const topTitles = sources.slice(0, 3).map((s) => `[${s.marker}] ${s.title} (${s.year}).`)

  return {
    directAnswer: sources.length > 0
      ? `Based on ${sources.length} retrieved source${sources.length > 1 ? 's' : ''}, evidence-backed information is available. See key evidence points below.`
      : 'No sources available to synthesize an answer.',
    detailedAnswer: [],
    keyEvidence: topTitles,
    sourceComparison: [],
    limitations: [
      'This is a deterministic source summary, not an AI-generated synthesis.',
      'Verify claims with the original sources linked in the evidence trail.',
    ],
    researchUsefulness: 'Review the source cards on the right for provenance details.',
    confidence: sources.length >= 3 ? 'medium' : 'low',
    sourcesUsed: sources,
    usedDeterministicFallback: true,
    fallbackReason: reason,
  }
}

function parseSynthesisContent(content: string, sources: SynthesisSource[]): SynthesisResult | null {
  let parsed: {
    directAnswer: string
    detailedAnswer: string[]
    keyEvidence: string[]
    sourceComparison: string[]
    limitations: string[]
    researchUsefulness: string
    confidence: string
  }

  try {
    parsed = JSON.parse(content)
  } catch {
    return null
  }

  const confidence = ['high', 'medium', 'low', 'insufficient'].includes(parsed.confidence)
    ? (parsed.confidence as SynthesisResult['confidence'])
    : 'low'

  return {
    directAnswer: parsed.directAnswer ?? '',
    detailedAnswer: Array.isArray(parsed.detailedAnswer) ? parsed.detailedAnswer : [],
    keyEvidence: Array.isArray(parsed.keyEvidence) ? parsed.keyEvidence : [],
    sourceComparison: Array.isArray(parsed.sourceComparison) ? parsed.sourceComparison : [],
    limitations: Array.isArray(parsed.limitations) ? parsed.limitations : [],
    researchUsefulness: typeof parsed.researchUsefulness === 'string' ? parsed.researchUsefulness : '',
    confidence,
    sourcesUsed: sources,
    usedDeterministicFallback: false,
  }
}

// Calls the backend proxy. Returns null if proxy is unavailable or returns an error.
async function callViaProxy(
  query: string,
  sources: SynthesisSource[],
  history?: Array<{ role: 'user' | 'assistant'; content: string }>,
  isFollowup?: boolean,
  mode?: AgentMode,
): Promise<SynthesisResult | null> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS)
  try {
    const response = await fetch(PROXY_SYNTHESIZE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // No API key in request body — key is server-side only
      body: JSON.stringify({ query, sources, history, isFollowup, mode }),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    if (!response.ok) return null
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
    const content: string = data.choices?.[0]?.message?.content ?? ''

    if (isFollowup) {
      try {
        const parsed = JSON.parse(content) as { content?: string }
        if (parsed && typeof parsed.content === 'string') {
          return {
            directAnswer: parsed.content,
            detailedAnswer: [],
            keyEvidence: [],
            sourceComparison: [],
            limitations: [],
            researchUsefulness: '',
            confidence: 'high',
            sourcesUsed: sources,
            usedDeterministicFallback: false,
          }
        }
      } catch {
        // Fallback to normal parsing if not follow-up JSON schema
      }
    }

    return parseSynthesisContent(content, sources)
  } catch {
    clearTimeout(timeoutId)
    return null
  }
}

// LOCAL DEV ONLY — direct OpenAI call when proxy is unreachable.
// Never runs in production.
async function callOpenAIDirectly(
  query: string,
  sources: SynthesisSource[],
  apiKey: string,
  history?: Array<{ role: 'user' | 'assistant'; content: string }>,
  isFollowup?: boolean,
  mode?: AgentMode,
): Promise<SynthesisResult | null> {
  const userMessage = buildUserMessage(query, sources)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS)

  const systemPrompt = isFollowup ? FOLLOWUP_SYSTEM_PROMPT : SYSTEM_PROMPT
  const formattedHistory = history ? history.map(msg => ({ role: msg.role, content: msg.content })) : []

  try {
    const response = await fetch(OPENAI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          ...formattedHistory,
          { role: 'user', content: userMessage },
        ],
        ...((!mode || mode === 'research-agent') && !isFollowup ? { response_format: { type: 'json_object' } } : {}),
        temperature: 0.1,
        max_tokens: mode === 'ai-search' ? 1200 : mode === 'literature-review' ? 4000 : mode === 'deep-research-report' ? 6000 : mode === 'chat-with-pdf' ? 2000 : 2500,
      }),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    if (!response.ok) return null
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
    const content: string = data.choices?.[0]?.message?.content ?? ''

    if (isFollowup) {
      try {
        const parsed = JSON.parse(content) as { content?: string }
        if (parsed && typeof parsed.content === 'string') {
          return {
            directAnswer: parsed.content,
            detailedAnswer: [],
            keyEvidence: [],
            sourceComparison: [],
            limitations: [],
            researchUsefulness: '',
            confidence: 'high',
            sourcesUsed: sources,
            usedDeterministicFallback: false,
          }
        }
      } catch {
        // Fallback
      }
    }

    return parseSynthesisContent(content, sources)
  } catch {
    clearTimeout(timeoutId)
    return null
  }
}

// ─── Streaming synthesis ──────────────────────────────────────────────────────

export function parseStreamingText(text: string, sources: SynthesisSource[]): SynthesisResult {
  const directAnswer: string[] = []
  const detailedAnswer: string[] = []
  const keyEvidence: string[] = []
  const sourceComparison: string[] = []
  const limitations: string[] = []
  let researchUsefulness = ''
  let confidence: SynthesisResult['confidence'] = 'medium'

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    if (line.startsWith('DIRECT:')) {
      directAnswer.push(line.slice('DIRECT:'.length).trim())
    } else if (line.startsWith('SUMMARY:')) {
      directAnswer.push(line.slice('SUMMARY:'.length).trim())
    } else if (line.startsWith('DETAIL:')) {
      const val = line.slice('DETAIL:'.length).trim()
      if (val) detailedAnswer.push(val)
    } else if (line.startsWith('EVIDENCE:')) {
      const val = line.slice('EVIDENCE:'.length).trim()
      if (val) keyEvidence.push(val)
    } else if (line.startsWith('COMPARE:')) {
      const val = line.slice('COMPARE:'.length).trim()
      if (val) sourceComparison.push(val)
    } else if (line.startsWith('LIMIT:')) {
      const val = line.slice('LIMIT:'.length).trim()
      if (val) limitations.push(val)
    } else if (line.startsWith('USEFUL:')) {
      researchUsefulness = line.slice('USEFUL:'.length).trim()
    } else if (line.startsWith('CONFIDENCE:')) {
      const val = line.slice('CONFIDENCE:'.length).trim().toLowerCase()
      if (['high', 'medium', 'low', 'insufficient'].includes(val)) {
        confidence = val as SynthesisResult['confidence']
      }
    }
  }

  return {
    directAnswer: directAnswer.join(' '),
    detailedAnswer,
    keyEvidence,
    sourceComparison,
    limitations,
    researchUsefulness,
    confidence,
    sourcesUsed: sources,
    usedDeterministicFallback: false,
  }
}

export async function streamSynthesisAnswer(
  query: string,
  sources: SynthesisSource[],
  onChunk: (text: string) => void,
  onDone: (fullText: string) => void,
  onError: (err: Error) => void,
  signal?: AbortSignal,
  history?: Array<{ role: 'user' | 'assistant'; content: string }>,
  isFollowup?: boolean,
  mode?: AgentMode,
): Promise<void> {
  try {
    const response = await fetch(PROXY_SYNTHESIZE_STREAM, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, sources, history, isFollowup, mode }),
      signal,
    })

    if (!response.ok || !response.body) {
      onError(new Error(`Stream request failed: ${response.status}`))
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let fullText = ''

    while (true) {
      if (signal?.aborted) {
        reader.cancel().catch(() => {})
        return
      }
      const { done, value } = await reader.read()
      if (done) break
      if (signal?.aborted) {
        reader.cancel().catch(() => {})
        return
      }

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        if (trimmed === 'data: [DONE]') {
          onDone(fullText)
          return
        }
        if (!trimmed.startsWith('data: ')) continue
        try {
          const parsed = JSON.parse(trimmed.slice(6)) as { text?: string; error?: string }
          if (parsed.error) {
            onError(new Error(parsed.error))
            return
          }
          if (parsed.text) {
            fullText += parsed.text
            onChunk(parsed.text)
          }
        } catch {
          // skip malformed lines
        }
      }
    }

    // Stream ended without [DONE] — treat accumulated text as complete
    if (fullText) {
      onDone(fullText)
    } else {
      onError(new Error('Stream ended without generating text.'))
    }
  } catch (err) {
    const errorObject = err instanceof Error ? err : new Error(String(err))
    if (errorObject.name !== 'AbortError') {
      onError(errorObject)
    }
  }
}

export async function synthesizeAnswer(
  query: string,
  rankedItems: RankedResearchItem[],
  apiKey?: string | undefined,
  history?: Array<{ role: 'user' | 'assistant'; content: string }>,
  isFollowup?: boolean,
  mode?: AgentMode,
): Promise<SynthesisResult> {
  if (rankedItems.length === 0) {
    return buildDeterministicFallback('no-sources', [])
  }

  const sources = selectTopSources(rankedItems)

  // Step 1: Try backend proxy
  const proxyResult = await callViaProxy(query, sources, history, isFollowup, mode)
  if (proxyResult !== null) return proxyResult

  // Step 2: LOCAL DEV ONLY fallback — direct OpenAI call when proxy unreachable.
  // This path should never execute in production.
  if (import.meta.env.DEV && apiKey) {
    const directResult = await callOpenAIDirectly(query, sources, apiKey, history, isFollowup, mode)
    if (directResult !== null) return directResult
  }

  // Step 3: Deterministic fallback
  return buildDeterministicFallback('proxy-unavailable', sources)
}
