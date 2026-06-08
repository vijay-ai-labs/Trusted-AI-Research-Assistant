export type AgentMode = 'research-agent' | 'ai-search' | 'literature-review' | 'chat-with-pdf' | 'deep-research-report';

export interface AgentModeConfig {
  id: AgentMode;
  label: string;
  description: string;
  icon: string; // Lucide icon name or key
  placeholder: string;
  requiresPDF: boolean;
  disableOpenAlex: boolean;
  streamingFormat: 'structured' | 'markdown' | 'lit-review' | 'deep-report';
  maxTokens: number;
}

export const AGENT_MODES: AgentModeConfig[] = [
  {
    id: 'research-agent',
    label: 'Research Agent',
    description: 'Comprehensive research dossier with structured analysis',
    icon: 'SearchCode',
    placeholder: 'Enter a research question or topic...',
    requiresPDF: false,
    disableOpenAlex: false,
    streamingFormat: 'structured',
    maxTokens: 2500,
  },
  {
    id: 'ai-search',
    label: 'AI Search',
    description: 'Fast, concise answers directly from academic web findings',
    icon: 'Globe',
    placeholder: 'Ask anything to search the literature...',
    requiresPDF: false,
    disableOpenAlex: false,
    streamingFormat: 'markdown',
    maxTokens: 1200,
  },
  {
    id: 'deep-research-report',
    label: 'Deep Research Report',
    description: 'Multi-section comprehensive academic report with citation list',
    icon: 'FileSpreadsheet',
    placeholder: 'Specify a detailed report topic...',
    requiresPDF: false,
    disableOpenAlex: false,
    streamingFormat: 'deep-report',
    maxTokens: 6000,
  },
  {
    id: 'literature-review',
    label: 'Literature Review',
    description: 'Theme analysis, comparison table, and research gaps',
    icon: 'BookOpen',
    placeholder: 'Enter research area or papers to review...',
    requiresPDF: false,
    disableOpenAlex: false,
    streamingFormat: 'lit-review',
    maxTokens: 4000,
  },
  {
    id: 'chat-with-pdf',
    label: 'Chat with PDF',
    description: 'Ground queries exclusively in uploaded PDF documents',
    icon: 'FileText',
    placeholder: 'Ask questions about the uploaded PDF...',
    requiresPDF: true,
    disableOpenAlex: true,
    streamingFormat: 'markdown',
    maxTokens: 2000,
  },
];

// Literature Review Interfaces & Parser
export interface LitReviewTheme {
  title: string;
  summaryOfStudies: string;
  criticalAnalysis: string;
  gapsAndLimitations: string;
}

export interface LitReviewData {
  // 1. Introduction
  introductionBackground: string;
  introductionObjectives: string;
  introductionScope: string;

  // 2. Thematic Organization
  themes: LitReviewTheme[];

  // 3. Methodological Approaches
  methodologyComparison: string;
  methodologyEvaluation: string;

  // 4. Discussion
  discussionSynthesis: string;
  discussionGaps: string;
  discussionImplications: string;

  // 5. Conclusion
  conclusionSummary: string;
  conclusionRelevance: string;
  conclusionFutureDirections: string;

  // 6. References & Confidence
  references: string[];
  confidence: 'high' | 'medium' | 'low' | 'insufficient';

  // Backwards compatibility fallbacks
  overview?: string;
  introduction?: string;
  gaps: any[];
  comparison: any[];
  conclusion?: string;
  futureDirections?: string;
}

