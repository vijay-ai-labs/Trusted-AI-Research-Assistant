import dotenv from 'dotenv'
dotenv.config({ override: true })  // .env values override any pre-set system env vars
import express, { type Request, type Response, type NextFunction } from 'express'
import cors from 'cors'

// ─── Configuration ────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 3001)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const OPENALEX_API_KEY = process.env.OPENALEX_API_KEY
const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions'
const OPENALEX_BASE = 'https://api.openalex.org'
const MAILTO = 'aiatozofficial@gmail.com'
const SELECT_FIELDS = [
  'id', 'display_name', 'publication_year', 'cited_by_count',
  'is_retracted', 'type', 'doi', 'open_access', 'authorships',
  'abstract_inverted_index', 'primary_location', 'topics', 'keywords',
].join(',')

// ─── Rate Limiter (in-memory placeholder — replace with redis in production) ──

const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const windowMs = 60_000
  const maxRequests = 60
  const entry = rateLimitMap.get(ip)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + windowMs })
    return true
  }
  if (entry.count >= maxRequests) return false
  entry.count++
  return true
}

function rateLimiter(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown'
  if (!checkRateLimit(ip)) {
    res.status(429).json({ error: 'Too many requests. Please slow down.' })
    return
  }
  next()
}

// ─── Prompts (copied verbatim from frontend services) ─────────────────────────

const SYNTHESIS_SYSTEM_PROMPT = `You are a PhD-level research synthesis assistant. Answer the user's question using ONLY the provided source excerpts. You MUST NOT use knowledge from your training data. Every important factual claim must be traceable to a source marker [S1], [S2], etc.

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

const STREAMING_SYNTHESIS_SYSTEM_PROMPT = `You are a PhD-level research synthesis assistant. Answer the user's question using ONLY the provided source excerpts. You MUST NOT use knowledge from your training data. Every important factual claim must be traceable to a source marker [S1], [S2], etc.

STRICT RULES:
1. Use ONLY the provided sources. No training data knowledge.
2. Cite sources inline as [S1], [S2], etc. — every important claim must be traceable.
3. If sources lack sufficient information, set CONFIDENCE to "insufficient" and SUMMARY to: "The retrieved sources are insufficient to answer this confidently."
4. Do NOT speculate or add context not found in sources.
5. Use precise academic language. Focus on a highly thorough, detailed, and deep explanation. Make the DETAIL sections comprehensive, structured, and deep.
6. Place the detailed explanation at the beginning (using DETAIL:) and the direct summary at the bottom (using SUMMARY:). Do NOT output other section markers.

Output using EXACTLY these section markers on their own lines. No markdown, no code fences:

DETAIL: <paragraph 1: thorough background, core concepts, and definitions with citations>
DETAIL: <paragraph 2: comprehensive analysis of mechanisms, methodologies, or findings with citations>
DETAIL: <paragraph 3: detailed comparison of arguments, variants, or applications with citations>
DETAIL: <paragraph 4+: deep dive into nuances, limitations, or research implications backed by sources with citations>
SUMMARY: <2-4 sentence summary of key conclusions citing key sources>
CONFIDENCE: high|medium|low|insufficient`

const AI_SEARCH_SYSTEM_PROMPT = `You are a PhD-level research synthesis assistant. Answer the user's question concisely using ONLY the provided source excerpts. You MUST NOT use knowledge from your training data.

STRICT RULES:
1. Use ONLY the provided sources. No training data knowledge.
2. Every important claim must include at least one inline citation [S1], [S2], etc.
3. Do NOT speculate or add context not found in sources.
4. Output your response as a clean, concise markdown answer. Do NOT output any section headers or prefixes like DETAIL: or SUMMARY:. Just write directly.
5. If sources are insufficient to answer, state so clearly and concisely.
6. Keep the answer brief and to the point (max 300 words).`

const LITERATURE_REVIEW_SYSTEM_PROMPT = `You are a PhD-level research synthesis assistant. Provide a structured, academically rigorous literature review based ONLY on the provided source excerpts. You MUST NOT use knowledge from your training data. Every important factual claim must be traceable to a source marker [S1], [S2], etc.

