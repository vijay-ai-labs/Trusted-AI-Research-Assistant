import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCors } from './_lib/cors'

export default function handler(req: VercelRequest, res: VercelResponse): void {
  if (applyCors(req, res)) return
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return }

  res.json({
    status: 'ok',
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    openalexConfigured: Boolean(process.env.OPENALEX_API_KEY),
    timestamp: new Date().toISOString(),
  })
}
