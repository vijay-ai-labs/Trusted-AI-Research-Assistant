import React, { useMemo, useState } from 'react';
import { BookOpen, FileDown, Plus, AlertTriangle, Check, Loader2, BookMarked, Compass, Activity, MessageSquare, Clipboard } from 'lucide-react';
import { parseLiteratureReviewText } from '../lib/agentModes';

interface LiteratureReviewViewProps {
  text: string;
  isLoading: boolean;
  onAddToNotebook: (content: string) => void;
  query: string;
  onCitationClick?: (marker: string) => void;
}

function parseCitationsToReact(text: string, onCitationClick?: (marker: string) => void) {
  if (!text) return null;
  const regex = /\[S(\d+)\]/g;
  const parts = text.split(regex);
  if (parts.length === 1) return text;

  const elements: React.ReactNode[] = [];
  let partIndex = 0;

  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      if (parts[i]) {
        elements.push(<span key={`text-${partIndex++}`}>{parts[i]}</span>);
      }
    } else {
      const num = parts[i];
      const marker = `S${num}`;
      if (onCitationClick) {
        elements.push(
          <button
            key={`cite-${partIndex++}`}
            className="citation-link"
            onClick={() => onCitationClick(marker)}
            title={`Click to scroll to Source ${marker}`}
            style={{
              display: 'inline-block',
              padding: '0 4px',
              margin: '0 2px',
              background: 'var(--primary-subtle)',
              border: '1px solid var(--primary-light)',
              borderRadius: '4px',
              fontSize: '0.72rem',
              fontWeight: 700,
              color: 'var(--primary)',
              cursor: 'pointer',
              verticalAlign: 'super',
            }}
          >
            [{marker}]
          </button>
        );
      } else {
        elements.push(<span key={`cite-${partIndex++}`} className="citation-tag" style={{ verticalAlign: 'super', fontSize: '0.72rem', fontWeight: 700 }}>[{marker}]</span>);
      }
    }
  }
  return elements;
}

