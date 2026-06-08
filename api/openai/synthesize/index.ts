import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCors } from '../../_lib/cors'
import { buildSynthesisUserMessage, type SynthesisSource } from '../../_lib/helpers'
import {
  SYNTHESIS_SYSTEM_PROMPT,
  AI_SEARCH_SYSTEM_PROMPT,
  LITERATURE_REVIEW_SYSTEM_PROMPT,
  DEEP_RESEARCH_REPORT_SYSTEM_PROMPT,
  CHAT_PDF_SYSTEM_PROMPT,
  FOLLOWUP_SYSTEM_PROMPT,
} from '../../_lib/prompts'

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions'

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res)) return
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  const { query, sources, history, isFollowup, mode } = req.body as {
    query?: unknown; sources?: unknown; history?: unknown; isFollowup?: boolean; mode?: string
  }

  if (typeof query !== 'string' || !query.trim()) {
    res.status(400).json({ error: 'query must be a non-empty string' }); return
  }
  if (!Array.isArray(sources)) {
    res.status(400).json({ error: 'sources must be an array' }); return
  }

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY
  if (!OPENAI_API_KEY) {
    res.status(503).json({ error: 'AI synthesis service is not configured.' }); return
  }

  const formattedHistory: Array<{ role: string; content: string }> = []
  if (Array.isArray(history)) {
    for (const msg of history) {
      if (typeof msg === 'object' && msg !== null && 'role' in msg && 'content' in msg) {
        const role = String((msg as Record<string, unknown>).role)
        const content = String((msg as Record<string, unknown>).content)
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
    if (mode === 'ai-search') { systemPrompt = AI_SEARCH_SYSTEM_PROMPT; maxTokens = 1200 }
    else if (mode === 'literature-review') { systemPrompt = LITERATURE_REVIEW_SYSTEM_PROMPT; maxTokens = 4000 }
    else if (mode === 'deep-research-report') { systemPrompt = DEEP_RESEARCH_REPORT_SYSTEM_PROMPT; maxTokens = 6000 }
    else if (mode === 'chat-with-pdf') { systemPrompt = CHAT_PDF_SYSTEM_PROMPT; maxTokens = 2000 }
  }

  const responseFormat = isJsonMode ? { type: 'json_object' } as const : undefined
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 25_000)

  try {
    const upstream = await fetch(OPENAI_ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
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
      res.status(502).json({ error: 'Upstream synthesis service error.' }); return
    }
    const data = await upstream.json()
    res.json(data)
  } catch (err) {
    clearTimeout(timeoutId)
    const msg = err instanceof Error ? err.message : 'Unknown'
    if (msg.includes('abort') || (err instanceof Error && err.name === 'AbortError')) {
      res.status(504).json({ error: 'Synthesis request timed out.' })
    } else {
      res.status(502).json({ error: 'Synthesis service unavailable.' })
    }
  }
}
