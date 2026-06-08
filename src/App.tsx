import React, { useEffect, useMemo, useRef, useState, Fragment, useCallback } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  BookMarked,
  BookmarkPlus,
  BookOpen,
  CheckCircle2,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileSearch,
  FileUp,
  Filter,
  FolderOpen,
  Plus,
  GraduationCap,
  Loader2,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  X,
  Paperclip,
  Send,
  MessageSquare,
  Table,
  Clock,
  ArrowRight,
  ArrowLeft,
} from 'lucide-react'
import {
  type CitableSource,
  type CitationFormat,
  formatAllCitations,
  formatCitation,
  fromResearchItem,
  fromSynthesisSource,
  formatBibtex,
  buildBibtexKey,
} from './lib/citationService'
import { researchItems } from '../research-items'
import type { PDFAnalysisResult, PDFExtractionStatus, Region, ResearchItem, SourceType, UploadedPDFState } from '../research'
import { searchOpenAlex } from './lib/openalexService'
import {
  synthesizeAnswer,
  streamSynthesisAnswer,
  parseStreamingText,
  selectTopSources,
  type SynthesisResult,
  type SynthesisStatus,
  type SynthesisSource,
} from './lib/openaiSynthesisService'
import {
  type RankedResearchItem,
  type ResearchFilters,
  type TrustExplanation,
  composeEvidenceAnswer,
  defaultFilters,
  explainSourceTrust,
  getDataHealth,
  groupSources,
  searchResearchItems,
  sourceTypeLabels,
  sourceTypes,
  validateResearchItems,
} from './lib/researchEngine'
import {
  createSessionFromCurrentState,
  deleteSession,
  exportSessionMarkdown,
  loadSessions,
  saveSession,
  updateSession,
  type SavedResearchSession,
} from './lib/sessionService'
import { AgentModeSelector } from './components/AgentModeSelector'
import { LiteratureReviewView } from './components/LiteratureReviewView'
import { DeepResearchReportView } from './components/DeepResearchReportView'
import { ChatWithPDFView } from './components/ChatWithPDFView'
import type { AgentMode } from './lib/agentModes'

// V1.8: API keys are managed server-side in server/index.ts.
// Services call /api/* proxy endpoints. No keys are read in this file.

// Dynamic imports keep pdfjs-dist (~3MB) out of initial bundle — loaded on first upload
async function getPdfService() {
  return import('./lib/pdfService')
}
async function getPdfAnalysisService() {
  return import('./lib/pdfAnalysisService')
}

const CITATION_FORMATS: CitationFormat[] = ['APA', 'BibTeX', 'MLA', 'Chicago']

const examples = [
  'What is retrieval augmented generation?',
  'How do researchers evaluate hallucination?',
  'What is AI governance?',
  'What education research supports retrieval practice?',
]

type OpenAlexStatus = 'idle' | 'loading' | 'success' | 'failed' | 'empty'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content?: string
  synthesis?: SynthesisResult
  streamingText?: string
  status: 'loading' | 'ready' | 'error' | 'insufficient' | 'fallback' | 'idle'
  isFollowup: boolean
}

function useTypewriter(phrases: string[]) {
  const [text, setText] = useState('')
  const [phraseIndex, setPhraseIndex] = useState(0)
  const [charIndex, setCharIndex] = useState(0)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    const current = phrases[phraseIndex]
    let delay: number
    if (!deleting && charIndex < current.length) {
      delay = 45 + Math.random() * 55
      const t = setTimeout(() => setCharIndex(i => i + 1), delay)
      return () => clearTimeout(t)
    }
    if (!deleting && charIndex === current.length) {
      const t = setTimeout(() => setDeleting(true), 1200)
      return () => clearTimeout(t)
    }
    if (deleting && charIndex > 0) {
      delay = 18 + Math.random() * 20
      const t = setTimeout(() => setCharIndex(i => i - 1), delay)
      return () => clearTimeout(t)
    }
    if (deleting && charIndex === 0) {
      const t = setTimeout(() => {
        setDeleting(false)
        setPhraseIndex(i => (i + 1) % phrases.length)
      }, 400)
      return () => clearTimeout(t)
    }
  }, [charIndex, deleting, phraseIndex, phrases])

  useEffect(() => {
    setText(phrases[phraseIndex].slice(0, charIndex))
  }, [charIndex, phraseIndex, phrases])

  return text
}

interface AcademicDetails {
  methodology: string;
  datasetOrSample: string;
  sampleSize: string;
  conclusion: string;
}

function getSampleWarning(item: ResearchItem): string | null {
  const text = (item.abstractOrClaim || '').toLowerCase();
  const match = text.match(/\b[nN]\s*=\s*([1-9]|[1-2]\d)\b/);
  if (match) {
    return `Small Sample Size (N = ${match[1]})`;
  }
  return null;
}

interface EvidenceHealth {
  peerReviewRate: number;
  totalCitations: number;
  warningCount: number;
  avgYear: number;
}

function calculateEvidenceHealth(results: RankedResearchItem[]): EvidenceHealth {
  const activeItems = results.slice(0, 24);
  if (activeItems.length === 0) {
    return { peerReviewRate: 0, totalCitations: 0, warningCount: 0, avgYear: 0 };
  }

  let peerReviewedCount = 0;
  let totalCitations = 0;
  let warningCount = 0;
  let totalYear = 0;
  let yearCount = 0;

  activeItems.forEach(item => {
    if (item.peerReviewed) peerReviewedCount++;
    totalCitations += item.citationCount || 0;
    
    if (item.year && item.year > 0) {
      totalYear += item.year;
      yearCount++;
    }

    // Warning triggers
    if (item.retracted) warningCount++;
    if (!item.peerReviewed) warningCount++;
    if (getSampleWarning(item)) warningCount++;
  });

  return {
    peerReviewRate: Math.round((peerReviewedCount / activeItems.length) * 100),
    totalCitations,
    warningCount,
    avgYear: yearCount > 0 ? Math.round(totalYear / yearCount) : 0
  };
}

function extractAcademicDetails(item: ResearchItem, uploadedPDFAnalysis?: PDFAnalysisResult | null): AcademicDetails {
  if (item.importedFrom === 'uploaded-pdf' && uploadedPDFAnalysis) {
    return {
      methodology: uploadedPDFAnalysis.methodology || 'Extracted from PDF',
      datasetOrSample: uploadedPDFAnalysis.datasetOrSample || 'Extracted from PDF',
      sampleSize: parseSampleSize(uploadedPDFAnalysis.datasetOrSample || ''),
      conclusion: uploadedPDFAnalysis.keyFindings.join('; ') || 'Extracted from PDF'
    };
  }

  const text = (item.abstractOrClaim || '').toLowerCase();
  
  let methodology = 'Literature Review / Conceptual';
  const methKeywords = [
    { term: 'randomized controlled trial', label: 'Randomized Controlled Trial (RCT)' },
    { term: 'rct', label: 'Randomized Controlled Trial (RCT)' },
    { term: 'meta-analysis', label: 'Meta-Analysis' },
    { term: 'systematic review', label: 'Systematic Review' },
    { term: 'empirical study', label: 'Empirical Study' },
    { term: 'quantitative', label: 'Quantitative Analysis' },
    { term: 'qualitative', label: 'Qualitative Analysis' },
    { term: 'case study', label: 'Case Study' },
    { term: 'survey', label: 'Survey / Questionnaire' },
    { term: 'experiment', label: 'Experimental Study' },
    { term: 'simulation', label: 'Simulation / Modeling' },
    { term: 'longitudinal', label: 'Longitudinal Cohort' },
    { term: 'cross-sectional', label: 'Cross-Sectional Study' },
    { term: 'regression', label: 'Statistical Modeling (Regression)' },
    { term: 'interviews', label: 'Interview-based Qualitative' },
    { term: 'framework', label: 'Framework / System Design' },
    { term: 'observational', label: 'Observational Study' }
  ];
  
  for (const kw of methKeywords) {
    if (text.includes(kw.term)) {
      methodology = kw.label;
      break;
    }
  }

  let datasetOrSample = 'Not specified';
  let sampleSize = 'N/A';
  
  const sampleRegexes = [
    /\bn\s*=\s*(\d+[\d,]*)/,
    /\bN\s*=\s*(\d+[\d,]*)/,
    /(\d+[\d,]*)\s*(?:participants|subjects|patients|respondents|samples|users|individuals|observations|adults|interviews|cases|runs)/,
    /sample of\s*(\d+[\d,]*)/,
    /dataset of\s*(\d+[\d,]*)/
  ];
  
  for (const rx of sampleRegexes) {
    const match = (item.abstractOrClaim || '').match(rx);
    if (match) {
      sampleSize = match[1];
      datasetOrSample = match[0];
      break;
    }
  }

  const datasetKeywords = ['imagenet', 'mnist', 'wikipedia', 'common crawl', 'census', 'survey', 'openalex', 'github'];
  for (const dk of datasetKeywords) {
    if (text.includes(dk)) {
      datasetOrSample = dk.charAt(0).toUpperCase() + dk.slice(1) + ' Dataset';
      break;
    }
  }

  let conclusion = '';
  const sentences = (item.abstractOrClaim || '').match(/[^.!?]+[.!?]+(\s|$)/g) || [];
  
  const conclusionIndicators = ['conclude', 'results show', 'find that', 'indicate', 'demonstrate', 'show that', 'overall', 'implications'];
  for (let i = sentences.length - 1; i >= 0; i--) {
    const s = sentences[i].toLowerCase();
    if (conclusionIndicators.some(ind => s.includes(ind))) {
      conclusion = sentences[i].trim();
      break;
    }
  }
  
  if (!conclusion && sentences.length > 0) {
    conclusion = sentences[sentences.length - 1].trim();
  }
  
  if (!conclusion) {
    conclusion = item.abstractOrClaim ? (item.abstractOrClaim.slice(0, 150) + '...') : 'No conclusion text available.';
  }

  return {
    methodology,
    datasetOrSample,
    sampleSize,
    conclusion
  };
}

function parseSampleSize(text: string): string {
  const match = text.match(/\b(n\s*=\s*\d+|\b\d+(?:\s*participants|\s*subjects|\s*samples)?)/i);
  return match ? match[0] : 'N/A';
}

