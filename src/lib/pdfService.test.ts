import { describe, it, expect, vi, afterEach } from 'vitest'

// Mock pdfjs-dist before importing pdfService
vi.mock('pdfjs-dist', () => {
  return {
    GlobalWorkerOptions: { workerSrc: '' },
    getDocument: vi.fn(),
  }
})

// Mock the ?url import for the worker
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'mocked-worker.js' }))

import * as pdfjsLib from 'pdfjs-dist'
import { extractTextFromPDF, truncateForAnalysis } from './pdfService'

function makeFakeFile(name = 'test.pdf'): File {
  return new File(['%PDF-1.4 fake content'], name, { type: 'application/pdf' })
}

function makePdf(pages: { text: string }[]) {
  return {
    numPages: pages.length,
    getPage: async (i: number) => ({
      getTextContent: async () => ({
        items: [{ str: pages[i - 1].text }],
      }),
    }),
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('truncateForAnalysis', () => {
  it('returns text unchanged when under budget', () => {
    const text = 'hello world'
    expect(truncateForAnalysis(text, 100)).toBe(text)
  })

  it('truncates at maxChars and appends truncation note', () => {
    const text = 'a'.repeat(30_000)
    const result = truncateForAnalysis(text, 24_000)
    expect(result.length).toBeGreaterThan(24_000)
    expect(result.startsWith('a'.repeat(24_000))).toBe(true)
    expect(result).toContain('[Note: Text truncated at 24000 chars for analysis')
  })

  it('uses default budget of 24000 chars', () => {
    const text = 'x'.repeat(50_000)
    const result = truncateForAnalysis(text)
    expect(result.slice(0, 24_000)).toBe('x'.repeat(24_000))
    expect(result).toContain('[Note:')
  })
})

describe('extractTextFromPDF', () => {
  it('returns lowText:true when extracted chars < 200', async () => {
    const mockPdf = makePdf([{ text: 'Short.' }])
    vi.mocked(pdfjsLib.getDocument).mockReturnValue({
      promise: Promise.resolve(mockPdf),
    } as ReturnType<typeof pdfjsLib.getDocument>)

    const file = makeFakeFile()
    const result = await extractTextFromPDF(file)

    expect(result.lowText).toBe(true)
    expect(result.charCount).toBeLessThan(200)
  })

  it('returns lowText:false for sufficiently long text', async () => {
    const longText = 'This is a valid academic paper. '.repeat(20)
    const mockPdf = makePdf([{ text: longText }])
    vi.mocked(pdfjsLib.getDocument).mockReturnValue({
      promise: Promise.resolve(mockPdf),
    } as ReturnType<typeof pdfjsLib.getDocument>)

    const file = makeFakeFile()
    const result = await extractTextFromPDF(file)

    expect(result.lowText).toBe(false)
    expect(result.charCount).toBeGreaterThanOrEqual(200)
  })

  it('truncates at MAX_CHARS when PDF has many pages', async () => {
    // Each page has 5000 chars, 20 pages = 100000 chars — should truncate at 60000
    const pageText = 'A'.repeat(5000)
    const pages = Array.from({ length: 20 }, () => ({ text: pageText }))
    const mockPdf = makePdf(pages)
    vi.mocked(pdfjsLib.getDocument).mockReturnValue({
      promise: Promise.resolve(mockPdf),
    } as ReturnType<typeof pdfjsLib.getDocument>)

    const file = makeFakeFile()
    const result = await extractTextFromPDF(file)

    expect(result.truncated).toBe(true)
    expect(result.charCount).toBeLessThanOrEqual(60_000)
  })

  it('reports correct pageCount and extractedPages', async () => {
    const pages = Array.from({ length: 5 }, (_, i) => ({ text: `Page ${i + 1} content. ` }))
    const mockPdf = makePdf(pages)
    vi.mocked(pdfjsLib.getDocument).mockReturnValue({
      promise: Promise.resolve(mockPdf),
    } as ReturnType<typeof pdfjsLib.getDocument>)

    const file = makeFakeFile()
    const result = await extractTextFromPDF(file)

    expect(result.pageCount).toBe(5)
  })
})