A real literature review is a critical analysis that groups findings by core concepts (thematic synthesis), compares and contrasts different scholars' perspectives, and critically appraises the methodology and evidence strength of the papers, rather than simply listing individual summaries.

STRICT RULES:
1. Use ONLY the provided sources. No training data knowledge. Do not fabricate or speculate.
2. Every major claim must include at least one inline citation [S1], [S2], etc.
3. If the topic is too broad or the retrieved sources lack sufficient evidence, explicitly state this in the introduction or conclusion and set confidence to "low" or "insufficient".
4. Maintain a formal academic, PhD-level tone throughout.
5. You MUST format your response using exactly these section markers on their own lines. Do NOT wrap the output in markdown code fences or JSON.

Format exactly as follows:

INTRODUCTION_BACKGROUND: <Background: Briefly introduce the topic and its significance with inline citations.>
INTRODUCTION_OBJECTIVES: <Objectives: State the purpose of the literature review.>
INTRODUCTION_SCOPE: <Scope: Define the scope and boundaries of the review.>
THEME: <Theme Title 1> | <Summary of Key Studies: Summarize the main findings of relevant studies with inline citations.> | <Critical Analysis: Evaluate the strengths and weaknesses of these studies with inline citations.> | <Gaps and Limitations: Identify gaps in the research and limitations of the studies reviewed with inline citations.>
THEME: <Theme Title 2> | <Summary of Key Studies> | <Critical Analysis> | <Gaps and Limitations>
THEME: <Theme Title 3 (optional)> | <Summary of Key Studies> | <Critical Analysis> | <Gaps and Limitations>
METHODOLOGY_COMPARISON: <Comparison of Methods: Compare the different methodologies used in the studies reviewed with inline citations.>
METHODOLOGY_EVALUATION: <Evaluation of Approaches: Discuss the effectiveness and limitations of these methodologies with inline citations.>
DISCUSSION_SYNTHESIS: <Synthesis of Findings: Synthesize the findings from the reviewed studies, highlighting common themes and patterns with inline citations.>
DISCUSSION_GAPS: <Research Gaps: Identify and discuss the gaps in the current literature with inline citations.>
DISCUSSION_IMPLICATIONS: <Implications: Explain the implications of these gaps for future research.>
CONCLUSION_SUMMARY: <Summary of Key Points: Summarize the key points discussed in the literature review.>
CONCLUSION_RELEVANCE: <Relevance to Current Study: Explain how the literature review informs and supports current and future research.>
CONCLUSION_FUTURE_DIRECTIONS: <Future Directions: Suggest areas for future research based on the identified gaps and limitations.>
REFERENCES: <List of the cited sources in a standard bibliography format, mapping [S1], [S2], etc. to their real titles, authors, and venues. Include ONLY sources present in the evidence.>
CONFIDENCE: high|medium|low|insufficient`

const DEEP_RESEARCH_REPORT_SYSTEM_PROMPT = `You are a PhD-level research synthesis assistant. Generate a highly detailed, comprehensive deep research report based ONLY on the provided source excerpts. You MUST NOT use knowledge from your training data. Every important factual claim must be traceable to a source marker [S1], [S2], etc.

STRICT RULES:
1. Use ONLY the provided sources. No training data knowledge.
2. Every important claim must include at least one inline citation [S1], [S2], etc.
3. Do NOT speculate or add context not found in sources.
4. You MUST format your response using exactly these section markers on their own lines. Do NOT wrap the output in markdown code fences or JSON.

Format exactly as follows:

EXECUTIVE_SUMMARY: <Comprehensive 1-2 paragraph executive summary summarizing the key research question and main findings>
SECTION: <Section Title 1> | <Detailed multi-paragraph explanation covering background, definitions, and theories with inline citations>
SECTION: <Section Title 2> | <Detailed multi-paragraph analysis of methodologies, mechanisms, and models used with inline citations>
SECTION: <Section Title 3> | <Detailed multi-paragraph synthesis of experimental results, comparisons, and nuances with inline citations>
SECTION: <Section Title 4 (optional)> | <Additional detailed section with inline citations>
KEY_FINDINGS: <Key Finding 1 with citations>
KEY_FINDINGS: <Key Finding 2 with citations>
KEY_FINDINGS: <Key Finding 3 with citations>
METHODOLOGY_NOTES: <Detailed synthesis of the methodologies, sample sizes, and limitations of the studies reviewed>
FUTURE_DIRECTIONS: <Crucial open questions, gaps, and areas for future study identified in the papers>
REFERENCES: <List of the cited sources in a standard bibliography format, mapping [S1], [S2], etc. to their titles/authors/venues>
CONFIDENCE: high|medium|low|insufficient`

const CHAT_PDF_SYSTEM_PROMPT = `You are an academic research assistant. Answer the user's question about the uploaded PDF document using ONLY the provided PDF text chunks. You MUST NOT use knowledge from your training data.

STRICT RULES:
1. Use ONLY the provided PDF text chunks. No training data knowledge.
2. Every important claim must be backed by facts in the PDF.
3. If the PDF does not contain the answer, state: "I cannot find the answer to this question in the provided PDF document." Do not speculate.
4. Output your response as clean markdown text. Do NOT use section markers like DETAIL: or SUMMARY:. Just write directly.
5. You MUST cite the PDF source inline as [S1] when referencing its content (e.g., "[S1]").`


const PDF_SYSTEM_PROMPT = `You are a rigorous academic paper analyst. Analyze ONLY the provided PDF text excerpt.

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

// ─── Synthesis helpers ────────────────────────────────────────────────────────

interface SynthesisSource {
  marker: string
  title: string
  authors: string[]
  year: number
  sourceName: string
  sourceType: string
  peerReviewed: boolean
  provenance: string
  abstract: string
  trustNotes: string
  url: string
  doi?: string
}

function buildSynthesisUserMessage(query: string, sources: SynthesisSource[]): string {
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

// ─── App setup ────────────────────────────────────────────────────────────────

const app = express()

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:5173', 'http://localhost:4173']

app.use(cors({
  origin: allowedOrigins.includes('*') ? '*' : allowedOrigins,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
}))

app.use(rateLimiter)

// ─── Health ───────────────────────────────────────────────────────────────────

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    openaiConfigured: Boolean(OPENAI_API_KEY),
    openalexConfigured: Boolean(OPENALEX_API_KEY),
    timestamp: new Date().toISOString(),
  })
})

// ─── OpenAI router ───────────────────────────────────────────────────────────

const openaiRouter = express.Router()

