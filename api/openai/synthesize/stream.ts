import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCors } from '../../_lib/cors.js'
import { buildSynthesisUserMessage, type SynthesisSource } from '../../_lib/helpers.js'
import {
  STREAMING_SYNTHESIS_SYSTEM_PROMPT,
  AI_SEARCH_SYSTEM_PROMPT,
  LITERATURE_REVIEW_SYSTEM_PROMPT,
  DEEP_RESEARCH_REPORT_SYSTEM_PROMPT,
  CHAT_PDF_SYSTEM_PROMPT,
  FOLLOWUP_STREAMING_SYSTEM_PROMPT,
} from '../../_lib/prompts.js'

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions'

export const config = {
  api: { responseLimit: false },
}

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

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

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

  let systemPrompt = STREAMING_SYNTHESIS_SYSTEM_PROMPT
  let maxTokens = 2500

  if (isFollowup) {
    systemPrompt = mode === 'chat-with-pdf' ? CHAT_PDF_SYSTEM_PROMPT : FOLLOWUP_STREAMING_SYSTEM_PROMPT
  } else {
    if (mode === 'ai-search') { systemPrompt = AI_SEARCH_SYSTEM_PROMPT; maxTokens = 1200 }
    else if (mode === 'literature-review') { systemPrompt = LITERATURE_REVIEW_SYSTEM_PROMPT; maxTokens = 4000 }
    else if (mode === 'deep-research-report') { systemPrompt = DEEP_RESEARCH_REPORT_SYSTEM_PROMPT; maxTokens = 6000 }
    else if (mode === 'chat-with-pdf') { systemPrompt = CHAT_PDF_SYSTEM_PROMPT; maxTokens = 2000 }
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 30_000)

  try {
    const upstream = await fetch(OPENAI_ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
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

    if (!upstream.ok || !upstream.body) {
      res.write(`data: ${JSON.stringify({ error: 'Upstream synthesis service error.' })}\n\n`)
      res.end(); return
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
          if (delta) res.write(`data: ${JSON.stringify({ text: delta })}\n\n`)
        } catch { /* skip malformed lines */ }
      }
    }

    res.write('data: [DONE]\n\n')
    res.end()
  } catch (err) {
    clearTimeout(timeoutId)
    try { res.write(`data: ${JSON.stringify({ error: 'Synthesis stream failed.' })}\n\n`) } catch { /* ignore */ }
    res.end()
  }
}