function App() {
  const auditedItems = useMemo(() => validateResearchItems(researchItems), [])
  const health = useMemo(() => getDataHealth(auditedItems), [auditedItems])
  const [inputValue, setInputValue] = useState('')
  const [query, setQuery] = useState('')
  const [agentMode, setAgentMode] = useState<AgentMode>('research-agent')
  const typewriterText = useTypewriter(examples)

  function handleGoHome() {
    setInputValue('')
    setQuery('')
    handleRemovePDF()
    setRestoredSession(null)
    restoredQueryRef.current = null
    setChatHistory([])
    setAgentMode('research-agent')
  }

  function handleSearch(newQuery: string) {
    const trimmed = newQuery.trim()
    if (!trimmed) return

    setRestoredSession(null)
    restoredQueryRef.current = null

    setQuery(trimmed)
    setInputValue(trimmed)

    setOpenAlexItems([])
    setOpenAlexStatus('loading')
    setSynthesisResult(null)
    setSynthesisStatus('loading')
    setIsStreaming(false)
    setStreamingText('')
    setRevealedMarkers(new Set())
    setShowSynthesisExport(false)

    setChatHistory([
      {
        id: `initial-user-${Date.now()}`,
        role: 'user',
        content: trimmed,
        isFollowup: false,
        status: 'ready'
      },
      {
        id: 'initial-assistant',
        role: 'assistant',
        isFollowup: false,
        status: 'loading',
        streamingText: ''
      }
    ])
  }
  const [searchFocused, setSearchFocused] = useState(false)
  const [filters, setFilters] = useState<ResearchFilters>(defaultFilters)
  const [openAlexItems, setOpenAlexItems] = useState<ResearchItem[]>([])
  const [openAlexStatus, setOpenAlexStatus] = useState<OpenAlexStatus>('idle')
  const [synthesisResult, setSynthesisResult] = useState<SynthesisResult | null>(null)
  const [synthesisStatus, setSynthesisStatus] = useState<SynthesisStatus>('idle')
  const [showSynthesisExport, setShowSynthesisExport] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [revealedMarkers, setRevealedMarkers] = useState<Set<string>>(new Set())
  const [streamingKnownSources, setStreamingKnownSources] = useState<SynthesisSource[]>([])
  const [selectedSource, setSelectedSource] = useState<RankedResearchItem | null>(null)
  const [selectedSourceMarker, setSelectedSourceMarker] = useState<number>(1)
  const [savedSessions, setSavedSessions] = useState<SavedResearchSession[]>([])
  const [showSessionsSidebar, setShowSessionsSidebar] = useState(false)
  const [sessionNotes, setSessionNotes] = useState('')
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [sessionSaveState, setSessionSaveState] = useState<'idle' | 'saved' | 'unsaved-changes' | 'restored'>('idle')
  const [restoredSession, setRestoredSession] = useState<SavedResearchSession | null>(null)
  const restoredQueryRef = useRef<string | null>(null)
  const [showFilters, setShowFilters] = useState(false)
  const [uploadedPDF, setUploadedPDF] = useState<UploadedPDFState | null>(null)
  const [pdfUploadedItem, setPdfUploadedItem] = useState<ResearchItem | null>(null)

  const activePdfInputRef = useRef<HTMLInputElement>(null)
  const landingFilterPopoverRef = useRef<HTMLDivElement>(null)
  const activeFilterPopoverRef = useRef<HTMLDivElement>(null)

  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([])
  const [followupText, setFollowupText] = useState('')
  const [followupLoading, setFollowupLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'chat' | 'matrix' | 'timeline'>('chat')
  const [notebookContent, setNotebookContent] = useState(() => {
    return localStorage.getItem('researcher_notebook_content') || ''
  })
  const [isNotebookOpen, setIsNotebookOpen] = useState(false)
  const [notebookViewTab, setNotebookViewTab] = useState<'edit' | 'preview'>('edit')

  const [notebookHeight, setNotebookHeight] = useState(() => Math.max(150, Math.round(window.innerHeight * 0.35)))
  const isResizingRef = useRef(false)

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizingRef.current) return
    const newHeight = window.innerHeight - e.clientY
    if (newHeight >= 150 && newHeight <= window.innerHeight * 0.9) {
      setNotebookHeight(newHeight)
    }
  }, [])

  const handleMouseUp = useCallback(() => {
    isResizingRef.current = false
    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', handleMouseUp)
  }, [handleMouseMove])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isResizingRef.current = true
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [handleMouseMove, handleMouseUp])

  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [handleMouseMove, handleMouseUp])

  useEffect(() => {
    localStorage.setItem('researcher_notebook_content', notebookContent)
  }, [notebookContent])

  function handleAddToNotebook(text: string) {
    setNotebookContent(prev => {
      const separator = prev ? '\n\n---\n\n' : ''
      return prev + separator + text
    })
    setIsNotebookOpen(true)
  }

  const chatEndRef = useRef<HTMLDivElement>(null)
  const followupAbortControllerRef = useRef<AbortController | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatHistory])

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`
    }
  }, [followupText])

  useEffect(() => {
    return () => {
      followupAbortControllerRef.current?.abort()
    }
  }, [])

  function handleCitationClick(marker: string) {
    const num = parseInt(marker.replace(/[^0-9]/g, ''), 10);
    if (!isNaN(num)) {
      if (agentMode === 'chat-with-pdf') {
        if (pdfUploadedItem) {
          const rankedItem: RankedResearchItem = {
            ...pdfUploadedItem,
            totalScore: 100,
            relevance: 100,
            trustSignal: 100,
            matchedTerms: ['pdf context'],
            audit: {
              provenance: 'local-seed',
              label: 'Uploaded PDF context',
              issues: [],
              completeness: 1,
              hasWarnings: false,
              isUsable: true
            }
          };
          handleOpenDetail(rankedItem, num);
          return;
        }
      }

      const item = results[num - 1];
      if (item) {
        handleOpenDetail(item, num);
        return;
      }
    }

    const card = document.getElementById(`source-card-${marker}`)
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' })
      card.classList.add('source-card--highlighted')
      setTimeout(() => {
        card.classList.remove('source-card--highlighted')
      }, 2000)
    }
  }

  function formatHistoryForAPI(history: ChatMessage[]) {
    return history.map(msg => {
      let content = msg.content || '';
      if (msg.role === 'assistant' && msg.synthesis) {
        content = [
          `Direct Answer: ${msg.synthesis.directAnswer}`,
          msg.synthesis.detailedAnswer.join('\n\n'),
          msg.synthesis.keyEvidence.length > 0 ? `Key Evidence:\n${msg.synthesis.keyEvidence.map(e => `- ${e}`).join('\n')}` : '',
        ].filter(Boolean).join('\n\n');
      } else if (msg.role === 'assistant' && !content && msg.streamingText) {
        content = msg.streamingText;
      }
      return {
        role: msg.role,
        content: content
      };
    });
  }

  function handleFollowupSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault()
    const trimmed = followupText.trim()
    if (!trimmed || followupLoading) return

    setFollowupText('')
    setFollowupLoading(true)

    const userMsgId = `user-${Date.now()}`
    const assistantMsgId = `assistant-${Date.now()}`

    // Add user question and assistant loading message to history
    setChatHistory(prev => [
      ...prev,
      {
        id: userMsgId,
        role: 'user',
        content: trimmed,
        isFollowup: true,
        status: 'ready'
      },
      {
        id: assistantMsgId,
        role: 'assistant',
        isFollowup: true,
        status: 'loading',
        streamingText: ''
      }
    ])

    const abortController = new AbortController()
    followupAbortControllerRef.current = abortController

    const activeSources = selectTopSources(results)
    const formattedHistory = formatHistoryForAPI([...chatHistory, {
      id: userMsgId,
      role: 'user',
      content: trimmed,
      isFollowup: true,
      status: 'ready'
    }])

    streamSynthesisAnswer(
      trimmed,
      activeSources,
      (chunk) => {
        if (abortController.signal.aborted) return
        setChatHistory(curr => curr.map(msg => 
          msg.id === assistantMsgId ? { ...msg, streamingText: (msg.streamingText || '') + chunk } : msg
        ))
      },
      (fullText) => {
        if (abortController.signal.aborted) return
        setFollowupLoading(false)
        setChatHistory(curr => curr.map(msg => 
          msg.id === assistantMsgId ? { ...msg, status: 'ready', content: fullText, streamingText: '' } : msg
        ))
      },
      (err) => {
        if (abortController.signal.aborted) return
        setFollowupLoading(false)
        setChatHistory(curr => curr.map(msg => 
          msg.id === assistantMsgId ? { ...msg, status: 'error', content: `Error: ${err.message || 'Synthesis failed.'}`, streamingText: '' } : msg
        ))
      },
      abortController.signal,
      formattedHistory,
      true, // isFollowup
      agentMode
    )
  }

  function handleOpenDetail(item: RankedResearchItem, marker: number) {
    setSelectedSource(item)
    setSelectedSourceMarker(marker)
  }

  function handleCloseDetail() {
    setSelectedSource(null)
  }

  async function handlePDFUpload(file: File) {
    // Revoke previous objectUrl to avoid memory leak
    if (uploadedPDF?.objectUrl) URL.revokeObjectURL(uploadedPDF.objectUrl)
    setPdfUploadedItem(null)

    const objectUrl = URL.createObjectURL(file)

    const setState = (partial: Partial<UploadedPDFState>) =>
      setUploadedPDF(prev => ({ ...(prev ?? {
        fileName: file.name, status: 'idle', statusMessage: '', analysis: null,
        enrichmentLabel: '', objectUrl, addedToEvidence: false, error: null,
      }), ...partial } as UploadedPDFState))

    setState({ fileName: file.name, status: 'extracting', statusMessage: 'Extracting PDF text…', objectUrl, addedToEvidence: false, error: null, analysis: null, enrichmentLabel: '' })

    try {
      const { extractTextFromPDF, truncateForAnalysis } = await getPdfService()
      const extracted = await extractTextFromPDF(file)

      if (extracted.lowText) {
        setState({ status: 'low-text', statusMessage: 'This PDF appears to contain little or no extractable text. OCR is not supported in this MVP.' })
        return
      }

      setState({ status: 'analyzing', statusMessage: 'Analyzing paper…' })

      const truncated = truncateForAnalysis(extracted.text)
      const { analyzePDFText, enrichWithOpenAlex, buildResearchItem } = await getPdfAnalysisService()
      const analysis = await analyzePDFText(truncated, '')

      setState({ status: 'enriching', statusMessage: 'Enriching metadata via OpenAlex…', analysis })

      const { enriched, label } = await enrichWithOpenAlex(analysis)

      const currentState: UploadedPDFState = {
        fileName: file.name, status: 'complete', statusMessage: 'Analysis complete',
        analysis, enrichmentLabel: label, objectUrl, addedToEvidence: false, error: null,
        extractedText: extracted.text,
      }
      setState({ status: 'complete', statusMessage: 'Analysis complete', enrichmentLabel: label, extractedText: extracted.text })

      const item = buildResearchItem(currentState, enriched)
      setPdfUploadedItem(item)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setState({ status: 'error', statusMessage: 'Could not extract readable text.', error: msg })
    }
  }

  function handleAddPDFToEvidence() {
    setUploadedPDF(prev => prev ? { ...prev, addedToEvidence: true } : prev)
  }

  function handleRemovePDF() {
    if (uploadedPDF?.objectUrl) URL.revokeObjectURL(uploadedPDF.objectUrl)
    setUploadedPDF(null)
    setPdfUploadedItem(null)
    if (activePdfInputRef.current) activePdfInputRef.current.value = ''
  }

  useEffect(() => {
    if (restoredSession !== null) return
    if (!query.trim()) {
      setOpenAlexItems([])
      setOpenAlexStatus('idle')
      return
    }
    setOpenAlexItems([]) // Immediately clear previous results
    setOpenAlexStatus('loading')
    let cancelled = false
    searchOpenAlex(query).then((result) => {
      if (cancelled) return
      setOpenAlexItems(result.items)
      setOpenAlexStatus(result.status)
    })
    return () => { cancelled = true }
  }, [query, restoredSession])

  const allAuditedItems = useMemo(() => {
    const liveAudited = validateResearchItems(openAlexItems)
    const uploadedAudited = (uploadedPDF?.addedToEvidence && pdfUploadedItem)
      ? validateResearchItems([pdfUploadedItem])
      : []
    return [...auditedItems, ...liveAudited, ...uploadedAudited]
  }, [auditedItems, openAlexItems, uploadedPDF?.addedToEvidence, pdfUploadedItem])

  const results = useMemo(() => searchResearchItems(query, filters, allAuditedItems), [allAuditedItems, filters, query])
  const answer = useMemo(() => composeEvidenceAnswer(query, results), [query, results])

  useEffect(() => {
    if (restoredSession !== null) return

    // If OpenAlex is loading, immediately reset the stale AI synthesis panel states
    if (openAlexStatus === 'loading') {
      setSynthesisResult(null)
      setSynthesisStatus('loading')
      setIsStreaming(false)
      setStreamingText('')
      setRevealedMarkers(new Set())
      return
    }

    if (!query.trim() || results.length === 0) {
      setSynthesisResult(null)
      setSynthesisStatus('idle')
      setShowSynthesisExport(false)
      setIsStreaming(false)
      setStreamingText('')
      setRevealedMarkers(new Set())
      return
    }
    // Wait for OpenAlex to finish so synthesis uses the full result set, not local-only

    setSynthesisStatus('loading')
    setSynthesisResult(null)
    setStreamingText('')
    setRevealedMarkers(new Set())
    setShowSynthesisExport(false)

    const knownSources = selectTopSources(results)
    setStreamingKnownSources(knownSources)
    setIsStreaming(true)

    const abortController = new AbortController()
    const seenMarkers = new Set<string>()

    streamSynthesisAnswer(
      query,
      knownSources,
      (chunk) => {
        if (abortController.signal.aborted) return
        setStreamingText((prev) => {
          const next = prev + chunk
          
          setChatHistory((curr) =>
            curr.map((msg) => (msg.id === 'initial-assistant' ? { ...msg, streamingText: next } : msg))
          )

          // Detect newly cited [Sn] markers and reveal them
          const matches = next.match(/\[S(\d+)\]/g)
          if (matches) {
            const newlyRevealed: string[] = []
            for (const m of matches) {
              const num = m.slice(2, -1)
              const key = `S${num}`
              if (!seenMarkers.has(key)) {
                seenMarkers.add(key)
                newlyRevealed.push(key)
              }
            }
            if (newlyRevealed.length > 0) {
              setRevealedMarkers((prev) => {
                const next = new Set(prev)
                for (const k of newlyRevealed) next.add(k)
                return next
              })
            }
          }
          return next
        })
      },
      (fullText) => {
        if (abortController.signal.aborted) return
        let parsed: SynthesisResult
        if (agentMode === 'ai-search' || agentMode === 'chat-with-pdf') {
          parsed = {
            directAnswer: fullText,
            detailedAnswer: [],
            keyEvidence: [],
            sourceComparison: [],
            limitations: [],
            researchUsefulness: '',
            confidence: 'high',
            sourcesUsed: knownSources,
            usedDeterministicFallback: false
          }
        } else {
          parsed = parseStreamingText(fullText, knownSources)
        }
        ;(parsed as any).rawText = fullText

        setIsStreaming(false)
        setSynthesisResult(parsed)
        
        let targetStatus: ChatMessage['status'] = 'ready'
        if (parsed.confidence === 'insufficient') {
          setSynthesisStatus('insufficient')
          targetStatus = 'insufficient'
        } else {
          setSynthesisStatus('ready')
        }

        setChatHistory((curr) =>
          curr.map((msg) =>
            msg.id === 'initial-assistant'
              ? { ...msg, status: targetStatus, synthesis: parsed, streamingText: '' }
              : msg
          )
        )
      },
      () => {
        if (abortController.signal.aborted) return
        // Stream failed — fall back to one-shot synthesis
        setIsStreaming(false)
        synthesizeAnswer(query, results, undefined, undefined, false, agentMode).then((result) => {
          if (abortController.signal.aborted) return
          setSynthesisResult(result)
          
          let targetStatus: ChatMessage['status'] = 'ready'
          if (result.usedDeterministicFallback) {
            setSynthesisStatus('fallback')
            targetStatus = 'fallback'
          } else if (result.confidence === 'insufficient') {
            setSynthesisStatus('insufficient')
            targetStatus = 'insufficient'
          } else {
            setSynthesisStatus('ready')
          }

          setChatHistory((curr) =>
            curr.map((msg) =>
              msg.id === 'initial-assistant'
                ? { ...msg, status: targetStatus, synthesis: result, streamingText: '' }
                : msg
            )
          )
        })
      },
      abortController.signal,
      undefined,
      false,
      agentMode
    )

    return () => {
      abortController.abort()
      setIsStreaming(false)
    }
  }, [query, results, openAlexStatus, restoredSession, agentMode])
  const grouped = useMemo(() => groupSources(results.slice(0, 24)), [results])
  const globalMarkerMap = useMemo(() => {
    const map = new Map<string, number>()
    results.slice(0, 24).forEach((item, i) => map.set(item.id, i + 1))
    return map
  }, [results])
  const regions = useMemo(() => {
    return [...new Set(allAuditedItems.map((item) => item.region))].sort()
  }, [allAuditedItems])

  const hasActiveFilters = useMemo(() =>
    filters.sourceTypes.length !== defaultFilters.sourceTypes.length ||
    filters.peerReviewed !== defaultFilters.peerReviewed ||
    filters.verification !== defaultFilters.verification ||
    filters.region !== defaultFilters.region ||
    filters.yearFrom !== defaultFilters.yearFrom ||
    filters.yearTo !== defaultFilters.yearTo ||
    filters.warnings !== defaultFilters.warnings,
  [filters])

  useEffect(() => {
    if (!showFilters) return
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node
      const clickInLanding = landingFilterPopoverRef.current?.contains(target)
      const clickInActive = activeFilterPopoverRef.current?.contains(target)
      const clickedButton = target instanceof Element ? target.closest('.filter-toggle-btn, .filter-outer-btn, .filter-inline-btn') : null
      if (!clickInLanding && !clickInActive && !clickedButton) {
        setShowFilters(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showFilters])

  useEffect(() => { setSavedSessions(loadSessions()) }, [])

  useEffect(() => {
    if (activeSessionId !== null && sessionSaveState === 'saved') {
      setSessionSaveState('unsaved-changes')
    }
    if (restoredSession !== null && query !== restoredQueryRef.current) {
      setRestoredSession(null)
      restoredQueryRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  function handleSaveSession() {
    if (!query.trim()) return
    const session = createSessionFromCurrentState(
      query, results, synthesisResult, synthesisStatus,
      answer, filters, sessionNotes, undefined, activeSessionId ?? undefined,
    )
    if (activeSessionId) {
      updateSession(session)
    } else {
      saveSession(session)
      setActiveSessionId(session.id)
    }
    setSavedSessions(loadSessions())
    setSessionSaveState('saved')
  }

  function handleRestoreSession(session: SavedResearchSession) {
    setInputValue(session.query)
    setQuery(session.query)
    setFilters(session.filters)
    setSessionNotes(session.notes)
    setActiveSessionId(session.id)
    setRestoredSession(session)
    setSessionSaveState('restored')
    restoredQueryRef.current = session.query
    setShowSessionsSidebar(false)

    let restoredStatus: ChatMessage['status'] = 'idle'
    const restoredSynthesis: SynthesisResult | undefined = session.answer ? {
      directAnswer: session.answer.directAnswer,
      detailedAnswer: session.answer.detailedAnswer,
      keyEvidence: session.answer.keyEvidence,
      sourceComparison: session.answer.sourceComparison,
      limitations: session.answer.limitations,
      researchUsefulness: session.answer.researchUsefulness,
      confidence: session.answer.confidence,
      sourcesUsed: session.sources.map((s, index) => ({
        marker: `S${index + 1}`,
        title: s.title,
        authors: s.authors,
        year: s.year,
        sourceName: s.sourceName,
        sourceType: s.sourceType,
        peerReviewed: s.peerReviewed,
        provenance: s.provenance === 'openalex' ? 'openalex' : 'local-seed',
        abstract: '',
        trustNotes: s.trustNotes,
        url: s.url,
        doi: s.doi,
      })),
      usedDeterministicFallback: session.answer.usedDeterministicFallback,
      fallbackReason: session.answer.fallbackReason,
    } : undefined

    if (session.answer) {
      if (session.answer.usedDeterministicFallback) {
        restoredStatus = 'fallback'
      } else if (session.answer.confidence === 'insufficient') {
        restoredStatus = 'insufficient'
      } else {
        restoredStatus = 'ready'
      }
    }

    setChatHistory([
      {
        id: `initial-user-${Date.now()}`,
        role: 'user',
        content: session.query,
        isFollowup: false,
        status: 'ready'
      },
      {
        id: 'initial-assistant',
        role: 'assistant',
        isFollowup: false,
        status: restoredStatus,
        synthesis: restoredSynthesis,
        streamingText: '',
      }
    ])
  }

  function handleDeleteSession(id: string) {
    deleteSession(id)
    setSavedSessions(loadSessions())
    if (activeSessionId === id) {
      setActiveSessionId(null)
      setSessionSaveState('idle')
      setRestoredSession(null)
    }
  }

  function handleRenameSession(id: string, newTitle: string) {
    const sessions = loadSessions()
    const s = sessions.find(x => x.id === id)
    if (!s) return
    updateSession({ ...s, title: newTitle })
    setSavedSessions(loadSessions())
  }

  function handleUpdateSessionNotes(id: string, notes: string) {
    const sessions = loadSessions()
    const s = sessions.find(x => x.id === id)
    if (!s) return
    updateSession({ ...s, notes })
    setSavedSessions(loadSessions())
  }

  function handleExportMd(session: SavedResearchSession) {
    const md = exportSessionMarkdown(session)
    const blob = new Blob([md], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: `${session.title.replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 60)}.md`,
    })
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const showSaveRow = query.trim() !== '' && (
    synthesisStatus === 'ready' ||
    synthesisStatus === 'fallback' ||
    synthesisStatus === 'insufficient' ||
    answer.status !== 'empty'
  )

  const saveSlot = showSaveRow ? (
    <>
      <div className="session-save-row">
        <button
          className="session-save-btn"
          onClick={handleSaveSession}
          aria-label={activeSessionId ? 'Update saved session' : 'Save this research session'}
        >
          <BookmarkPlus size={15} />
          {activeSessionId ? 'Update session' : 'Save session'}
        </button>
        {sessionSaveState === 'saved' && (
          <span className="session-state-badge session-state-saved">Saved locally</span>
        )}
        {sessionSaveState === 'unsaved-changes' && (
          <span className="session-state-badge session-state-unsaved">Unsaved changes</span>
        )}
        {sessionSaveState === 'restored' && (
          <span className="session-state-badge session-state-restored">Restored saved session</span>
        )}
      </div>
      <div className="session-notes-row">
        <textarea
          className="session-notes-input"
          placeholder="Add research notes for this session…"
          value={sessionNotes}
          onChange={e => setSessionNotes(e.target.value)}
          rows={2}
          aria-label="Session notes"
        />
      </div>
    </>
  ) : null

  const hasActiveContent = query.trim() !== '' || uploadedPDF !== null || agentMode === 'chat-with-pdf';

  return (
    <div className={`app-shell-container ${hasActiveContent ? 'has-active-content' : 'is-landing'}`}>
      {/* LANDING VIEW */}
      <div className="landing-view-wrapper">
        <main className="app-shell landing-mode">
          <div className="landing-container">
            <header className="landing-header">
              <div className="landing-logo">
                <GraduationCap size={48} className="logo-icon" />
              </div>
              <h1 className="landing-title">Let's jump in, researcher.</h1>
              <p className="landing-subtitle">
                Search the local evidence base and live OpenAlex academic databases. Get source-grounded AI synthesis with zero hallucinations.
              </p>
            </header>

            <div className="landing-search-row-container">
              <section className="landing-search-band">
                <div className="search-box-row">
                  <AgentModeSelector currentMode={agentMode} onChange={setAgentMode} />

                  <label className="search-box">
                    <Search size={20} />
                    <div className="search-input-wrap">
                      {!inputValue && !searchFocused && (
                        <span className="search-typewriter" aria-hidden="true">
                          {typewriterText}<span className="search-cursor" />
                        </span>
                      )}
                      <input
                        value={inputValue}
                        onChange={(event) => setInputValue(event.target.value)}
                        onKeyDown={(event) => { if (event.key === 'Enter') handleSearch(inputValue) }}
                        onFocus={() => setSearchFocused(true)}
                        onBlur={() => setSearchFocused(false)}
                        placeholder=""
                        aria-label="Search research database"
                      />
                    </div>
                  </label>

                  <div className="filter-inline-wrapper">
                    <button
                      className={`filter-inline-btn${hasActiveFilters ? ' filter-toggle-active' : ''}`}
                      onClick={() => setShowFilters(v => !v)}
                      aria-label="Toggle evidence filters"
                      aria-expanded={showFilters}
                      type="button"
                    >
                      <Settings2 size={18} />
                      {hasActiveFilters && <span className="filter-active-dot" aria-hidden="true" />}
                    </button>
                    {showFilters && (
                      <div className="filter-popover" role="region" aria-label="Evidence filters" ref={landingFilterPopoverRef}>
                        <div className="section-title">
                          <Filter size={17} />
                          Evidence Filters
                        </div>

                        <fieldset>
                          <legend>Source groups</legend>
                          {sourceTypes.map((type) => (
                            <label key={type} className="check-row">
                              <input
                                type="checkbox"
                                checked={filters.sourceTypes.includes(type)}
                                onChange={() => setFilters((current) => toggleSourceType(current, type))}
                              />
                              <span>{type}</span>
                            </label>
                          ))}
                        </fieldset>

                        <label className="control">
                          Peer review
                          <select
                            value={filters.peerReviewed}
                            onChange={(event) =>
                              setFilters((current) => ({ ...current, peerReviewed: event.target.value as ResearchFilters['peerReviewed'] }))
                            }
                          >
                            <option value="any">Any</option>
                            <option value="yes">Peer-reviewed only</option>
                            <option value="no">Non-peer-reviewed</option>
                          </select>
                        </label>

                        <label className="control">
                          Verification label
                          <select
                            value={filters.verification}
                            onChange={(event) =>
                              setFilters((current) => ({ ...current, verification: event.target.value as ResearchFilters['verification'] }))
                            }
                          >
                            <option value="any">Any local record</option>
                            <option value="claims-verified">Copied claim says verified</option>
                            <option value="needs-review">Needs review</option>
                          </select>
                        </label>

                        <label className="control">
                          Region
                          <select
                            value={filters.region}
                            onChange={(event) => setFilters((current) => ({ ...current, region: event.target.value as Region | 'any' }))}
                          >
                            <option value="any">Any region</option>
                            {regions.map((region) => (
                              <option key={region} value={region}>
                                {region.toUpperCase()}
                              </option>
                            ))}
                          </select>
                        </label>

                        <div className="year-grid">
                          <label className="control">
                            From
                            <input
                              type="number"
                              min="1800"
                              max={filters.yearTo}
                              value={filters.yearFrom}
                              onChange={(event) => setFilters((current) => ({ ...current, yearFrom: Number(event.target.value) }))}
                            />
                          </label>
                          <label className="control">
                            To
                            <input
                              type="number"
                              min={filters.yearFrom}
                              max={new Date().getFullYear() + 1}
                              value={filters.yearTo}
                              onChange={(event) => setFilters((current) => ({ ...current, yearTo: Number(event.target.value) }))}
                            />
                          </label>
                        </div>

                        <label className="check-row warning-toggle">
                          <input
                            type="checkbox"
                            checked={filters.warnings === 'hide-warning'}
                            onChange={(event) =>
                              setFilters((current) => ({ ...current, warnings: event.target.checked ? 'hide-warning' : 'any' }))
                            }
                          />
                          <span>Hide records with review notes</span>
                        </label>

                        <button className="filter-close-btn" onClick={() => setShowFilters(false)}>
                          <X size={14} />
                          Close
                        </button>
                      </div>
                    )}
                  </div>
                  
                  <button
                    className="search-submit-btn"
                    onClick={() => handleSearch(inputValue)}
                    type="button"
                    aria-label="Submit search"
                  >
                    <ArrowRight size={18} />
                  </button>
                </div>
              </section>
            </div>

            <section className="landing-suggestions">
              <h3 className="suggestions-title">Try searching for:</h3>
              <div className="suggestions-grid">
                {examples.map((ex) => (
                  <button
                    key={ex}
                    className="suggestion-pill"
                    onClick={() => handleSearch(ex)}
                  >
                    <Sparkles size={14} className="pill-spark" />
                    <span>{ex}</span>
                  </button>
                ))}
              </div>
            </section>


          </div>
        </main>
      </div>

      {/* ACTIVE VIEW */}
      <div className="active-view-wrapper">
        <main className="app-shell active-mode">
          <header className="topbar">
            <div className="topbar-left-container">
              <button
                className="topbar-back-btn"
                onClick={handleGoHome}
                aria-label="Back to home page"
              >
                <ArrowLeft size={16} />
                <span>Back</span>
              </button>
              <div className="topbar-divider" />
              <div
                className="topbar-left"
                onClick={handleGoHome}
                style={{ cursor: 'pointer' }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleGoHome() }}
                title="Go to Home"
              >
                <GraduationCap size={28} className="topbar-logo-icon" />
              </div>
            </div>
            <div className="topbar-actions">
              {showSaveRow && (
                <button
                  className={`topbar-icon-btn${sessionSaveState === 'saved' ? ' topbar-icon-btn--saved' : ''}`}
                  onClick={handleSaveSession}
                  aria-label={activeSessionId ? 'Update saved session' : 'Save this research session'}
                  title={activeSessionId ? 'Update session' : 'Save session'}
                >
                  <BookmarkPlus size={16} />
                </button>
              )}
              <button
                className="sessions-open-btn"
                onClick={() => setShowSessionsSidebar(true)}
                aria-label={`Saved sessions, ${savedSessions.length} saved`}
              >
                <FolderOpen size={16} />
              </button>
            </div>
          </header>

          {openAlexStatus === 'failed' && (
            <div className="openalex-warning" role="alert">
              Live OpenAlex search unavailable. Showing local seed evidence only.
            </div>
          )}
          {openAlexStatus === 'loading' && (
            <div className="openalex-loading" aria-live="polite">
              Searching OpenAlex live sources…
            </div>
          )}



          <section className={`workspace ${(agentMode === 'literature-review' || agentMode === 'deep-research-report' || agentMode === 'chat-with-pdf') ? 'workspace--full-width' : 'workspace--unified'}`}>
            {agentMode === 'chat-with-pdf' ? (
              <ChatWithPDFView
                uploadedPDF={uploadedPDF}
                onPDFUpload={handlePDFUpload}
                onRemovePDF={handleRemovePDF}
                onCitationClick={handleCitationClick}
              />
            ) : agentMode === 'literature-review' ? (
              <LiteratureReviewView
                text={streamingText || (synthesisResult ? (synthesisResult as any).rawText || '' : '')}
                isLoading={synthesisStatus === 'loading'}
                onAddToNotebook={handleAddToNotebook}
                query={query}
                onCitationClick={handleCitationClick}
              />
            ) : agentMode === 'deep-research-report' ? (
              <DeepResearchReportView
                text={streamingText || (synthesisResult ? (synthesisResult as any).rawText || '' : '')}
                isLoading={synthesisStatus === 'loading'}
                onAddToNotebook={handleAddToNotebook}
                query={query}
                onCitationClick={handleCitationClick}
              />
            ) : (
              <div className="unified-panel">
                <section className="synthesis-col" aria-label="source-backed answer">
                  {agentMode === 'ai-search' ? (
                    <div className="synthesis-col-body">
                      <div className="ai-search-answer">
                        <div className="synthesis-header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                          <h2 style={{ margin: 0 }}>AI Search Synthesis</h2>
                        </div>
                        {synthesisStatus === 'loading' && !streamingText ? (
                          <div className="loading-state-box">
                            <Loader2 className="animate-spin text-accent" size={32} />
                            <p>Searching sources and synthesizing answer...</p>
                          </div>
                        ) : (
                          <div className="markdown-body-content">
                            {renderMarkdownToReact(streamingText || (synthesisResult?.directAnswer ?? ''), handleCitationClick, isStreaming)}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <>
                      {query.trim() !== '' && (
                        <div className="synthesis-tabs" role="tablist">
                          <button
                            role="tab"
                            aria-selected={activeTab === 'chat'}
                            className={`synthesis-tab-btn ${activeTab === 'chat' ? 'active' : ''}`}
                            onClick={() => setActiveTab('chat')}
                          >
                            <MessageSquare size={15} />
                            <span>Research Dossier</span>
                          </button>
                          <button
                            role="tab"
                            aria-selected={activeTab === 'matrix'}
                            className={`synthesis-tab-btn ${activeTab === 'matrix' ? 'active' : ''}`}
                            onClick={() => setActiveTab('matrix')}
                          >
                            <Table size={15} />
                            <span>Methodology Matrix</span>
                          </button>
                          <button
                            role="tab"
                            aria-selected={activeTab === 'timeline'}
                            className={`synthesis-tab-btn ${activeTab === 'timeline' ? 'active' : ''}`}
                            onClick={() => setActiveTab('timeline')}
                          >
                            <Clock size={15} />
                            <span>Citation Timeline</span>
                          </button>
                        </div>
                      )}
                      <div className="synthesis-col-body">

                      <div className="chat-container">
                        {activeTab === 'chat' && chatHistory.map((message) => {
                          const isUser = message.role === 'user'
                          return (
                    <div
                      key={message.id}
                      className={`chat-message ${isUser ? 'chat-message--user' : 'chat-message--assistant'}`}
                    >
                      <div className="chat-bubble">
                        {isUser ? (
                          <p className="chat-message-query-text">{message.content}</p>
                        ) : (
                          // Assistant response
                          <div>
                            {/* If it's a follow-up response */}
                            {message.isFollowup ? (
                              <div>
                                {message.status === 'loading' && (
                                  <div className="synthesis-streaming">
                                    <div className="status-strip loading">
                                      <Sparkles size={18} />
                                      <span>Generating answer…</span>
                                    </div>
                                    <div className="streaming-content">
                                      {renderMarkdownToReact(message.streamingText || '', handleCitationClick, true)}
                                    </div>
                                  </div>
                                )}

                                {message.status === 'ready' && (
                                  <div className="markdown-body-content">
                                    {renderMarkdownToReact(message.content || '', handleCitationClick, false)}
                                  </div>
                                )}

                                {message.status === 'error' && (
                                  <div className="status-strip limited">
                                    <AlertTriangle size={18} />
                                    <span>{message.content}</span>
                                  </div>
                                )}
                              </div>
                            ) : (
                              // Initial synthesis dossier response
                              <div>
                                {message.status === 'loading' && (
                                  <StreamingAnswerView text={message.streamingText || ''} />
                                )}

                                {message.status === 'ready' && message.synthesis && (
                                  <>
                                    <div className="synthesis-header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                                      <h2 style={{ margin: 0 }}>{query.trim()}</h2>
                                      <button
                                        className="export-citations-btn"
                                        onClick={() => setShowSynthesisExport(true)}
                                        style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', padding: '6px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-local)', color: 'var(--text-local)' }}
                                      >
                                        <Download size={14} />
                                        Export Citations / LaTeX
                                      </button>
                                    </div>

                                    {message.synthesis.detailedAnswer.length > 0 && (
                                      <div className="answer-block">
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                          <h3 style={{ margin: 0 }}>Detailed Explanation</h3>
                                          <button
                                            className="notebook-add-section-btn"
                                            onClick={() => {
                                              const content = message.synthesis?.detailedAnswer.join('\n\n') || ''
                                              handleAddToNotebook(`Detailed Explanation for "${query}":\n${content}`)
                                            }}
                                            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', color: 'var(--primary)', border: 'none', background: 'transparent', cursor: 'pointer' }}
                                          >
                                            <Plus size={12} /> Add to Notebook
                                          </button>
                                        </div>
                                        {message.synthesis.detailedAnswer.map((paragraph, i) => (
                                          <p key={i} className="brief-paragraph">
                                            {parseCitationsToReact(paragraph, handleCitationClick)}
                                          </p>
                                        ))}
                                      </div>
                                    )}

                                    <div className="answer-block">
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                        <h3 style={{ margin: 0 }}>Summary</h3>
                                        <button
                                          className="notebook-add-section-btn"
                                          onClick={() => {
                                            const content = message.synthesis?.directAnswer || ''
                                            handleAddToNotebook(`Summary for "${query}":\n${content}`)
                                          }}
                                          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', color: 'var(--primary)', border: 'none', background: 'transparent', cursor: 'pointer' }}
                                        >
                                          <Plus size={12} /> Add to Notebook
                                        </button>
                                      </div>
                                      <p className="summary">
                                        {parseCitationsToReact(message.synthesis.directAnswer, handleCitationClick)}
                                      </p>
                                    </div>

                                    <div className="citation-row-wrapper">
                                      <div className="citation-row">
                                        {message.synthesis.sourcesUsed.map((source) => (
                                          <button
                                            key={source.marker}
                                            className="citation-link"
                                            style={{ padding: '6px 12px', fontSize: '0.82rem', border: '1px solid var(--border-color)' }}
                                            onClick={() => handleCitationClick(source.marker)}
                                          >
                                            {source.marker}: {source.title}
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                    {showSynthesisExport && (
                                      <ExportModal
                                        sources={message.synthesis.sourcesUsed.map(fromSynthesisSource)}
                                        query={query}
                                        synthesis={message.synthesis}
                                        onClose={() => setShowSynthesisExport(false)}
                                      />
                                    )}
                                  </>
                                )}

                                {message.status === 'insufficient' && message.synthesis && (
                                  <>
                                    <div className="status-strip limited">
                                      <AlertTriangle size={18} />
                                      <span>Limited evidence</span>
                                    </div>
                                    <p className="summary">The retrieved sources are insufficient to answer this confidently.</p>
                                    <hr className="section-divider" />
                                    <DeterministicAnswer answer={answer} />
                                  </>
                                )}

                                {message.status === 'fallback' && (
                                  <>
                                    <div className="synthesis-warning" role="alert">
                                      AI synthesis unavailable. Showing deterministic source summary.
                                    </div>
                                    <DeterministicAnswer answer={answer} />
                                  </>
                                )}

                                {message.status === 'idle' && (
                                  <DeterministicAnswer answer={answer} />
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}

                {activeTab === 'chat' && uploadedPDF?.status === 'complete' && uploadedPDF.analysis && (
                  <PDFAnalysisPanel
                    state={uploadedPDF}
                    onAddToEvidence={handleAddPDFToEvidence}
                  />
                )}

                {(activeTab === 'matrix' || activeTab === 'timeline') && (
                  <EvidenceHealthDashboard results={results} />
                )}

                {activeTab === 'matrix' && (
                  <MethodologyMatrix
                    results={results}
                    globalMarkerMap={globalMarkerMap}
                    uploadedPDF={uploadedPDF}
                    onCitationClick={handleCitationClick}
                    onOpenDetail={(item, marker) => handleOpenDetail(item, marker)}
                  />
                )}

                {activeTab === 'timeline' && (
                  <CitationTimeline
                    results={results}
                    globalMarkerMap={globalMarkerMap}
                    onCitationClick={handleCitationClick}
                    onOpenDetail={(item, marker) => handleOpenDetail(item, marker)}
                  />
                )}

                <div ref={chatEndRef} />
              </div>

              {activeTab === 'chat' && query.trim() !== '' && (synthesisStatus === 'ready' || synthesisStatus === 'insufficient' || synthesisStatus === 'fallback') && (
                <div className="followup-input-container">
                  <form onSubmit={handleFollowupSubmit} className="followup-input-wrapper">
                    <textarea
                      ref={textareaRef}
                      className="followup-input-field"
                      placeholder="Ask a follow-up question about these sources..."
                      value={followupText}
                      onChange={(e) => setFollowupText(e.target.value.slice(0, 500))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          handleFollowupSubmit()
                        }
                      }}
                      rows={1}
                    />
                    <span className="character-count" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {followupText.length}/500
                    </span>
                    <button
                      type="submit"
                      className="followup-action-btn followup-send-btn"
                      disabled={followupLoading || !followupText.trim()}
                      aria-label="Send follow-up question"
                    >
                      <Send size={16} />
                    </button>
                  </form>
                </div>
              )}
              </div>
            </>
          )}
        </section>

            <aside className="sources-col" aria-label="source evidence panel">
              <div className="sources-col-header">
                <h4>Sources</h4>
                <span className="sources-count-badge">{results.length}</span>
              </div>

                <div className="source-groups">
                  {isStreaming && revealedMarkers.size > 0 ? (
                    streamingKnownSources
                      .map((source, index) => ({ source, index, key: `S${index + 1}` }))
                      .filter(({ key }) => revealedMarkers.has(key))
                      .map(({ index }) => {
                        const marker = index + 1
                        const item = results[index]
                        if (!item) return null
                        return (
                          <SourceCard
                            key={`streaming-s${marker}`}
                            item={item}
                            marker={marker}
                            onOpenDetail={(i) => handleOpenDetail(i, marker)}
                            onAddToNotebook={handleAddToNotebook}
                            revealed
                          />
                        )
                      })
                  ) : (isStreaming || openAlexStatus === 'loading' || synthesisStatus === 'loading') ? (
                    <div className="evidence-trail-waiting">
                      <Sparkles size={14} />
                      <span>Sources will appear as they're cited…</span>
                    </div>
                  ) : (
                    sourceTypes.map((type) => {
                      const items = grouped[type]
                      if (!items.length) return null
                      return (
                        <section key={type} className="source-group">
                          <h3>{sourceTypeLabels[type]}</h3>
                          {items.map((item, index) => {
                            const marker = globalMarkerMap.get(item.id) ?? index + 1
                            return (
                              <SourceCard
                                key={item.id}
                                item={item}
                                marker={marker}
                                onOpenDetail={(i) => handleOpenDetail(i, marker)}
                                onAddToNotebook={handleAddToNotebook}
                              />
                            )
                          })}
                        </section>
                      )
                    })
                  )}
                </div>
            </aside>
              </div>
        )}
      </section>
        </main>
      </div>

      {/* SHARED MODALS */}
      {selectedSource !== null && (
        <SourceDetailModal item={selectedSource} marker={selectedSourceMarker} onClose={handleCloseDetail} />
      )}

      {showSessionsSidebar && (
        <SessionsSidebar
          sessions={savedSessions}
          onClose={() => setShowSessionsSidebar(false)}
          onReopen={handleRestoreSession}
          onDelete={handleDeleteSession}
          onRename={handleRenameSession}
          onUpdateNotes={handleUpdateSessionNotes}
          onExportMd={handleExportMd}
        />
      )}

      {/* Researcher Notebook Floating Trigger Button */}
      {!isNotebookOpen && (
        <button
          className="notebook-trigger-btn"
          onClick={() => setIsNotebookOpen(true)}
          title="Open Researcher Notebook"
        >
          <BookOpen size={16} />
          <span>Notebook</span>
          {notebookContent.trim() && (
            <span className="notebook-indicator-dot" />
          )}
        </button>
      )}

      {/* Researcher Notebook Drawer */}
      {isNotebookOpen && (
        <div
          className="notebook-drawer"
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            width: '100%',
            height: `${notebookHeight}px`,
            background: 'white',
            borderTop: '1px solid var(--border-color)',
            boxShadow: '0 -10px 25px -5px rgba(0, 0, 0, 0.1)',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            animation: 'slideUp 0.3s cubic-bezier(0.25, 1, 0.5, 1)'
          }}
        >
          {/* Drag Resize Handle */}
          <div
            className="notebook-resize-handle"
            onMouseDown={handleMouseDown}
            style={{
              position: 'absolute',
              top: '-4px',
              left: 0,
              width: '100%',
              height: '8px',
              cursor: 'ns-resize',
              zIndex: 1005,
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <div
              className="notebook-resize-pill"
              style={{
                width: '40px',
                height: '4px',
                background: 'var(--border-color)',
                borderRadius: '2px',
                opacity: 0.6,
              }}
            />
          </div>

          {/* Drawer Header */}
          <div
            className="notebook-header"
            style={{
              padding: '12px 24px',
              borderBottom: '1px solid var(--border-color)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: 'var(--bg-local)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, color: 'var(--text-primary)' }}>
                <BookOpen size={18} />
                <span>Researcher Notebook</span>
              </div>
              <div className="notebook-mode-tabs" style={{ display: 'flex', background: 'var(--border-color)', padding: '2px', borderRadius: '6px' }}>
                <button
                  onClick={() => setNotebookViewTab('edit')}
                  style={{
                    padding: '3px 10px',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    borderRadius: '4px',
                    background: notebookViewTab === 'edit' ? 'white' : 'transparent',
                    color: notebookViewTab === 'edit' ? 'var(--primary)' : 'var(--text-secondary)',
                    boxShadow: notebookViewTab === 'edit' ? 'var(--shadow-sm)' : 'none'
                  }}
                >
                  Edit
                </button>
                <button
                  onClick={() => setNotebookViewTab('preview')}
                  style={{
                    padding: '3px 10px',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    borderRadius: '4px',
                    background: notebookViewTab === 'preview' ? 'white' : 'transparent',
                    color: notebookViewTab === 'preview' ? 'var(--primary)' : 'var(--text-secondary)',
                    boxShadow: notebookViewTab === 'preview' ? 'white' : 'none'
                  }}
                >
                  Preview
                </button>
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {(() => {
                  const words = notebookContent.trim() ? notebookContent.trim().split(/\s+/).length : 0;
                  const mins = Math.max(1, Math.ceil(words / 200));
                  return `Words: ${words} | Read Time: ~${mins} min`;
                })()}
              </span>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(notebookContent)
                  alert('Copied notebook content to clipboard!')
                }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}
              >
                <Copy size={13} /> Copy All
              </button>
              <button
                onClick={() => {
                  const blob = new Blob([notebookContent], { type: 'text/markdown' })
                  const url = URL.createObjectURL(blob)
                  const a = Object.assign(document.createElement('a'), {
                    href: url,
                    download: 'research-notebook.md',
                  })
                  document.body.appendChild(a)
                  a.click()
                  document.body.removeChild(a)
                  URL.revokeObjectURL(url)
                }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}
              >
                <Download size={13} /> Download MD
              </button>
              <button
                onClick={() => {
                  if (confirm('Are you sure you want to clear your notebook?')) {
                    setNotebookContent('')
                  }
                }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', color: 'var(--text-danger)' }}
              >
                <X size={13} /> Clear
              </button>
              <span style={{ color: 'var(--border-hover)' }}>|</span>
              <button
                onClick={() => setIsNotebookOpen(false)}
                style={{ padding: '4px', color: 'var(--text-muted)' }}
              >
                <X size={18} />
              </button>
            </div>
          </div>



          {/* Drawer Body */}
          <div style={{ flex: 1, padding: '12px 24px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {notebookViewTab === 'edit' ? (
              <textarea
                style={{
                  flex: 1,
                  width: '100%',
                  border: 'none',
                  resize: 'none',
                  outline: 'none',
                  fontFamily: 'inherit',
                  fontSize: '0.95rem',
                  lineHeight: '1.6',
                  color: 'var(--text-primary)'
                }}
                placeholder="Start drafting your notes, lit review outline, or paste references here..."
                value={notebookContent}
                onChange={(e) => setNotebookContent(e.target.value)}
              />
            ) : (
              <div
                className="notebook-preview-area"
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  lineHeight: '1.6',
                  color: 'var(--text-primary)',
                  paddingRight: '8px'
                }}
              >
                {notebookContent.trim() ? (
                  renderMarkdownToReact(notebookContent, handleCitationClick, false)
                ) : (
                  <p style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>No content to preview yet. Switch back to Edit to write some notes.</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function PDFAnalysisPanel({
  state,
  onAddToEvidence,
}: {
  state: UploadedPDFState
  onAddToEvidence: () => void
}) {
  const [activeTab, setActiveTab] = useState<'metadata' | 'analysis' | 'limitations'>('metadata')
  const analysis = state.analysis!

  const confidenceClass = {
    high: 'confidence-high',
    medium: 'confidence-medium',
    low: 'confidence-low',
    insufficient: 'confidence-insufficient',
  }[analysis.confidence]

  return (
    <div className="pdf-analysis-panel" aria-label="Uploaded paper analysis">
      <div className="pdf-analysis-header">
        <div className="pdf-analysis-title-row">
          <FileUp size={16} />
          <span className="pdf-analysis-title">Uploaded Paper Analysis</span>
          <span className={`pdf-confidence-badge ${confidenceClass}`}>
            Confidence: {analysis.confidence}
          </span>
        </div>
        <div className="pdf-analysis-badges">
          <span className="badge badge-uploaded">Uploaded PDF</span>
          <span className="pdf-unverified-label">Not independently verified</span>
          {state.enrichmentLabel && (
            <span className="pdf-enrichment-label">{state.enrichmentLabel}</span>
          )}
        </div>
      </div>

      <div className="pdf-analysis-tabs" role="tablist">
        {(['metadata', 'analysis', 'limitations'] as const).map(tab => (
          <button
            key={tab}
            role="tab"
            aria-selected={activeTab === tab}
            className={activeTab === tab ? 'active' : undefined}
            onClick={() => setActiveTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      <div className="pdf-analysis-body">
        {activeTab === 'metadata' && (
          <dl className="detail-dl">
            <dt>Title</dt>
            <dd>{analysis.title ?? <em>Not extracted</em>}</dd>

            <dt>Authors</dt>
            <dd>{analysis.authors.length > 0 ? analysis.authors.join('; ') : <em>Not extracted</em>}</dd>

            <dt>Year</dt>
            <dd>{analysis.year ?? <em>Not extracted</em>}</dd>

            <dt>DOI</dt>
            <dd>{analysis.doi ?? <em>Not extracted</em>}</dd>

            <dt>Related keywords</dt>
            <dd>
              {analysis.relatedKeywords.length > 0
                ? <div className="detail-tag-row">{analysis.relatedKeywords.map(k => <span key={k} className="detail-tag">{k}</span>)}</div>
                : <em>None extracted</em>}
            </dd>
          </dl>
        )}

        {activeTab === 'analysis' && (
          <div className="pdf-analysis-content">
            {analysis.researchQuestion && (
              <div className="pdf-section">
                <h4>Research Question</h4>
                <p>{analysis.researchQuestion}</p>
              </div>
            )}
            {analysis.methodology && (
              <div className="pdf-section">
                <h4>Methodology</h4>
                <p>{analysis.methodology}</p>
              </div>
            )}
            {analysis.datasetOrSample && (
              <div className="pdf-section">
                <h4>Dataset / Sample</h4>
                <p>{analysis.datasetOrSample}</p>
              </div>
            )}
            {analysis.keyFindings.length > 0 && (
              <div className="pdf-section">
                <h4>Key Findings</h4>
                <ul>{analysis.keyFindings.map((f, i) => <li key={i}>{f}</li>)}</ul>
              </div>
            )}
            {analysis.importantQuotesOrClaims.length > 0 && (
              <div className="pdf-section">
                <h4>Important Quotes / Claims</h4>
                <ul>{analysis.importantQuotesOrClaims.map((q, i) => <li key={i}><em>"{q}"</em></li>)}</ul>
              </div>
            )}
            {analysis.summaryForPhDStudent && (
              <div className="pdf-section">
                <h4>Summary for PhD Student</h4>
                <p>{analysis.summaryForPhDStudent}</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'limitations' && (
          <div className="pdf-analysis-content">
            {analysis.limitations.length > 0 ? (
              <div className="pdf-section">
                <h4>Paper Limitations</h4>
                <ul>{analysis.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
              </div>
            ) : (
              <p><em>No limitations extracted from text.</em></p>
            )}
            <div className="pdf-section pdf-extraction-note">
              <h4>Extraction Notes</h4>
              <ul>
                <li>Analysis is based on extracted PDF text only — model training data was not used.</li>
                <li>Scanned or image-only PDFs cannot be extracted.</li>
                <li>Long PDFs are truncated at 24,000 characters. Results may be incomplete.</li>
                <li>This app does not verify authorship, peer review status, or claim accuracy.</li>
              </ul>
            </div>
          </div>
        )}
      </div>

      <div className="pdf-analysis-footer">
        {state.addedToEvidence ? (
          <span className="pdf-added-badge">
            <CheckCircle2 size={14} />
            Added to evidence trail
          </span>
        ) : (
          <button className="pdf-add-evidence-btn" onClick={onAddToEvidence}>
            Add to Evidence
          </button>
        )}
      </div>
    </div>
  )
}

function DeterministicAnswer({ answer, dimmed = false }: { answer: ReturnType<typeof composeEvidenceAnswer>; dimmed?: boolean }) {
  return (
    <div style={dimmed ? { opacity: 0.5 } : undefined}>
      <div className={`status-strip ${answer.status}`}>
        {answer.status === 'ready' ? <ShieldCheck size={18} /> : <AlertTriangle size={18} />}
        <span>{answer.status === 'ready' ? 'Source-backed synthesis' : 'Limited evidence'}</span>
      </div>

      <h2>{answer.headline}</h2>
      
      <div className="answer-block">
        <h3>Summary</h3>
        <p className="summary">{answer.summary}</p>
      </div>

      <div className="citation-row-wrapper">
        <div className="citation-row">
          {answer.citedItems.map((item, index) => (
            <a key={item.id} href={item.url} target="_blank" rel="noreferrer">
              S{index + 1}: {item.title}
              <ExternalLink size={13} />
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}

function StreamingAnswerView({ text }: { text: string }) {
  const sectionLabels: Record<string, string> = {
    'DETAIL:': 'Detailed Explanation',
    'SUMMARY:': 'Summary',
    'DIRECT:': 'Summary',
  }

  const lines = text.split('\n')
  const nodes: React.ReactNode[] = []
  let lastSection = ''

  lines.forEach((rawLine, i) => {
    const line = rawLine.trim()
    if (!line) return

    const matchedPrefix = Object.keys(sectionLabels).find((p) => line.startsWith(p))
    if (matchedPrefix) {
      const section = sectionLabels[matchedPrefix]
      const content = line.slice(matchedPrefix.length).trim()
      if (section !== lastSection) {
        nodes.push(<h3 key={`h-${i}`} className="streaming-section-label">{section}</h3>)
        lastSection = section
      }
      if (content) nodes.push(<p key={`p-${i}`} className="streaming-line">{content}</p>)
    } else {
      const ignoredPrefixes = ['EVIDENCE:', 'COMPARE:', 'LIMIT:', 'USEFUL:', 'CONFIDENCE:']
      const isIgnored = ignoredPrefixes.some((p) => line.startsWith(p))
      if (!isIgnored) {
        nodes.push(<p key={`p-${i}`} className="streaming-line">{line}</p>)
      }
    }
  })

  return (
    <div className="synthesis-streaming">
      <div className="status-strip loading">
        <Sparkles size={18} />
        <span>Synthesising…</span>
      </div>
      <div className="streaming-content">
        {text ? (
          <>
            {nodes}
            <span className="streaming-cursor" aria-hidden="true" />
          </>
        ) : (
          <div className="synthesis-skeleton">
            <div className="skeleton-line skeleton-title"></div>
            <div className="skeleton-line skeleton-paragraph"></div>
            <div className="skeleton-line skeleton-paragraph"></div>
            <div className="skeleton-line skeleton-paragraph"></div>
          </div>
        )}
      </div>
    </div>
  )
}

function SourceCard({
  item,
  marker,
  onOpenDetail,
  onAddToNotebook,
  revealed = false,
}: {
  item: RankedResearchItem
  marker: number
  onOpenDetail: (item: RankedResearchItem) => void
  onAddToNotebook: (text: string) => void
  revealed?: boolean
}) {
  return (
    <article
      id={`source-card-S${marker}`}
      className={`source-card${revealed ? ' source-card--revealed' : ''}`}
      onClick={() => onOpenDetail(item)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenDetail(item) } }}
      tabIndex={0}
      aria-label={`View details for ${item.title}`}
    >
      <div className="card-top" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
        <span className="source-marker">S{marker}</span>
        {item.importedFrom === 'uploaded-pdf' && (
          <span className="badge badge-uploaded">Uploaded PDF</span>
        )}
        {item.peerReviewed ? (
          <span className="badge badge-peer-reviewed">
            <CheckCircle2 size={13} />
            Peer-Reviewed
          </span>
        ) : (
          <span className="badge badge-preprint">
            <AlertTriangle size={13} />
            Preprint / Unreviewed
          </span>
        )}
        {item.citationCount > 100 ? (
          <span className="badge badge-highly-cited">
            <Sparkles size={13} />
            Highly Cited ({item.citationCount})
          </span>
        ) : item.citationCount > 0 ? (
          <span className="badge badge-citations">
            {item.citationCount} Citations
          </span>
        ) : null}
        {(() => {
          const warn = getSampleWarning(item);
          return warn ? (
            <span className="badge badge-sample-warning">
              <AlertTriangle size={13} />
              {warn}
            </span>
          ) : null;
        })()}
        {item.retracted && (
          <span className="badge danger">
            <AlertTriangle size={13} />
            retracted
          </span>
        )}
      </div>

      <h4>{item.title}</h4>
      <p className="meta">
        {item.sourceName} · {item.year} · {item.region.toUpperCase()}
      </p>
      <div className="source-footer">
        <span>
          <BookOpen size={14} />
          {item.authors.slice(0, 3).join(', ')}
          {item.authors.length > 3 ? ' et al.' : ''}
        </span>
        {item.importedFrom === 'uploaded-pdf' ? (
          <span className="pdf-unverified-label">User-provided — not independently verified</span>
        ) : (
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${item.title}`}
            onClick={(e) => e.stopPropagation()}
          >
            Open source
            <ExternalLink size={13} />
          </a>
        )}
      </div>

      <div className="trust-note">{item.trustNotes}</div>
    </article>
  )
}