// POST /api/openai/synthesize
openaiRouter.post('/synthesize', express.json({ limit: '1mb' }), async (req: Request, res: Response): Promise<void> => {
  const { query, sources, history, isFollowup, mode } = req.body as { query?: unknown; sources?: unknown; history?: unknown; isFollowup?: boolean; mode?: string }
  console.log(`[server] /api/openai/synthesize | mode: ${mode} | sources: ${Array.isArray(sources) ? sources.length : 0} | history: ${Array.isArray(history) ? history.length : 0} | isFollowup: ${isFollowup} | queryLen: ${typeof query === 'string' ? query.length : 0}`)

  if (typeof query !== 'string' || !query.trim()) {
    res.status(400).json({ error: 'query must be a non-empty string' })
    return
  }
  if (!Array.isArray(sources)) {
    res.status(400).json({ error: 'sources must be an array' })
    return
  }
  if (!OPENAI_API_KEY) {
    res.status(503).json({ error: 'AI synthesis service is not configured.' })
    return
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 25_000)

  // Format history messages
  const formattedHistory: Array<{ role: string; content: string }> = []
  if (Array.isArray(history)) {
    for (const msg of history) {
      if (typeof msg === 'object' && msg !== null && 'role' in msg && 'content' in msg) {
        const role = String(msg.role)
        const content = String(msg.content)
        if ((role === 'user' || role === 'assistant') && content.trim()) {
          formattedHistory.push({ role, content })
        }
      }
    }
  }

  let systemPrompt = SYNTHESIS_SYSTEM_PROMPT
  let maxTokens = 2500
  const isJsonMode = (!mode || mode === 'research-agent') && !isFollowup

  if (isFollowup) {
    systemPrompt = mode === 'chat-with-pdf' ? CHAT_PDF_SYSTEM_PROMPT : FOLLOWUP_SYSTEM_PROMPT
  } else {
    if (mode === 'ai-search') {
      systemPrompt = AI_SEARCH_SYSTEM_PROMPT
      maxTokens = 1200
    } else if (mode === 'literature-review') {
      systemPrompt = LITERATURE_REVIEW_SYSTEM_PROMPT
      maxTokens = 4000
    } else if (mode === 'deep-research-report') {
      systemPrompt = DEEP_RESEARCH_REPORT_SYSTEM_PROMPT
      maxTokens = 6000
    } else if (mode === 'chat-with-pdf') {
      systemPrompt = CHAT_PDF_SYSTEM_PROMPT
      maxTokens = 2000
    }
  }

  const responseFormat = isJsonMode ? { type: 'json_object' } as const : undefined

  try {
    const upstream = await fetch(OPENAI_ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          ...formattedHistory,
          { role: 'user', content: buildSynthesisUserMessage(query, sources as SynthesisSource[]) },
        ],
        ...(responseFormat && { response_format: responseFormat }),
        temperature: 0.1,
        max_tokens: maxTokens,
      }),
    })
    clearTimeout(timeoutId)

    if (!upstream.ok) {
      console.error(`[synthesize] OpenAI error: ${upstream.status}`)
      res.status(502).json({ error: 'Upstream synthesis service error.' })
      return
    }

    const data = await upstream.json()
    res.json(data)
  } catch (err) {
    clearTimeout(timeoutId)
    const msg = err instanceof Error ? err.message : 'Unknown'
    if (msg.includes('abort') || msg.includes('AbortError') || (err instanceof Error && err.name === 'AbortError')) {
      res.status(504).json({ error: 'Synthesis request timed out.' })
    } else {
      console.error('[synthesize] error:', msg)
      res.status(502).json({ error: 'Synthesis service unavailable.' })
    }
  }
})