export function parseLiteratureReviewText(text: string): LitReviewData {
  const data: LitReviewData = {
    introductionBackground: '',
    introductionObjectives: '',
    introductionScope: '',
    themes: [],
    methodologyComparison: '',
    methodologyEvaluation: '',
    discussionSynthesis: '',
    discussionGaps: '',
    discussionImplications: '',
    conclusionSummary: '',
    conclusionRelevance: '',
    conclusionFutureDirections: '',
    references: [],
    confidence: 'medium',
    
    // Backwards compatibility defaults
    overview: '',
    introduction: '',
    gaps: [],
    comparison: [],
    conclusion: '',
    futureDirections: '',
  };

  const lines = text.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('INTRODUCTION_BACKGROUND:')) {
      data.introductionBackground = line.slice('INTRODUCTION_BACKGROUND:'.length).trim();
    } else if (line.startsWith('INTRODUCTION_OBJECTIVES:')) {
      data.introductionObjectives = line.slice('INTRODUCTION_OBJECTIVES:'.length).trim();
    } else if (line.startsWith('INTRODUCTION_SCOPE:')) {
      data.introductionScope = line.slice('INTRODUCTION_SCOPE:'.length).trim();
    } else if (line.startsWith('THEME:')) {
      const parts = line.slice('THEME:'.length).split('|');
      const title = parts[0]?.trim() ?? 'Theme';
      const summaryOfStudies = parts[1]?.trim() ?? '';
      const criticalAnalysis = parts[2]?.trim() ?? '';
      const gapsAndLimitations = parts[3]?.trim() ?? '';
      data.themes.push({ title, summaryOfStudies, criticalAnalysis, gapsAndLimitations });
    } else if (line.startsWith('METHODOLOGY_COMPARISON:')) {
      data.methodologyComparison = line.slice('METHODOLOGY_COMPARISON:'.length).trim();
    } else if (line.startsWith('METHODOLOGY_EVALUATION:')) {
      data.methodologyEvaluation = line.slice('METHODOLOGY_EVALUATION:'.length).trim();
    } else if (line.startsWith('DISCUSSION_SYNTHESIS:')) {
      data.discussionSynthesis = line.slice('DISCUSSION_SYNTHESIS:'.length).trim();
    } else if (line.startsWith('DISCUSSION_GAPS:')) {
      data.discussionGaps = line.slice('DISCUSSION_GAPS:'.length).trim();
    } else if (line.startsWith('DISCUSSION_IMPLICATIONS:')) {
      data.discussionImplications = line.slice('DISCUSSION_IMPLICATIONS:'.length).trim();
    } else if (line.startsWith('CONCLUSION_SUMMARY:')) {
      data.conclusionSummary = line.slice('CONCLUSION_SUMMARY:'.length).trim();
    } else if (line.startsWith('CONCLUSION_RELEVANCE:')) {
      data.conclusionRelevance = line.slice('CONCLUSION_RELEVANCE:'.length).trim();
    } else if (line.startsWith('CONCLUSION_FUTURE_DIRECTIONS:')) {
      data.conclusionFutureDirections = line.slice('CONCLUSION_FUTURE_DIRECTIONS:'.length).trim();
    } else if (line.startsWith('REFERENCES:')) {
      const val = line.slice('REFERENCES:'.length).trim();
      if (val) data.references.push(val);
    } else if (line.startsWith('CONFIDENCE:')) {
      const val = line.slice('CONFIDENCE:'.length).trim().toLowerCase();
      if (['high', 'medium', 'low', 'insufficient'].includes(val)) {
        data.confidence = val as LitReviewData['confidence'];
      }
    }
    // Fallback parsing for legacy session format support:
    else if (line.startsWith('INTRODUCTION:')) {
      const val = line.slice('INTRODUCTION:'.length).trim();
      data.introductionBackground = val;
    } else if (line.startsWith('OVERVIEW:')) {
      const val = line.slice('OVERVIEW:'.length).trim();
      data.introductionBackground = val;
    } else if (line.startsWith('GAP:')) {
      const parts = line.slice('GAP:'.length).split('|');
      const title = parts[0]?.trim() ?? 'Gap';
      const content = parts.slice(1).join('|').trim();
      if (content) data.gaps.push({ title, content });
    } else if (line.startsWith('COMPARISON:')) {
      const parts = line.slice('COMPARISON:'.length).split('|');
      const aspect = parts[0]?.trim() ?? '';
      const sources = parts[1]?.trim() ?? '';
      const details = parts.slice(2).join('|').trim() ?? '';
      if (aspect) data.comparison.push({ aspect, sources, details });
    } else if (line.startsWith('FUTURE_DIRECTIONS:')) {
      data.conclusionFutureDirections = line.slice('FUTURE_DIRECTIONS:'.length).trim();
    } else if (line.startsWith('CONCLUSION:')) {
      data.conclusionSummary = line.slice('CONCLUSION:'.length).trim();
    }
  }

  // Backwards compatibility mappings
  data.introduction = `${data.introductionBackground}\n\n${data.introductionObjectives}\n\n${data.introductionScope}`.trim();
  data.overview = data.introduction;
  data.conclusion = `${data.conclusionSummary}\n\n${data.conclusionRelevance}\n\n${data.conclusionFutureDirections}`.trim();
  data.futureDirections = data.conclusionFutureDirections;

  return data;
}

// Deep Research Report Interfaces & Parser
export interface DeepReportSection {
  title: string;
  content: string;
}

export interface DeepReportData {
  executiveSummary: string;
  sections: DeepReportSection[];
  keyFindings: string[];
  methodologyNotes: string;
  futureDirections: string;
  references: string[];
  confidence: 'high' | 'medium' | 'low' | 'insufficient';
}

export function parseDeepResearchText(text: string): DeepReportData {
  const data: DeepReportData = {
    executiveSummary: '',
    sections: [],
    keyFindings: [],
    methodologyNotes: '',
    futureDirections: '',
    references: [],
    confidence: 'medium',
  };

  const lines = text.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('EXECUTIVE_SUMMARY:')) {
      data.executiveSummary = line.slice('EXECUTIVE_SUMMARY:'.length).trim();
    } else if (line.startsWith('SECTION:')) {
      const parts = line.slice('SECTION:'.length).split('|');
      const title = parts[0]?.trim() ?? 'Section';
      const content = parts.slice(1).join('|').trim();
      if (content) data.sections.push({ title, content });
    } else if (line.startsWith('KEY_FINDINGS:')) {
      const val = line.slice('KEY_FINDINGS:'.length).trim();
      if (val) data.keyFindings.push(val);
    } else if (line.startsWith('METHODOLOGY_NOTES:')) {
      data.methodologyNotes = line.slice('METHODOLOGY_NOTES:'.length).trim();
    } else if (line.startsWith('FUTURE_DIRECTIONS:')) {
      data.futureDirections = line.slice('FUTURE_DIRECTIONS:'.length).trim();
    } else if (line.startsWith('REFERENCES:')) {
      const val = line.slice('REFERENCES:'.length).trim();
      if (val) data.references.push(val);
    } else if (line.startsWith('CONFIDENCE:')) {
      const val = line.slice('CONFIDENCE:'.length).trim().toLowerCase();
      if (['high', 'medium', 'low', 'insufficient'].includes(val)) {
        data.confidence = val as DeepReportData['confidence'];
      }
    }
  }

  return data;
}