function SourceDetailModal({
  item,
  marker,
  onClose,
}: {
  item: RankedResearchItem
  marker: number
  onClose: () => void
}) {
  const [citeFormat, setCiteFormat] = useState<CitationFormat>('APA')
  const [copied, setCopied] = useState(false)
  const drawerRef = useRef<HTMLDivElement>(null)
  const titleId = `source-detail-title-${item.id}`

  const explanation: TrustExplanation = explainSourceTrust(item)
  const citationText = formatCitation(fromResearchItem(item), citeFormat)

  useEffect(() => {
    drawerRef.current?.focus()
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  function handleCopy() {
    const done = () => { setCopied(true); setTimeout(() => setCopied(false), 2000) }
    navigator.clipboard.writeText(citationText).then(done).catch(() => {
      try {
        const ta = Object.assign(document.createElement('textarea'), { value: citationText })
        Object.assign(ta.style, { position: 'fixed', opacity: '0' })
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta)
      } catch { /* ignore */ }
      done()
    })
  }

  return (
    <div
      className="detail-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="detail-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={drawerRef}
        tabIndex={-1}
      >
        {/* Header */}
        <div className="detail-header">
          <div className="detail-header-badges">
            <span className="source-marker">S{marker}</span>
            {item.importedFrom === 'uploaded-pdf' && (
              <>
                <span className="badge badge-uploaded">Uploaded PDF</span>
                <span className="pdf-unverified-label">User-provided source — not independently verified</span>
              </>
            )}
          </div>
          <button className="cite-btn" aria-label="Close source detail" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <h2 id={titleId} className="detail-title">{item.title}</h2>

        <div className="detail-body">
          {/* Overview */}
          <section className="detail-section">
            <h3 className="detail-section-label">Overview</h3>
            <dl className="detail-dl">
              <dt>Year</dt>
              <dd>{item.year || 'Not available'}</dd>

              <dt>Authors</dt>
              <dd>{item.authors.length > 0 ? item.authors.join('; ') : 'Not available'}</dd>

              <dt>Venue / Source</dt>
              <dd>{item.sourceName || 'Not available'}</dd>

              <dt>Source type</dt>
              <dd>{item.sourceType}</dd>

              <dt>Region</dt>
              <dd>{item.region?.toUpperCase() || 'Not available'}</dd>

              <dt>URL</dt>
              <dd>
                {item.url
                  ? <a href={item.url} target="_blank" rel="noreferrer" className="detail-link">{item.url} <ExternalLink size={12} /></a>
                  : 'Not available'}
              </dd>

              <dt>DOI</dt>
              <dd>
                {item.doi
                  ? <a
                      href={item.doi.startsWith('http') ? item.doi : `https://doi.org/${item.doi}`}
                      target="_blank" rel="noreferrer" className="detail-link"
                    >{item.doi} <ExternalLink size={12} /></a>
                  : 'Not available'}
              </dd>

              <dt>Citation count</dt>
              <dd>{item.citationCount ?? 'Not available'}</dd>

              <dt>Peer reviewed</dt>
              <dd>
                {item.peerReviewed
                  ? <span className="badge good"><CheckCircle2 size={12} /> Yes</span>
                  : <span>No</span>}
              </dd>

              <dt>Human verification</dt>
              <dd>
                {item.verifiedByHuman
                  ? 'Claimed verified (copied flag — not independently confirmed by this app)'
                  : 'Not claimed'}
              </dd>

              <dt>Retracted</dt>
              <dd>
                {item.retracted
                  ? <span className="badge danger"><AlertTriangle size={12} /> Yes — treat with caution</span>
                  : 'No'}
              </dd>
            </dl>
          </section>

          {/* Abstract */}
          <section className="detail-section">
            <h3 className="detail-section-label">Abstract / Claim</h3>
            <p className="detail-abstract">{item.abstractOrClaim?.trim() || 'Not available'}</p>
          </section>

          {/* Trust Explanation */}
          <section className="detail-section">
            <h3 className="detail-section-label">Trust Explanation</h3>
            <p className="detail-trust-summary">{explanation.trustSummary}</p>
            <div className="detail-trust-quality-row">
              <span className={`detail-quality-badge detail-quality-${explanation.metadataQuality}`}>
                Metadata quality: {explanation.metadataQuality}
              </span>
            </div>

            {explanation.strengths.length > 0 && (
              <div className="detail-trust-block">
                <p className="detail-trust-block-label">Strengths</p>
                <ul className="detail-trust-list">
                  {explanation.strengths.map((s, i) => (
                    <li key={i} className="detail-trust-item detail-trust-strength">
                      <CheckCircle2 size={14} />
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {explanation.warnings.length > 0 && (
              <div className="detail-trust-block">
                <p className="detail-trust-block-label">Warnings</p>
                <ul className="detail-trust-list">
                  {explanation.warnings.map((w, i) => (
                    <li
                      key={i}
                      className={`detail-trust-item detail-trust-warning${i === 0 && item.retracted ? ' detail-trust-warning-lead' : ''}`}
                    >
                      <AlertCircle size={14} />
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {/* Metadata */}
          <section className="detail-section">
            <h3 className="detail-section-label">Metadata & Scores</h3>
            <dl className="detail-dl">
              <dt>Domain tags</dt>
              <dd>
                {item.domainTags.length > 0
                  ? <div className="detail-tag-row">{item.domainTags.map((tag) => <span key={tag} className="detail-tag">{tag}</span>)}</div>
                  : 'Not available'}
              </dd>

              <dt>Matched terms</dt>
              <dd>{item.matchedTerms.length > 0 ? item.matchedTerms.join(', ') : 'None'}</dd>

              <dt>Total score</dt>
              <dd>{item.totalScore.toFixed(2)}</dd>

              <dt>Relevance</dt>
              <dd>{item.relevance}</dd>

              <dt>Trust signal</dt>
              <dd>{item.trustSignal.toFixed(2)}</dd>

              <dt>Completeness</dt>
              <dd>{(item.audit.completeness * 100).toFixed(0)}%</dd>

              <dt>Trust notes</dt>
              <dd>{item.trustNotes || 'Not available'}</dd>
            </dl>

            {item.audit.issues.length > 0 && (
              <div className="detail-issues">
                <p className="detail-trust-block-label" style={{ marginTop: '14px' }}>Audit issues</p>
                <ul className="detail-issues-list">
                  {item.audit.issues.map((issue, i) => (
                    <li key={i} className={`detail-issue detail-issue-${issue.severity}`}>
                      <span className="detail-issue-field">{issue.field}</span>
                      <span>{issue.message}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {/* Citation */}
          <section className="detail-section">
            <h3 className="detail-section-label">Citation</h3>
            <div className="citation-format-tabs">
              {CITATION_FORMATS.map((f) => (
                <button key={f} className={f === citeFormat ? 'active' : undefined} onClick={() => setCiteFormat(f)}>
                  {f}
                </button>
              ))}
            </div>
            <pre className="citation-text">{citationText}</pre>
            <div className="detail-citation-actions">
              <button className="citation-copy-btn" onClick={handleCopy}>
                <Copy size={13} />
                {copied ? 'Copied!' : 'Copy'}
              </button>
              {item.importedFrom !== 'uploaded-pdf' && (
                <a href={item.url} target="_blank" rel="noreferrer" className="detail-open-btn">
                  Open source
                  <ExternalLink size={13} />
                </a>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function CitationPopover({
  source,
  format,
  onFormatChange,
  onClose,
}: {
  source: CitableSource
  format: CitationFormat
  onFormatChange: (f: CitationFormat) => void
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const citationText = formatCitation(source, format)

  function handleCopy() {
    const done = () => { setCopied(true); setTimeout(() => setCopied(false), 2000) }
    navigator.clipboard.writeText(citationText).then(done).catch(() => {
      try {
        const ta = Object.assign(document.createElement('textarea'), { value: citationText })
        Object.assign(ta.style, { position: 'fixed', opacity: '0' })
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta)
      } catch { /* ignore */ }
      done()
    })
  }

  return (
    <div className="citation-popover" role="dialog" aria-label="Cite this source">
      <div className="citation-popover-header">
        <span>Cite</span>
        <button className="cite-btn" aria-label="Close citation" onClick={onClose}>
          <X size={13} />
        </button>
      </div>
      <div className="citation-format-tabs">
        {CITATION_FORMATS.map((f) => (
          <button key={f} className={f === format ? 'active' : undefined} onClick={() => onFormatChange(f)}>
            {f}
          </button>
        ))}
      </div>
      <pre className="citation-text">{citationText}</pre>
      <button className="citation-copy-btn" onClick={handleCopy}>
        <Copy size={13} />
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  )
}

function ExportModal({
  sources,
  query,
  synthesis,
  onClose
}: {
  sources: CitableSource[]
  query: string
  synthesis: SynthesisResult | null
  onClose: () => void
}) {
  const [activeTab, setActiveTab] = useState<'citations' | 'workspace'>('workspace')
  const [citationFormat, setCitationFormat] = useState<CitationFormat>('APA')
  const [copied, setCopied] = useState(false)
  const [copiedTex, setCopiedTex] = useState(false)
  const [copiedBib, setCopiedBib] = useState(false)

  // 1. Generate BibTeX
  const bibtexText = useMemo(() => {
    return sources.map((s) => formatBibtex(s)).join('\n\n')
  }, [sources])

  // 2. Generate LaTeX Template
  const latexTemplateText = useMemo(() => {
    if (!synthesis) return '% No synthesis results available to generate template.'

    // Map markers to BibTeX keys
    const markerToKey: Record<string, string> = {}
    sources.forEach((s) => {
      const key = buildBibtexKey(s)
      synthesis.sourcesUsed.forEach((su) => {
        if (su.title === s.title) {
          markerToKey[su.marker] = key
        }
      })
    })

    // Helper to replace [S1] with \cite{key}
    const replaceCitations = (text: string) => {
      return text.replace(/\[S(\d+)\]/g, (match, num) => {
        const marker = `S${num}`
        const key = markerToKey[marker]
        return key ? `\\cite{${key}}` : match
      })
    }

    const detailedText = synthesis.detailedAnswer.map(p => replaceCitations(p)).join('\n\n')
    const directText = replaceCitations(synthesis.directAnswer)

    return `\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\usepackage{hyperref}
\\usepackage{booktabs}

\\title{Research Dossier: ${escapeLatex(query)}}
\\author{AI Research Assistant}
\\date{\\today}

\\begin{document}
\\maketitle

\\begin{abstract}
${escapeLatex(directText)}
\\end{abstract}

\\section{Introduction}
This document contains the source-grounded synthesis generated in response to the research query: \\textit{${escapeLatex(query)}}.

\\section{Detailed Explanation}
${detailedText}

\\bibliographystyle{plain}
\\bibliography{references}

\\end{document}
`
  }, [synthesis, sources, query])

  function escapeLatex(text: string): string {
    return text
      .replace(/\\/g, '\\\\')
      .replace(/&/g, '\\&')
      .replace(/%/g, '\\%')
      .replace(/\$/g, '\\$')
      .replace(/#/g, '\\#')
      .replace(/_/g, '\\_')
      .replace(/\{/g, '\\{')
      .replace(/\}/g, '\\}')
      .replace(/\~/g, '\\textasciitilde')
      .replace(/\^/g, '\\textasciicircum')
  }

  function handleDownloadFile(text: string, filename: string) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: filename,
    })
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  function handleBackdrop(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div className="export-overlay" role="dialog" aria-modal="true" onClick={handleBackdrop}>
      <div className="export-modal" style={{ maxWidth: '850px', width: '95%' }}>
        <div className="export-modal-header">
          <span>Export Research & Citations ({sources.length} sources)</span>
          <button className="cite-btn" aria-label="Close export" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="export-type-tabs" style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border-color)', marginBottom: '16px', paddingBottom: '8px' }}>
          <button className={`panel-tab-btn ${activeTab === 'workspace' ? 'active' : ''}`} onClick={() => setActiveTab('workspace')}>
            LaTeX & BibTeX Workspace
          </button>
          <button className={`panel-tab-btn ${activeTab === 'citations' ? 'active' : ''}`} onClick={() => setActiveTab('citations')}>
            Citations (Formatted Text)
          </button>
        </div>

        {activeTab === 'workspace' ? (
          <div className="export-workspace-split">
            {/* LaTeX Pane */}
            <div className="export-pane">
              <div className="export-pane-header">
                <span>LaTeX Document (.tex)</span>
                <div className="export-pane-actions">
                  <button
                    className="export-pane-btn"
                    onClick={() => {
                      navigator.clipboard.writeText(latexTemplateText).then(() => {
                        setCopiedTex(true)
                        setTimeout(() => setCopiedTex(false), 2000)
                      })
                    }}
                  >
                    <Copy size={12} />
                    {copiedTex ? 'Copied!' : 'Copy'}
                  </button>
                  <button
                    className="export-pane-btn"
                    onClick={() => handleDownloadFile(latexTemplateText, 'document.tex')}
                  >
                    <Download size={12} />
                    Download
                  </button>
                </div>
              </div>
              <pre className="export-pane-pre">{latexTemplateText}</pre>
            </div>

            {/* BibTeX Pane */}
            <div className="export-pane">
              <div className="export-pane-header">
                <span>BibTeX references (.bib)</span>
                <div className="export-pane-actions">
                  <button
                    className="export-pane-btn"
                    onClick={() => {
                      navigator.clipboard.writeText(bibtexText).then(() => {
                        setCopiedBib(true)
                        setTimeout(() => setCopiedBib(false), 2000)
                      })
                    }}
                  >
                    <Copy size={12} />
                    {copiedBib ? 'Copied!' : 'Copy'}
                  </button>
                  <button
                    className="export-pane-btn"
                    onClick={() => handleDownloadFile(bibtexText, 'references.bib')}
                  >
                    <Download size={12} />
                    Download
                  </button>
                </div>
              </div>
              <pre className="export-pane-pre">{bibtexText}</pre>
            </div>
          </div>
        ) : (
          <>
            <div className="citation-format-tabs" style={{ marginBottom: '12px' }}>
              {['APA', 'MLA', 'Chicago'].map((f) => (
                <button key={f} className={f === citationFormat ? 'active' : undefined} onClick={() => setCitationFormat(f as CitationFormat)}>
                  {f}
                </button>
              ))}
            </div>

            <pre className="citation-text export-text" style={{ maxHeight: '380px', overflowY: 'auto', background: '#f1f5f9', border: '1px solid var(--border-color)', padding: '12px', borderRadius: 'var(--radius-md)', fontFamily: 'monospace', fontSize: '0.85rem', whiteSpace: 'pre-wrap' }}>
              {formatAllCitations(sources, citationFormat)}
            </pre>

            <div className="export-actions" style={{ display: 'flex', gap: '12px', marginTop: '16px', justifyContent: 'flex-end' }}>
              <button
                className="citation-copy-btn"
                onClick={() => {
                  navigator.clipboard.writeText(formatAllCitations(sources, citationFormat)).then(() => {
                    setCopied(true)
                    setTimeout(() => setCopied(false), 2000)
                  })
                }}
              >
                <Copy size={13} style={{ marginRight: '6px' }} />
                {copied ? 'Copied!' : 'Copy to Clipboard'}
              </button>
              <button
                className="citation-copy-btn"
                onClick={() => handleDownloadFile(formatAllCitations(sources, citationFormat), `citations.${citationFormat.toLowerCase()}.txt`)}
                style={{ background: 'var(--bg-local)', color: 'var(--text-local)', border: '1px solid var(--border-local)' }}
              >
                <Download size={13} style={{ marginRight: '6px' }} />
                Download File
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function RestoredSessionDisplay({ session }: { session: SavedResearchSession }) {
  const dateStr = new Date(session.createdAt).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  })
  const { answer } = session

  return (
    <div className="restored-session-container">
      <div className="restored-session-banner">
        <BookMarked size={15} />
        Restored saved session · {dateStr} · {session.sources.length} sources
      </div>

      {answer && (
        <>
          {answer.usedDeterministicFallback ? (
            <>
              <div className="answer-block">
                <h3>Direct Answer</h3>
                <p className="summary">{answer.deterministicSummary ?? answer.directAnswer}</p>
              </div>
              {(answer.deterministicKeyPoints ?? []).length > 0 && (
                <div className="answer-block">
                  <h3>Key Evidence</h3>
                  <ol>
                    {(answer.deterministicKeyPoints ?? []).map((pt, i) => (
                      <li key={i}>{pt}</li>
                    ))}
                  </ol>
                </div>
              )}
              {answer.limitations.length > 0 && (
                <div className="answer-block">
                  <h3>Limitations / Caveats</h3>
                  <ul>
                    {answer.limitations.map((l, i) => <li key={i}>{l}</li>)}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="answer-block">
                <h3>Direct Answer</h3>
                <p className="summary">{answer.directAnswer}</p>
              </div>
              {answer.detailedAnswer.length > 0 && (
                <div className="answer-block">
                  <h3>Detailed Explanation</h3>
                  {answer.detailedAnswer.map((p, i) => (
                    <p key={i} className="brief-paragraph">{p}</p>
                  ))}
                </div>
              )}
              {answer.keyEvidence.length > 0 && (
                <div className="answer-block">
                  <h3>Key Evidence</h3>
                  <ol>
                    {answer.keyEvidence.map((e, i) => <li key={i}>{e}</li>)}
                  </ol>
                </div>
              )}
              {answer.sourceComparison.length > 0 && (
                <div className="answer-block">
                  <h3>Source Comparison</h3>
                  <ul>
                    {answer.sourceComparison.map((c, i) => <li key={i}>{c}</li>)}
                  </ul>
                </div>
              )}
              {answer.limitations.length > 0 && (
                <div className="answer-block">
                  <h3>Limitations</h3>
                  <ul>
                    {answer.limitations.map((l, i) => <li key={i}>{l}</li>)}
                  </ul>
                </div>
              )}
              {answer.researchUsefulness && (
                <div className="answer-block">
                  <h3>Research Usefulness</h3>
                  <p className="brief-paragraph">{answer.researchUsefulness}</p>
                </div>
              )}
            </>
          )}
        </>
      )}

      {session.notes && (
        <div className="answer-block">
          <h3>Session Notes</h3>
          <p className="brief-paragraph" style={{ fontStyle: 'italic' }}>{session.notes}</p>
        </div>
      )}

      <div className="restored-session-notice">
        This is a saved snapshot. Run a new search above to get live results.
      </div>
    </div>
  )
}

function SessionsSidebar({
  sessions,
  onClose,
  onReopen,
  onDelete,
  onRename,
  onUpdateNotes,
  onExportMd,
}: {
  sessions: SavedResearchSession[]
  onClose: () => void
  onReopen: (session: SavedResearchSession) => void
  onDelete: (id: string) => void
  onRename: (id: string, newTitle: string) => void
  onUpdateNotes: (id: string, notes: string) => void
  onExportMd: (session: SavedResearchSession) => void
}) {
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editingNotesId, setEditingNotesId] = useState<string | null>(null)
  const [editNotes, setEditNotes] = useState('')
  const drawerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    drawerRef.current?.focus()
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const sorted = [...sessions].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )

  function commitRename(id: string) {
    if (editTitle.trim()) onRename(id, editTitle.trim())
    setEditingTitleId(null)
  }

  function commitNotes(id: string) {
    onUpdateNotes(id, editNotes)
    setEditingNotesId(null)
  }

  return (
    <div className="sessions-overlay" onClick={onClose} aria-label="Saved sessions panel">
      <div
        className="sessions-drawer"
        ref={drawerRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Saved sessions"
        onClick={e => e.stopPropagation()}
      >
        <div className="sessions-drawer-header">
          <div className="sessions-drawer-title">
            <FolderOpen size={16} />
            Saved Sessions
            {sessions.length > 0 && (
              <span className="sessions-count-pill">{sessions.length}</span>
            )}
          </div>
          <button className="cite-btn" onClick={onClose} aria-label="Close saved sessions">
            <X size={16} />
          </button>
        </div>

        <div className="sessions-storage-note">
          Sessions are stored only in this browser (localStorage). They are not synced or backed up.
        </div>

        <div className="sessions-list">
          {sorted.length === 0 ? (
            <div className="sessions-empty-state">
              <p>No saved sessions yet.</p>
              <p>After searching, click <strong>Save session</strong> in the answer panel.</p>
            </div>
          ) : (
            sorted.map(session => {
              const dateStr = new Date(session.createdAt).toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric',
              })
              const isAI = session.answer !== null && !session.answer.usedDeterministicFallback

              return (
                <article key={session.id} className="session-card">
                  <div className="session-card-top">
                    <span className="session-card-date">{dateStr}</span>
                    {isAI && <span className="badge badge-live">AI</span>}
                    <span className="session-card-sources">{session.sources.length} sources</span>
                  </div>

                  {editingTitleId === session.id ? (
                    <input
                      className="session-title-edit"
                      value={editTitle}
                      onChange={e => setEditTitle(e.target.value)}
                      onBlur={() => commitRename(session.id)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') commitRename(session.id)
                        if (e.key === 'Escape') setEditingTitleId(null)
                      }}
                      autoFocus
                      aria-label="Rename session"
                    />
                  ) : (
                    <h4 className="session-card-title">{session.title}</h4>
                  )}

                  <p className="session-card-query">
                    {session.query.length > 80 ? session.query.slice(0, 80) + '…' : session.query}
                  </p>

                  {editingNotesId === session.id ? (
                    <textarea
                      className="session-notes-edit"
                      value={editNotes}
                      onChange={e => setEditNotes(e.target.value)}
                      onBlur={() => commitNotes(session.id)}
                      rows={3}
                      autoFocus
                      aria-label="Edit session notes"
                    />
                  ) : session.notes ? (
                    <p className="session-card-notes">{session.notes}</p>
                  ) : null}

                  <div className="session-card-actions">
                    <button
                      className="session-action-btn"
                      onClick={() => onReopen(session)}
                    >Reopen</button>
                    <button
                      className="session-action-btn"
                      onClick={() => { setEditingTitleId(session.id); setEditTitle(session.title) }}
                    >Rename</button>
                    <button
                      className="session-action-btn"
                      onClick={() => { setEditingNotesId(session.id); setEditNotes(session.notes) }}
                    >Edit notes</button>
                    <button
                      className="session-action-btn"
                      onClick={() => onExportMd(session)}
                    >Export MD</button>
                    <button
                      className="session-action-btn session-action-delete"
                      onClick={() => onDelete(session.id)}
                    >Delete</button>
                  </div>
                </article>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

function toggleSourceType(filters: ResearchFilters, type: SourceType): ResearchFilters {
  const hasType = filters.sourceTypes.includes(type)
  const nextTypes = hasType ? filters.sourceTypes.filter((item) => item !== type) : [...filters.sourceTypes, type]

  return {
    ...filters,
    sourceTypes: nextTypes.length ? nextTypes : filters.sourceTypes,
  }
}

function getFirstSentences(text: string, count = 2): string {
  if (!text) return ''
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g)
  if (!sentences || sentences.length === 0) {
    return text.length > 120 ? text.slice(0, 120) + '...' : text
  }
  return sentences.slice(0, count).join('').trim()
}

function parseCitationsToReact(text: string, onCitationClick: (marker: string) => void) {
  if (!text) return null
  const regex = /\[S(\d+)\]/g
  const parts = text.split(regex)
  if (parts.length === 1) return text

  const elements: React.ReactNode[] = []
  let partIndex = 0

  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      if (parts[i]) {
        elements.push(<span key={`text-${partIndex++}`}>{parts[i]}</span>)
      }
    } else {
      const num = parts[i]
      const marker = `S${num}`
      elements.push(
        <button
          key={`cite-${partIndex++}`}
          className="citation-link"
          onClick={() => onCitationClick(marker)}
          title={`Click to scroll to Source ${marker}`}
        >
          [{marker}]
        </button>
      )
    }
  }
  return elements
}

function renderMarkdownToReact(text: string, onCitationClick: (marker: string) => void, showCursor = false) {
  if (!text) {
    return showCursor ? <span className="streaming-cursor" aria-hidden="true" /> : null;
  }

  // Split by double newline to get blocks (paragraphs, lists, headers)
  const blocks = text.split(/\n\n+/);
  const elements: React.ReactNode[] = [];

  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
    const block = blocks[blockIndex];
    const trimmedBlock = block.trim();
    if (!trimmedBlock) continue;

    const isLastBlock = blockIndex === blocks.length - 1;

    // Check if it's a header
    const headerMatch = trimmedBlock.match(/^(#{1,6})\s+(.*)$/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      const contentText = headerMatch[2];
      const Tag = `h${level}` as any;
      elements.push(
        <Tag key={`h-${blockIndex}`} style={{ margin: '12px 0 6px 0' }}>
          {parseInlineMarkdownAndCitations(contentText, onCitationClick)}
          {isLastBlock && showCursor && <span className="streaming-cursor" aria-hidden="true" />}
        </Tag>
      );
      continue;
    }

    // Check if it's a list (bullet points or numbered list)
    if (trimmedBlock.startsWith('- ') || trimmedBlock.startsWith('* ') || trimmedBlock.match(/^\d+\.\s+/)) {
      const lines = trimmedBlock.split('\n');
      const firstLineMatch = lines[0].match(/^(\d+)\.\s+/);
      const isOrdered = !!firstLineMatch;
      const ListTag = isOrdered ? 'ol' : 'ul';
      const startVal = firstLineMatch ? parseInt(firstLineMatch[1], 10) : undefined;
      elements.push(
        <ListTag key={`list-${blockIndex}`} start={startVal} style={{ paddingLeft: '20px', margin: '8px 0' }}>
          {lines.map((line, lineIndex) => {
            const cleanLine = line.replace(/^(?:-\s+|\*\s+|\d+\.\s+)/, '');
            const isLastLine = lineIndex === lines.length - 1;
            return (
              <li key={`li-${blockIndex}-${lineIndex}`} style={{ marginBottom: '4px' }}>
                {parseInlineMarkdownAndCitations(cleanLine, onCitationClick)}
                {isLastBlock && isLastLine && showCursor && <span className="streaming-cursor" aria-hidden="true" />}
              </li>
            );
          })}
        </ListTag>
      );
      continue;
    }

    // Default to paragraph
    // But support soft line breaks inside paragraph
    const lines = trimmedBlock.split('\n');
    elements.push(
      <p key={`p-${blockIndex}`} style={{ margin: '0 0 10px 0', lineHeight: '1.5' }}>
        {lines.map((line, lineIndex) => {
          const isLastLine = lineIndex === lines.length - 1;
          return (
            <Fragment key={`line-${blockIndex}-${lineIndex}`}>
              {lineIndex > 0 && <br />}
              {parseInlineMarkdownAndCitations(line, onCitationClick)}
              {isLastBlock && isLastLine && showCursor && <span className="streaming-cursor" aria-hidden="true" />}
            </Fragment>
          );
        })}
      </p>
    );
  }

  return <div className="markdown-body-content">{elements}</div>;
}

function parseInlineMarkdownAndCitations(text: string, onCitationClick: (marker: string) => void): React.ReactNode[] {
  const pattern = /(\[S\d+\]|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  const parts = text.split(pattern);
  
  return parts.map((part, index) => {
    if (!part) return null;
    
    // Check if citation
    const citeMatch = part.match(/^\[S(\d+)\]$/);
    if (citeMatch) {
      const num = citeMatch[1];
      const marker = `S${num}`;
      return (
        <button
          key={`cite-${index}`}
          className="citation-link"
          onClick={() => onCitationClick(marker)}
          title={`Click to scroll to Source ${marker}`}
        >
          [{marker}]
        </button>
      );
    }
    
    // Check if bold
    if (part.startsWith('**') && part.endsWith('**')) {
      const boldText = part.slice(2, -2);
      return <strong key={`bold-${index}`}>{boldText}</strong>;
    }
    
    // Check if italic
    if (part.startsWith('*') && part.endsWith('*')) {
      const italicText = part.slice(1, -1);
      return <em key={`italic-${index}`}>{italicText}</em>;
    }
    
    // Check if code
    if (part.startsWith('`') && part.endsWith('`')) {
      const codeText = part.slice(1, -1);
      return (
        <code key={`code-${index}`} style={{ background: 'rgba(0,0,0,0.05)', padding: '2px 4px', borderRadius: '4px', fontFamily: 'monospace' }}>
          {codeText}
        </code>
      );
    }
    
    // Normal text
    return part;
  });
}

function EvidenceHealthDashboard({ results }: { results: RankedResearchItem[] }) {
  const health = calculateEvidenceHealth(results);
  return (
    <div className="evidence-health-dashboard" aria-label="Evidence Health Scorecard">
      <div className="health-card">
        <div className="health-card-label">Peer-Review Rate</div>
        <div className="health-card-value">{health.peerReviewRate}%</div>
      </div>
      <div className="health-card">
        <div className="health-card-label">Citation Strength</div>
        <div className="health-card-value">{health.totalCitations}</div>
      </div>
      <div className="health-card">
        <div className="health-card-label">Warning Alerts</div>
        <div className={`health-card-value ${health.warningCount > 0 ? 'text-warning' : ''}`}>
          {health.warningCount}
        </div>
      </div>
      <div className="health-card">
        <div className="health-card-label">Avg Publication Year</div>
        <div className="health-card-value">{health.avgYear}</div>
      </div>
    </div>
  );
}

function MethodologyMatrix({
  results,
  globalMarkerMap,
  uploadedPDF,
  onCitationClick,
  onOpenDetail
}: {
  results: RankedResearchItem[]
  globalMarkerMap: Map<string, number>
  uploadedPDF: UploadedPDFState | null
  onCitationClick: (marker: string) => void
  onOpenDetail: (item: RankedResearchItem, marker: number) => void
}) {
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState<'year' | 'citations' | 'sampleSize' | null>(null)
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

  // Helper to extract numeric sample size for sorting
  const getNumericSampleSize = (item: RankedResearchItem): number => {
    const details = extractAcademicDetails(item, item.importedFrom === 'uploaded-pdf' ? uploadedPDF?.analysis : null)
    const sizeStr = details.sampleSize
    const num = parseInt(sizeStr.replace(/[^0-9]/g, ''), 10)
    return isNaN(num) ? 0 : num
  }

  // Handle Sort trigger
  const handleSort = (field: 'year' | 'citations' | 'sampleSize') => {
    if (sortBy === field) {
      setSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(field)
      setSortOrder('desc')
    }
  }

  // Filter & Sort results
  const filteredAndSorted = useMemo(() => {
    let list = [...results]
    
    // Filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter(item => {
        const details = extractAcademicDetails(item, item.importedFrom === 'uploaded-pdf' ? uploadedPDF?.analysis : null)
        return (
          item.title.toLowerCase().includes(q) ||
          (item.authors || []).some(a => a.toLowerCase().includes(q)) ||
          (item.sourceName || '').toLowerCase().includes(q) ||
          details.methodology.toLowerCase().includes(q) ||
          details.datasetOrSample.toLowerCase().includes(q) ||
          details.conclusion.toLowerCase().includes(q)
        )
      })
    }

    // Sort
    if (sortBy) {
      list.sort((a, b) => {
        let valA = 0
        let valB = 0
        if (sortBy === 'year') {
          valA = a.year || 0
          valB = b.year || 0
        } else if (sortBy === 'citations') {
          valA = a.citationCount || 0
          valB = b.citationCount || 0
        } else if (sortBy === 'sampleSize') {
          valA = getNumericSampleSize(a)
          valB = getNumericSampleSize(b)
        }

        if (valA < valB) return sortOrder === 'asc' ? -1 : 1
        if (valA > valB) return sortOrder === 'asc' ? 1 : -1
        return 0
      })
    }
    return list
  }, [results, searchQuery, sortBy, sortOrder, uploadedPDF])

  // Handle Download CSV
  const handleDownloadCSV = () => {
    const headers = ['Source ID', 'Title', 'Authors', 'Year', 'Citations', 'Methodology', 'Sample Size / Dataset', 'Primary Finding / Conclusion']
    const rows = filteredAndSorted.map((item, index) => {
      const marker = globalMarkerMap.get(item.id) ?? index + 1
      const details = extractAcademicDetails(item, item.importedFrom === 'uploaded-pdf' ? uploadedPDF?.analysis : null)
      return [
        `S${marker}`,
        item.title,
        item.authors.join('; '),
        item.year,
        item.citationCount || 0,
        details.methodology,
        details.datasetOrSample,
        details.conclusion
      ]
    })

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(val => `"${String(val).replace(/"/g, '""')}"`).join(','))
    ].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', 'methodology_matrix.csv')
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  if (results.length === 0) {
    return (
      <div className="matrix-empty">
        <Database size={24} />
        <p>No papers in the current evidence trail to compare.</p>
        <p>Try refining your filters or running a new search query.</p>
      </div>
    )
  }

  return (
    <div className="matrix-wrapper">
      <div className="matrix-controls">
        <div className="matrix-search-wrapper">
          <Search size={16} />
          <input
            type="text"
            className="matrix-search-input"
            placeholder="Search methodology or title..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <button className="matrix-export-btn" onClick={handleDownloadCSV}>
          <Download size={14} /> Export CSV
        </button>
      </div>

      <div className="matrix-scroll-container">
        <table className="matrix-table">
          <thead>
            <tr>
              <th>Source</th>
              <th onClick={() => handleSort('year')} style={{ cursor: 'pointer' }} className="sort-header">
                Year <span className="sort-icon">{sortBy === 'year' ? (sortOrder === 'asc' ? '▲' : '▼') : '↕'}</span>
              </th>
              <th onClick={() => handleSort('citations')} style={{ cursor: 'pointer' }} className="sort-header">
                Citations <span className="sort-icon">{sortBy === 'citations' ? (sortOrder === 'asc' ? '▲' : '▼') : '↕'}</span>
              </th>
              <th>Methodology</th>
              <th onClick={() => handleSort('sampleSize')} style={{ cursor: 'pointer' }} className="sort-header">
                Sample Size <span className="sort-icon">{sortBy === 'sampleSize' ? (sortOrder === 'asc' ? '▲' : '▼') : '↕'}</span>
              </th>
              <th>Primary Finding / Conclusion</th>
            </tr>
          </thead>
          <tbody>
            {filteredAndSorted.slice(0, 15).map((item, index) => {
              const marker = globalMarkerMap.get(item.id) ?? index + 1
              const details = extractAcademicDetails(item, item.importedFrom === 'uploaded-pdf' ? uploadedPDF?.analysis : null)
              return (
                <tr key={item.id} className="matrix-row">
                  <td className="matrix-source-cell">
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '4px' }}>
                      <button
                        className="citation-link"
                        onClick={() => onCitationClick(`S${marker}`)}
                        title="Scroll to evidence card"
                        style={{ padding: '2px 6px', fontSize: '0.78rem' }}
                      >
                        [S{marker}]
                      </button>
                    </div>
                    <div
                      className="matrix-source-details"
                      onClick={() => onOpenDetail(item, marker)}
                      style={{ cursor: 'pointer' }}
                    >
                      <span className="matrix-author-year">
                        {item.authors[0] || 'Unknown Author'} {item.authors.length > 1 ? 'et al.' : ''}
                      </span>
                      <span className="matrix-title-link" title={item.title}>
                        {item.title}
                      </span>
                    </div>
                  </td>
                  <td>{item.year}</td>
                  <td>{item.citationCount || 0}</td>
                  <td>
                    <span className="matrix-badge methodology-badge">{details.methodology}</span>
                  </td>
                  <td>
                    <span className="matrix-badge sample-badge">{details.datasetOrSample}</span>
                  </td>
                  <td className="matrix-conclusion-cell" title={details.conclusion}>
                    {details.conclusion}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function CitationTimeline({
  results,
  globalMarkerMap,
  onCitationClick,
  onOpenDetail
}: {
  results: RankedResearchItem[]
  globalMarkerMap: Map<string, number>
  onCitationClick: (marker: string) => void
  onOpenDetail: (item: RankedResearchItem, marker: number) => void
}) {
  const [hoveredNode, setHoveredNode] = useState<number | null>(null);
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);

  const timelineNodes = useMemo(() => {
    const sorted = [...results]
      .slice(0, 15)
      .map((item, index) => ({
        item,
        marker: globalMarkerMap.get(item.id) ?? index + 1
      }))
      .sort((a, b) => a.item.year - b.item.year); // Oldest first
    
    return sorted.map((node, i) => ({
      ...node,
      y: i * 140 + 50
    }));
  }, [results, globalMarkerMap]);

  const allTopics = useMemo(() => {
    const topicsSet = new Set<string>();
    results.slice(0, 15).forEach(item => {
      if (item.domainTags) {
        item.domainTags.forEach(tag => topicsSet.add(tag));
      }
    });
    return Array.from(topicsSet).sort();
  }, [results]);

  const connections = useMemo(() => {
    const list: { fromIndex: number; toIndex: number; fromY: number; toY: number; label: string; color: string }[] = [];
    const colors = [
      '#4f46e5', // Indigo
      '#10b981', // Emerald
      '#f59e0b', // Amber
      '#ef4444', // Rose
      '#06b6d4'  // Cyan
    ];

    for (let i = 0; i < timelineNodes.length; i++) {
      for (let j = i + 1; j < timelineNodes.length; j++) {
        const tagsA = timelineNodes[i].item.domainTags || [];
        const tagsB = timelineNodes[j].item.domainTags || [];
        const commonTags = tagsA.filter(t => tagsB.includes(t));
        
        if (commonTags.length > 0) {
          const color = colors[commonTags[0].length % colors.length];
          list.push({
            fromIndex: i,
            toIndex: j,
            fromY: timelineNodes[i].y,
            toY: timelineNodes[j].y,
            label: commonTags[0],
            color
          });
        }
      }
    }
    return list.slice(0, 20);
  }, [timelineNodes]);

  if (results.length === 0) {
    return (
      <div className="matrix-empty">
        <Clock size={24} />
        <p>No papers in the current evidence trail to map.</p>
        <p>Try refining your filters or running a new search query.</p>
      </div>
    )
  }

  const svgHeight = timelineNodes.length * 140 + 40;

  return (
    <div className="timeline-wrapper">
      {/* Topic Filter Pills */}
      <div className="timeline-topic-filters">
        <button
          className={`timeline-topic-pill ${selectedTopic === null ? 'active' : ''}`}
          onClick={() => setSelectedTopic(null)}
        >
          All Topics
        </button>
        {allTopics.map(topic => (
          <button
            key={topic}
            className={`timeline-topic-pill ${selectedTopic === topic ? 'active' : ''}`}
            onClick={() => setSelectedTopic(topic)}
          >
            {topic}
          </button>
        ))}
      </div>

      <div className="timeline-scroll-container">
        <div className="timeline-relative-container" style={{ height: `${svgHeight}px`, position: 'relative' }}>
          {/* SVG Background Connections */}
          <svg className="timeline-svg" style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', zIndex: 1, pointerEvents: 'none' }}>
            <line x1="50" y1="20" x2="50" y2={svgHeight - 20} stroke="var(--border-color)" strokeWidth="2" strokeDasharray="4 4" />
            
            {connections.map((conn, idx) => {
              const isHighlighted = hoveredNode === conn.fromIndex || hoveredNode === conn.toIndex;
              const hasTopic = !selectedTopic || conn.label === selectedTopic;
              const controlX = 50 - Math.min(40, (conn.toIndex - conn.fromIndex) * 12);
              const midX = (controlX + 50) / 2;
              const midY = (conn.fromY + conn.toY) / 2;
              return (
                <g key={`timeline-conn-${idx}`}>
                  <path
                    d={`M 50 ${conn.fromY} Q ${controlX} ${midY} 50 ${conn.toY}`}
                    fill="none"
                    stroke={conn.color}
                    strokeWidth={isHighlighted ? 3.5 : (selectedTopic === conn.label ? 2.5 : 1.5)}
                    strokeOpacity={isHighlighted ? 0.9 : (selectedTopic ? (conn.label === selectedTopic ? 0.8 : 0.05) : 0.25)}
                    style={{ transition: 'stroke-width 0.2s, stroke-opacity 0.2s' }}
                  />
                  {hasTopic && (isHighlighted || selectedTopic === conn.label) && (
                    <text
                      x={midX - 6}
                      y={midY + 4}
                      fill={conn.color}
                      fontSize="9"
                      fontWeight="600"
                      textAnchor="end"
                      style={{ pointerEvents: 'none' }}
                    >
                      {conn.label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

          {/* HTML Nodes */}
          {timelineNodes.map((node, index) => {
            const { item, marker, y } = node;
            const isHovered = hoveredNode === index;
            const hasTopic = !selectedTopic || item.domainTags?.includes(selectedTopic);
            
            return (
              <div
                key={item.id}
                className={`timeline-node-row ${isHovered ? 'hovered' : ''}`}
                style={{
                  position: 'absolute',
                  left: 0,
                  top: `${y - 50}px`,
                  width: '100%',
                  height: '120px',
                  display: 'flex',
                  alignItems: 'center',
                  zIndex: 2,
                  opacity: hasTopic ? 1 : 0.25,
                  transition: 'opacity 0.3s'
                }}
                onMouseEnter={() => setHoveredNode(index)}
                onMouseLeave={() => setHoveredNode(null)}
              >
                <div
                  className={`timeline-dot ${isHovered ? 'hovered' : ''}`}
                  style={{
                    position: 'absolute',
                    left: '50px',
                    transform: 'translateX(-50%)',
                    width: isHovered ? '16px' : '12px',
                    height: isHovered ? '16px' : '12px',
                    borderRadius: '50%',
                    background: isHovered ? 'var(--primary)' : 'var(--border-hover)',
                    border: '3px solid var(--bg-card)',
                    boxShadow: isHovered ? '0 0 0 4px var(--primary-light)' : 'none',
                    transition: 'all 0.2s',
                    cursor: 'pointer'
                  }}
                  onClick={() => onCitationClick(`S${marker}`)}
                  title="Scroll to evidence card"
                />

                <div
                  className="timeline-card"
                  style={{
                    marginLeft: '75px',
                    flex: 1,
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-md)',
                    padding: '12px 16px',
                    boxShadow: isHovered ? 'var(--shadow-md)' : 'var(--shadow-sm)',
                    transform: isHovered ? 'translateX(2px)' : 'none',
                    transition: 'all 0.2s',
                    cursor: 'pointer'
                  }}
                  onClick={() => onOpenDetail(item, marker)}
                >
                  <div className="timeline-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <span className="timeline-card-year" style={{ fontWeight: 'bold', color: 'var(--primary)', fontSize: '0.95rem' }}>
                      {item.year}
                    </span>
                    <button
                      className="citation-link"
                      onClick={(e) => { e.stopPropagation(); onCitationClick(`S${marker}`) }}
                      style={{ fontSize: '0.78rem', padding: '2px 6px' }}
                    >
                      [S{marker}]
                    </button>
                  </div>
                  <h4 className="timeline-card-title" style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', margin: 0 }}>
                    {item.title}
                  </h4>
                  <div className="timeline-card-meta" style={{ display: 'flex', gap: '8px', marginTop: '6px', fontSize: '0.75rem', color: 'var(--text-secondary)', alignItems: 'center' }}>
                    <span className="timeline-card-author" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '140px' }}>
                      {item.authors[0] || 'Unknown Author'} {item.authors.length > 1 ? 'et al.' : ''}
                    </span>
                    <span style={{ color: 'var(--border-hover)' }}>|</span>
                    <span className="timeline-card-venue" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '140px' }}>
                      {item.sourceName}
                    </span>
                  </div>
                  {item.domainTags.length > 0 && (
                    <div className="timeline-card-tags" style={{ display: 'flex', gap: '4px', marginTop: '6px', flexWrap: 'wrap' }}>
                      {item.domainTags.slice(0, 2).map(t => (
                        <span key={t} style={{ fontSize: '0.68rem', padding: '1px 6px', borderRadius: '4px', background: 'var(--bg-local)', color: 'var(--text-local)' }}>
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default App;
