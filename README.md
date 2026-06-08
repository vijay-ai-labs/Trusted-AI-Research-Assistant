# Trusted Research Assistant

An AI-powered academic research platform that searches live academic databases, synthesizes source-grounded answers, and eliminates hallucinations by grounding every claim in cited evidence.

## Overview

Traditional AI assistants generate answers from training data with no citations and no way to verify claims. This tool inverts that: it retrieves real academic sources first, then synthesizes answers that are anchored exclusively to those sources. Every statement is linked to a numbered citation you can inspect.

## Features

### Five Agent Modes
| Mode | Description |
|------|-------------|
| **Research Agent** | Structured research dossier with detailed explanation, summary, and cited sources |
| **AI Search** | Fast concise answers from live academic literature |
| **Literature Review** | Thematic analysis, methodology comparison table, and research gap identification |
| **Deep Research Report** | Multi-section comprehensive academic report with executive summary and full citation list |
| **Chat with PDF** | Upload any academic PDF and ask questions grounded in that document |

### Source Intelligence
- **Live OpenAlex integration** — queries 250M+ academic works in real time via [OpenAlex API](https://openalex.org)
- **Local seed evidence base** — curated research items with provenance tracking
- **Trust scoring engine** — ranks sources by relevance, peer review status, citation count, retraction status, and data completeness
- **Evidence health dashboard** — shows peer-review rate, average publication year, and warning counts for any result set

### Research Workflow Tools
- **Methodology Matrix** — side-by-side comparison of study designs, sample sizes, and conclusions across all retrieved sources
- **Citation Timeline** — chronological view of how the literature on a topic evolved
- **Multi-format citation export** — APA, MLA, Chicago, BibTeX, and LaTeX-ready reference lists
- **Researcher Notebook** — persistent markdown notepad with edit/preview modes, word count, and one-click export to `.md`
- **Session management** — save, restore, rename, and export research sessions locally
- **Follow-up chat** — ask follow-up questions grounded in the same source set after initial synthesis

### PDF Analysis Pipeline
- Extracts and analyzes uploaded PDFs (pdfjs-dist, lazy-loaded)
- Extracts title, authors, year, DOI, methodology, sample size, key findings, and related keywords
- Cross-references extracted metadata against OpenAlex for enrichment
- Adds analyzed PDFs to the active evidence pool for synthesis

### Reliability Design
- Streaming synthesis with real-time source card reveal as citations appear
- Graceful fallback to deterministic source summary when AI synthesis fails
- Confidence labeling (`high` / `medium` / `low` / `insufficient`) on all synthesized outputs
- Retraction detection and small-sample-size warnings on source cards
- No hallucination by construction: model is prohibited from citing sources outside the retrieved set

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript (strict), Vite |
| Styling | CSS custom properties (no UI framework) |
| Academic Data | OpenAlex REST API |
| AI Synthesis | OpenAI API (streaming via `/api` proxy) |
| PDF Processing | pdfjs-dist (dynamic import, ~3 MB, loaded on demand) |
| Icons | Lucide React |
| Testing | Vitest |
| Build | Vite + Rolldown, ES2022 target |

## Architecture

```
src/
├── App.tsx                        # Main shell, all agent mode routing
├── components/
│   ├── AgentModeSelector.tsx      # Mode switcher UI
│   ├── ChatWithPDFView.tsx        # PDF chat interface
│   ├── LiteratureReviewView.tsx   # Structured lit review renderer
│   └── DeepResearchReportView.tsx # Multi-section report renderer
└── lib/
    ├── agentModes.ts              # Mode configs, lit review & deep report parsers
    ├── researchEngine.ts          # Ranking, filtering, trust scoring, evidence composition
    ├── openalexService.ts         # OpenAlex API client with proxy fallback
    ├── openaiSynthesisService.ts  # Streaming synthesis, source selection
    ├── pdfService.ts              # PDF text extraction (lazy-loaded)
    ├── pdfAnalysisService.ts      # PDF metadata analysis + OpenAlex enrichment
    ├── citationService.ts         # APA/MLA/Chicago/BibTeX formatters
    └── sessionService.ts          # LocalStorage session persistence
```

## Getting Started

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run tests
npm test

# Build for production
npm run build
```

Set your API keys server-side (the client calls `/api/*` proxy endpoints — no keys are exposed in the browser).

## Key Design Decisions

**Hallucination elimination**: the synthesis prompt is constructed with the retrieved source list embedded. The model can only cite `[S1]`–`[Sn]` markers that map to real retrieved papers. Uncited claims are structurally impossible.

**Streaming source reveal**: source cards appear in the sidebar as each `[Sn]` citation marker is streamed in, giving users real-time feedback on which papers are being cited before the full answer completes.

**Lazy PDF loading**: pdfjs-dist (~3 MB) is dynamically imported only when a user uploads a file, keeping initial bundle size minimal.

**Evidence provenance tracking**: every item carries a provenance label (`local-seed` or `openalex`) and an audit record with completeness score and validation issues, surfaced in the source detail modal.

## Screenshots

> Add screenshots of the Research Agent, Literature Review, and Chat with PDF modes here.

## License

MIT