// POST /api/openai/synthesize/stream — SSE streaming endpoint
openaiRouter.post('/synthesize/stream', express.json({ limit: '1mb' }), async (req: Request, res: Response): Promise<void> => {
  const { query, sources, history, isFollowup, mode } = req.body as { query?: unknown; sources?: unknown; history?: unknown; isFollowup?: boolean; mode?: string }
  console.log(`[server] /api/openai/synthesize/stream | mode: ${mode} | sources: ${Array.isArray(sources) ? sources.length : 0} | history: ${Array.isArray(history) ? history.length : 0} | isFollowup: ${isFollowup} | queryLen: ${typeof query === 'string' ? query.length : 0}`)

  if (typeof query !== 'string' || !query.trim()) {
    res.status(400).json({ error: 'query must be a non-empty string' })
    return
  }
  if (!Array.isArray(sources)) {
    res.status(400).json({ error: 'sources must be an array' })
    return
  }
  if (!OPENAI_API_KEY) {
    res.status(503).json({ error: 'AI synthesis service is not configured.' })
    return
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 30_000)

  // Abort stream if client disconnects
  res.on('close', () => controller.abort())

  // Format history messages
  const formattedHistory: Array<{ role: string; content: string }> = []
  if (Array.isArray(history)) {
    for (const msg of history) {
      if (typeof msg === 'object' && msg !== null && 'role' in msg && 'content' in msg) {
        const role = String(msg.role)
        const content = String(msg.content)
        if ((role === 'user' || role === 'assistant') && content.trim()) {
          formattedHistory.push({ role, content })
        }
      }
    }
  }

  let systemPrompt = STREAMING_SYNTHESIS_SYSTEM_PROMPT
  let maxTokens = 2500

  if (isFollowup) {
    systemPrompt = mode === 'chat-with-pdf' ? CHAT_PDF_SYSTEM_PROMPT : FOLLOWUP_STREAMING_SYSTEM_PROMPT
  } else {
    if (mode === 'ai-search') {
      systemPrompt = AI_SEARCH_SYSTEM_PROMPT
      maxTokens = 1200
    } else if (mode === 'literature-review') {
      systemPrompt = LITERATURE_REVIEW_SYSTEM_PROMPT
      maxTokens = 4000
    } else if (mode === 'deep-research-report') {
      systemPrompt = DEEP_RESEARCH_REPORT_SYSTEM_PROMPT
      maxTokens = 6000
    } else if (mode === 'chat-with-pdf') {
      systemPrompt = CHAT_PDF_SYSTEM_PROMPT
      maxTokens = 2000
    }
  }

  try {
    const upstream = await fetch(OPENAI_ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        stream: true,
        messages: [
          { role: 'system', content: systemPrompt },
          ...formattedHistory,
          { role: 'user', content: buildSynthesisUserMessage(query, sources as SynthesisSource[]) },
        ],
        temperature: 0.1,
        max_tokens: maxTokens,
      }),
    })
    clearTimeout(timeoutId)

    if (!upstream.ok) {
      console.error(`[synthesize/stream] OpenAI error: ${upstream.status}`)
      res.write(`data: ${JSON.stringify({ error: 'Upstream synthesis service error.' })}\n\n`)
      res.end()
      return
    }

    if (!upstream.body) {
      res.write(`data: ${JSON.stringify({ error: 'No response body from OpenAI.' })}\n\n`)
      res.end()
      return
    }

    const reader = upstream.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed === 'data: [DONE]') continue
        if (!trimmed.startsWith('data: ')) continue
        try {
          const parsed = JSON.parse(trimmed.slice(6)) as { choices?: Array<{ delta?: { content?: string } }> }
          const delta = parsed.choices?.[0]?.delta?.content
          if (delta) {
            res.write(`data: ${JSON.stringify({ text: delta })}\n\n`)
          }
        } catch {
          // skip malformed SSE lines
        }
      }
    }

    res.write('data: [DONE]\n\n')
    res.end()
    console.log('[server] /api/openai/synthesize/stream completed successfully')
  } catch (err) {
    clearTimeout(timeoutId)
    console.error('[synthesize/stream] CATCH TRIGGERED:', err)
    try {
      res.write(`data: ${JSON.stringify({ error: 'Synthesis stream failed.' })}\n\n`)
    } catch {
      // ignore
    }
    res.end()
  }
})

// POST /api/openai/pdf-analysis
openaiRouter.post('/pdf-analysis', express.json({ limit: '1mb' }), async (req: Request, res: Response): Promise<void> => {
  const { text } = req.body as { text?: unknown }

  if (typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: 'text must be a non-empty string' })
    return
  }
  if (!OPENAI_API_KEY) {
    res.status(503).json({ error: 'PDF analysis service is not configured.' })
    return
  }

  const userMessage = `Analyze the following PDF text and return a JSON object matching the specified schema. Do NOT use outside knowledge — only analyze what is explicitly written below.\n\n--- PDF TEXT START ---\n${text}\n--- PDF TEXT END ---`

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 30_000)

  try {
    const upstream = await fetch(OPENAI_ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.1,
        max_tokens: 1500,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: PDF_SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
      }),
    })
    clearTimeout(timeoutId)

    if (!upstream.ok) {
      console.error(`[pdf-analysis] OpenAI error: ${upstream.status}`)
      res.status(502).json({ error: 'Upstream PDF analysis service error.' })
      return
    }

    const data = await upstream.json()
    res.json(data)
  } catch (err) {
    clearTimeout(timeoutId)
    const msg = err instanceof Error ? err.message : 'Unknown'
    if (msg.includes('abort') || msg.includes('AbortError') || (err instanceof Error && err.name === 'AbortError')) {
      res.status(504).json({ error: 'PDF analysis request timed out.' })
    } else {
      console.error('[pdf-analysis] error:', msg)
      res.status(502).json({ error: 'PDF analysis service unavailable.' })
    }
  }
})

