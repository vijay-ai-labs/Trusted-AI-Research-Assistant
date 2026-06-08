// SECURITY: pdfjs-dist runs entirely in-browser. No PDF content is sent to any server.
// Text IS sent to OpenAI for analysis — see pdfAnalysisService.ts.
// Production must proxy all AI API calls server-side.

import * as pdfjsLib from 'pdfjs-dist'

// Vite ?url import gives the correct asset path for the worker
// @ts-ignore — Vite-specific ?url suffix not in TS types
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

const MAX_PAGES = 50
const MAX_CHARS = 60_000

export interface PDFExtractionResult {
  text: string
  pageCount: number
  extractedPages: number
  truncated: boolean
  charCount: number
  lowText: boolean
}

export async function extractTextFromPDF(file: File): Promise<PDFExtractionResult> {
  const arrayBuffer = await file.arrayBuffer()
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
  const pdf = await loadingTask.promise

  const pageCount = pdf.numPages
  const pagesToExtract = Math.min(pageCount, MAX_PAGES)
  let text = ''
  let truncated = false
  let extractedPages = pagesToExtract

  for (let i = 1; i <= pagesToExtract; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const pageText = content.items
      .map((item: unknown) => {
        const t = item as { str?: string }
        return t.str ?? ''
      })
      .join(' ')

    text += pageText + '\n'

    if (text.length >= MAX_CHARS) {
      text = text.slice(0, MAX_CHARS)
      truncated = true
      extractedPages = i
      break
    }
  }

  const charCount = text.length

  return {
    text,
    pageCount,
    extractedPages,
    truncated,
    charCount,
    lowText: charCount < 200,
  }
}

export function truncateForAnalysis(text: string, maxChars = 24_000): string {
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars) + `\n\n[Note: Text truncated at ${maxChars} chars for analysis. Extraction may be incomplete.]`
}
