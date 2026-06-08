export type SourceType = 'paper' | 'government' | 'legal' | 'standard' | 'dataset' | 'article' | 'report' | 'documentation'

export type Region = 'global' | 'us' | 'eu' | 'uk' | 'cn' | 'in' | 'other'

export type SourceFamily = 'seed' | 'openalex' | 'crossref' | 'semantic-scholar' | 'pubmed' | 'datagov' | 'uploaded-pdf'

export interface ResearchItem {
  id: string
  title: string
  sourceType: SourceType
  sourceName: string
  url: string
  year: number
  authors: string[]
  domainTags: string[]
  abstractOrClaim: string
  citationCount: number
  peerReviewed: boolean
  verifiedByHuman: boolean
  retracted: boolean
  region: Region
  trustNotes: string
  category?: string
  // Optional provenance fields — only present on imported records
  doi?: string
  importedFrom?: SourceFamily
  normalizationConfidence?: number  // 0–1
}

export interface TrustScore {
  score: number
  reasoning: string[]
  warnings: string[]
  breakdown?: Record<string, number>  // signal name → point contribution
}

export interface ScoredResearchItem extends ResearchItem {
  trust: TrustScore
}

export interface PDFAnalysisResult {
  title: string | null
  authors: string[]
  year: number | null
  doi: string | null
  researchQuestion: string
  methodology: string
  datasetOrSample: string
  keyFindings: string[]
  limitations: string[]
  importantQuotesOrClaims: string[]
  relatedKeywords: string[]
  summaryForPhDStudent: string
  confidence: 'high' | 'medium' | 'low' | 'insufficient'
}

export type PDFExtractionStatus =
  | 'idle' | 'extracting' | 'analyzing' | 'enriching' | 'complete' | 'low-text' | 'error'

export interface UploadedPDFState {
  fileName: string
  status: PDFExtractionStatus
  statusMessage: string
  analysis: PDFAnalysisResult | null
  enrichmentLabel: string
  objectUrl: string | null
  addedToEvidence: boolean
  error: string | null
  extractedText?: string
}