export const LiteratureReviewView: React.FC<LiteratureReviewViewProps> = ({
  text,
  isLoading,
  onAddToNotebook,
  query,
  onCitationClick,
}) => {
  const [copied, setCopied] = useState(false);
  const [expandedTheme, setExpandedTheme] = useState<number | null>(0);

  const data = useMemo(() => parseLiteratureReviewText(text), [text]);

  const handleExportMarkdown = () => {
    let markdown = `# Literature Review: ${query}\n\n`;
    
    // 1. Introduction
    markdown += `## 1. Introduction\n`;
    if (data.introductionBackground) markdown += `### Background\n${data.introductionBackground}\n\n`;
    if (data.introductionObjectives) markdown += `### Objectives\n${data.introductionObjectives}\n\n`;
    if (data.introductionScope) markdown += `### Scope\n${data.introductionScope}\n\n`;

    // 2. Thematic Organization
    if (data.themes.length > 0) {
      markdown += `## 2. Thematic Organization\n\n`;
      data.themes.forEach((t, idx) => {
        markdown += `### Theme ${idx + 1}: ${t.title}\n`;
        if (t.summaryOfStudies) markdown += `#### Summary of Key Studies\n${t.summaryOfStudies}\n\n`;
        if (t.criticalAnalysis) markdown += `#### Critical Analysis\n${t.criticalAnalysis}\n\n`;
        if (t.gapsAndLimitations) markdown += `#### Gaps and Limitations\n${t.gapsAndLimitations}\n\n`;
      });
    }

    // 3. Methodological Approaches
    if (data.methodologyComparison || data.methodologyEvaluation) {
      markdown += `## 3. Methodological Approaches\n`;
      if (data.methodologyComparison) markdown += `### Comparison of Methods\n${data.methodologyComparison}\n\n`;
      if (data.methodologyEvaluation) markdown += `### Evaluation of Approaches\n${data.methodologyEvaluation}\n\n`;
    }

    // 4. Discussion
    if (data.discussionSynthesis || data.discussionGaps || data.discussionImplications) {
      markdown += `## 4. Discussion\n`;
      if (data.discussionSynthesis) markdown += `### Synthesis of Findings\n${data.discussionSynthesis}\n\n`;
      if (data.discussionGaps) markdown += `### Research Gaps\n${data.discussionGaps}\n\n`;
      if (data.discussionImplications) markdown += `### Implications\n${data.discussionImplications}\n\n`;
    }

    // 5. Conclusion
    if (data.conclusionSummary || data.conclusionRelevance || data.conclusionFutureDirections) {
      markdown += `## 5. Conclusion\n`;
      if (data.conclusionSummary) markdown += `### Summary of Key Points\n${data.conclusionSummary}\n\n`;
      if (data.conclusionRelevance) markdown += `### Relevance to Current Study\n${data.conclusionRelevance}\n\n`;
      if (data.conclusionFutureDirections) markdown += `### Future Directions\n${data.conclusionFutureDirections}\n\n`;
    }

    // 6. References
    if (data.references.length > 0) {
      markdown += `## 6. References\n\n`;
      data.references.forEach(r => {
        markdown += `${r}\n`;
      });
      markdown += `\n`;
    }

    markdown += `*Confidence Level: ${data.confidence.toUpperCase()}*\n`;

    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Literature_Review_${query.replace(/[^a-z0-9]/gi, '_')}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleNotebookAdd = () => {
    let markdown = `### Literature Review: ${query}\n\n`;
    
    // 1. Introduction
    markdown += `**1. Introduction**\n`;
    if (data.introductionBackground) markdown += `- *Background*: ${data.introductionBackground}\n`;
    if (data.introductionObjectives) markdown += `- *Objectives*: ${data.introductionObjectives}\n`;
    if (data.introductionScope) markdown += `- *Scope*: ${data.introductionScope}\n`;
    markdown += `\n`;

    // 2. Themes
    if (data.themes.length > 0) {
      markdown += `**2. Thematic Organization**\n`;
      data.themes.forEach((t, idx) => {
        markdown += `* **Theme ${idx + 1}: ${t.title}**\n`;
        if (t.summaryOfStudies) markdown += `  - *Summary*: ${t.summaryOfStudies}\n`;
        if (t.criticalAnalysis) markdown += `  - *Critical Analysis*: ${t.criticalAnalysis}\n`;
        if (t.gapsAndLimitations) markdown += `  - *Gaps & Limitations*: ${t.gapsAndLimitations}\n`;
      });
      markdown += `\n`;
    }

    // 3. Methods
    if (data.methodologyComparison || data.methodologyEvaluation) {
      markdown += `**3. Methodological Approaches**\n`;
      if (data.methodologyComparison) markdown += `- *Comparison*: ${data.methodologyComparison}\n`;
      if (data.methodologyEvaluation) markdown += `- *Evaluation*: ${data.methodologyEvaluation}\n`;
      markdown += `\n`;
    }

    // 4. Discussion
    if (data.discussionSynthesis || data.discussionGaps || data.discussionImplications) {
      markdown += `**4. Discussion**\n`;
      if (data.discussionSynthesis) markdown += `- *Synthesis*: ${data.discussionSynthesis}\n`;
      if (data.discussionGaps) markdown += `- *Gaps*: ${data.discussionGaps}\n`;
      if (data.discussionImplications) markdown += `- *Implications*: ${data.discussionImplications}\n`;
      markdown += `\n`;
    }

    // 5. Conclusion
    if (data.conclusionSummary || data.conclusionRelevance || data.conclusionFutureDirections) {
      markdown += `**5. Conclusion**\n`;
      if (data.conclusionSummary) markdown += `- *Summary*: ${data.conclusionSummary}\n`;
      if (data.conclusionRelevance) markdown += `- *Relevance*: ${data.conclusionRelevance}\n`;
      if (data.conclusionFutureDirections) markdown += `- *Future Directions*: ${data.conclusionFutureDirections}\n`;
      markdown += `\n`;
    }

    // 6. References
    if (data.references.length > 0) {
      markdown += `**6. References**\n`;
      data.references.forEach(r => {
        markdown += `- ${r}\n`;
      });
      markdown += `\n`;
    }

    onAddToNotebook(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const hasContent = text.trim().length > 0;

  return (
    <div className="lit-review-container">
      <div className="lit-review-header-band">
        <div className="lit-review-title-section">
          <BookOpen className="lit-review-icon" size={24} />
          <div>
            <h2>Literature Review</h2>
            <p className="query-subtext">Synthesized review for: "{query}"</p>
          </div>
        </div>

        {hasContent && (
          <div className="lit-review-actions">
            <button
              onClick={handleNotebookAdd}
              className={`action-btn-secondary ${copied ? 'success' : ''}`}
              title="Add to Notebook"
            >
              {copied ? <Check size={14} /> : <Plus size={14} />}
              {copied ? 'Added' : 'Add to Notebook'}
            </button>
            <button
              onClick={handleExportMarkdown}
              className="action-btn-secondary"
              title="Export as Markdown"
            >
              <FileDown size={14} />
              Export MD
            </button>
          </div>
        )}
      </div>

      {!hasContent && isLoading && (
        <div className="loading-state-box">
          <Loader2 className="animate-spin text-accent" size={32} />
          <p>Analyzing papers & compiling literature review...</p>
        </div>
      )}

      {hasContent && (
        <div className="lit-review-content-flow">
          {/* 1. Introduction Section */}
          {(data.introductionBackground || data.introductionObjectives || data.introductionScope) && (
            <section className="lit-review-section overview-card" aria-label="Introduction">
              <h3>1. Introduction</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {data.introductionBackground && (
                  <div>
                    <strong style={{ fontSize: '0.85rem', color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Background</strong>
                    <p className="section-narrative" style={{ marginTop: '4px' }}>{parseCitationsToReact(data.introductionBackground, onCitationClick)}</p>
                  </div>
                )}
                {data.introductionObjectives && (
                  <div>
                    <strong style={{ fontSize: '0.85rem', color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Objectives</strong>
                    <p className="section-narrative" style={{ marginTop: '4px' }}>{parseCitationsToReact(data.introductionObjectives, onCitationClick)}</p>
                  </div>
                )}
                {data.introductionScope && (
                  <div>
                    <strong style={{ fontSize: '0.85rem', color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Scope</strong>
                    <p className="section-narrative" style={{ marginTop: '4px' }}>{parseCitationsToReact(data.introductionScope, onCitationClick)}</p>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* 2. Thematic Organization Section */}
          {data.themes.length > 0 && (
            <section className="lit-review-section" aria-label="Thematic Organization">
              <h3>2. Thematic Organization</h3>
              <div className="theme-accordions">
                {data.themes.map((theme, idx) => {
                  const isExpanded = expandedTheme === idx;
                  return (
                    <div 
                      key={idx} 
                      className={`theme-card ${isExpanded ? 'expanded' : ''}`}
                    >
                      <button
                        className="theme-card-trigger"
                        onClick={() => setExpandedTheme(isExpanded ? null : idx)}
                      >
                        <span className="theme-number">Theme 0{idx + 1}</span>
                        <span className="theme-title">{theme.title}</span>
                      </button>
                      {isExpanded && (
                        <div className="theme-card-body" style={{ paddingLeft: '24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                          {theme.summaryOfStudies && (
                            <div>
                              <strong style={{ fontSize: '0.78rem', color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.02em', display: 'block', marginBottom: '4px' }}>Summary of Key Studies</strong>
                              <p>{parseCitationsToReact(theme.summaryOfStudies, onCitationClick)}</p>
                            </div>
                          )}
                          {theme.criticalAnalysis && (
                            <div>
                              <strong style={{ fontSize: '0.78rem', color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.02em', display: 'block', marginBottom: '4px' }}>Critical Analysis</strong>
                              <p>{parseCitationsToReact(theme.criticalAnalysis, onCitationClick)}</p>
                            </div>
                          )}
                          {theme.gapsAndLimitations && (
                            <div style={{ background: 'rgba(245, 158, 11, 0.02)', padding: '10px 14px', borderRadius: '6px', borderLeft: '3px solid rgba(245, 158, 11, 0.4)' }}>
                              <strong style={{ fontSize: '0.78rem', color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.02em', display: 'block', marginBottom: '4px' }}>Gaps and Limitations</strong>
                              <p style={{ color: '#78350f', margin: 0 }}>{parseCitationsToReact(theme.gapsAndLimitations, onCitationClick)}</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* 3. Methodological Approaches Section */}
          {(data.methodologyComparison || data.methodologyEvaluation) && (
            <section className="lit-review-section" aria-label="Methodological Approaches">
              <div className="section-title-with-icon">
                <Activity size={18} className="text-accent" />
                <h3>3. Methodological Approaches</h3>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {data.methodologyComparison && (
                  <div>
                    <strong style={{ fontSize: '0.85rem', color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Comparison of Methods</strong>
                    <p className="section-narrative" style={{ marginTop: '4px' }}>{parseCitationsToReact(data.methodologyComparison, onCitationClick)}</p>
                  </div>
                )}
                {data.methodologyEvaluation && (
                  <div style={{ background: 'var(--bg-app)', padding: '14px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                    <strong style={{ fontSize: '0.85rem', color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Evaluation of Approaches</strong>
                    <p className="section-narrative" style={{ marginTop: '4px', margin: 0 }}>{parseCitationsToReact(data.methodologyEvaluation, onCitationClick)}</p>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* 4. Discussion Section */}
          {(data.discussionSynthesis || data.discussionGaps || data.discussionImplications) && (
            <section className="lit-review-section" aria-label="Discussion">
              <div className="section-title-with-icon">
                <MessageSquare size={18} className="text-accent" />
                <h3>4. Discussion</h3>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {data.discussionSynthesis && (
                  <div>
                    <strong style={{ fontSize: '0.85rem', color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Synthesis of Findings</strong>
                    <p className="section-narrative" style={{ marginTop: '4px' }}>{parseCitationsToReact(data.discussionSynthesis, onCitationClick)}</p>
                  </div>
                )}
                {data.discussionGaps && (
                  <div style={{ background: 'rgba(245, 158, 11, 0.02)', padding: '14px', borderRadius: '8px', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                      <AlertTriangle size={15} className="text-warning-amber" />
                      <strong style={{ fontSize: '0.85rem', color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Research Gaps</strong>
                    </div>
                    <p className="section-narrative" style={{ margin: 0, color: '#78350f' }}>{parseCitationsToReact(data.discussionGaps, onCitationClick)}</p>
                  </div>
                )}
                {data.discussionImplications && (
                  <div>
                    <strong style={{ fontSize: '0.85rem', color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Implications for Future Research</strong>
                    <p className="section-narrative" style={{ marginTop: '4px' }}>{parseCitationsToReact(data.discussionImplications, onCitationClick)}</p>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* 5. Conclusion Section */}
          {(data.conclusionSummary || data.conclusionRelevance || data.conclusionFutureDirections) && (
            <section className="lit-review-section conclusion-card" aria-label="Conclusion">
              <h3>5. Conclusion</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {data.conclusionSummary && (
                  <div>
                    <strong style={{ fontSize: '0.85rem', color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Summary of Key Points</strong>
                    <p className="section-narrative" style={{ marginTop: '4px' }}>{parseCitationsToReact(data.conclusionSummary, onCitationClick)}</p>
                  </div>
                )}
                {data.conclusionRelevance && (
                  <div>
                    <strong style={{ fontSize: '0.85rem', color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Relevance to Current Study</strong>
                    <p className="section-narrative" style={{ marginTop: '4px' }}>{parseCitationsToReact(data.conclusionRelevance, onCitationClick)}</p>
                  </div>
                )}
                {data.conclusionFutureDirections && (
                  <div style={{ background: 'var(--bg-card)', padding: '14px', borderRadius: '8px', borderLeft: '4px solid var(--primary)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                      <Compass size={16} className="text-accent" />
                      <strong style={{ fontSize: '0.85rem', color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Future Directions</strong>
                    </div>
                    <p className="section-narrative" style={{ margin: 0 }}>{parseCitationsToReact(data.conclusionFutureDirections, onCitationClick)}</p>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* 6. References Section */}
          {data.references.length > 0 && (
            <section className="lit-review-section references-section" aria-label="References">
              <div className="section-title-with-icon">
                <BookMarked size={18} className="text-accent" />
                <h3>6. References</h3>
              </div>
              <ul className="references-list" style={{ listStyleType: 'none', paddingLeft: 0 }}>
                {data.references.map((ref, idx) => (
                  <li 
                    key={idx} 
                    className="reference-item"
                    style={{ 
                      fontSize: '0.88rem', 
                      lineHeight: '1.6', 
                      color: 'var(--text-secondary)',
                      marginBottom: '10px',
                      paddingLeft: '24px',
                      textIndent: '-24px' 
                    }}
                  >
                    {parseCitationsToReact(ref, onCitationClick)}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Metadata Footer */}
          <div className="lit-review-footer">
            <span className={`confidence-badge ${data.confidence}`}>
              Confidence: {data.confidence.toUpperCase()}
            </span>
            {isLoading && (
              <span className="streaming-badge">
                <Loader2 className="animate-spin" size={12} />
                Streaming synthesis...
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