// ─── OpenAlex router ──────────────────────────────────────────────────────────

const openalexRouter = express.Router()

// GET /api/openalex/search?q=...
openalexRouter.get('/search', async (req: Request, res: Response): Promise<void> => {
  const q = typeof req.query['q'] === 'string' ? req.query['q'].trim() : ''
  if (!q) {
    res.status(400).json({ error: 'q query parameter is required' })
    return
  }

  const cleanQ = q.replace(/[\?\*]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!cleanQ) {
    res.json({ results: [] })
    return
  }

  const params = new URLSearchParams({
    search: cleanQ,
    per_page: '15',
    filter: 'is_retracted:false,has_abstract:true',
    sort: 'relevance_score:desc',
    select: SELECT_FIELDS,
    mailto: MAILTO,
  })
  if (OPENALEX_API_KEY) params.set('api_key', OPENALEX_API_KEY)

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 8_000)

  try {
    const upstream = await fetch(`${OPENALEX_BASE}/works?${params.toString()}`, {
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    if (!upstream.ok) {
      res.status(502).json({ error: 'OpenAlex search unavailable.' })
      return
    }

    const data = await upstream.json()
    res.json(data)
  } catch (err) {
    clearTimeout(timeoutId)
    const msg = err instanceof Error ? err.message : 'Unknown'
    if (msg.includes('abort') || msg.includes('AbortError') || (err instanceof Error && err.name === 'AbortError')) {
      res.status(504).json({ error: 'OpenAlex search timed out.' })
    } else {
      res.status(502).json({ error: 'OpenAlex search unavailable.' })
    }
  }
})

// GET /api/openalex/doi/* — wildcard captures full DOI (which may contain slashes)
openalexRouter.get('/doi/*', async (req: Request, res: Response): Promise<void> => {
  const doi = (req.params as Record<string, string>)['0']?.trim()
  if (!doi) {
    res.status(400).json({ error: 'DOI path parameter is required' })
    return
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 8_000)

  try {
    const upstream = await fetch(
      `${OPENALEX_BASE}/works/doi:${encodeURIComponent(doi)}`,
      { signal: controller.signal },
    )
    clearTimeout(timeoutId)

    if (!upstream.ok) {
      const status = upstream.status === 404 ? 404 : 502
      res.status(status).json({ error: 'OpenAlex DOI lookup failed.' })
      return
    }

    const data = await upstream.json()
    res.json(data)
  } catch (err) {
    clearTimeout(timeoutId)
    const msg = err instanceof Error ? err.message : 'Unknown'
    if (msg.includes('abort') || msg.includes('AbortError') || (err instanceof Error && err.name === 'AbortError')) {
      res.status(504).json({ error: 'OpenAlex DOI lookup timed out.' })
    } else {
      res.status(502).json({ error: 'OpenAlex DOI lookup unavailable.' })
    }
  }
})

// ─── Mount routers ────────────────────────────────────────────────────────────

app.use('/api/openai', openaiRouter)
app.use('/api/openalex', openalexRouter)

// ─── Global error handler ─────────────────────────────────────────────────────

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[server] unhandled error:', err.message)
  res.status(500).json({ error: 'Internal server error.' })
})

// ─── Start ────────────────────────────────────────────────────────────────────

const server = app.listen(PORT, () => {
  console.log(`[server] Backend proxy running on http://localhost:${PORT}`)
  console.log(`[server] OpenAI configured: ${Boolean(OPENAI_API_KEY)}`)
  console.log(`[server] OpenAlex configured: ${Boolean(OPENALEX_API_KEY)}`)
})

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[server] Port ${PORT} already in use. Kill the process holding it and retry.`)
    process.exit(1)
  }
  throw err
})

export { app }
