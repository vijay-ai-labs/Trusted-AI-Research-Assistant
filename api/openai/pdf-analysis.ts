import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCors } from '../_lib/cors.js'
import { PDF_SYSTEM_PROMPT } from '../_lib/prompts.js'

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions'

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res)) return
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  const { text } = req.body as { text?: unknown }
  if (typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: 'text must be a non-empty string' }); return
  }

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY
  if (!OPENAI_API_KEY) {
    res.status(503).json({ error: 'PDF analysis service is not configured.' }); return
  }

  const userMessage = `Analyze the following PDF text and return a JSON object matching the specified schema. Do NOT use outside knowledge — only analyze what is explicitly written below.\n\n--- PDF TEXT START ---\n${text}\n--- PDF TEXT END ---`
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 30_000)

  try {
    const upstream = await fetch(OPENAI_ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
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
      res.status(502).json({ error: 'Upstream PDF analysis service error.' }); return
    }
    const data = await upstream.json()
    res.json(data)
  } catch (err) {
    clearTimeout(timeoutId)
    const msg = err instanceof Error ? err.message : 'Unknown'
    if (msg.includes('abort') || (err instanceof Error && err.name === 'AbortError')) {
      res.status(504).json({ error: 'PDF analysis request timed out.' })
    } else {
      res.status(502).json({ error: 'PDF analysis service unavailable.' })
    }
  }
}
