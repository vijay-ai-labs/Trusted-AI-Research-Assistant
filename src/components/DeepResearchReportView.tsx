import React, { useMemo, useState, useEffect } from 'react';
import { FileText, FileDown, Plus, Check, Loader2, List, Anchor } from 'lucide-react';
import { parseDeepResearchText } from '../lib/agentModes';

interface DeepResearchReportViewProps {
  text: string;
  isLoading: boolean;
  onAddToNotebook: (content: string) => void;
  query: string;
  onCitationClick?: (marker: string) => void;
}

export const DeepResearchReportView: React.FC<DeepResearchReportViewProps> = ({
  text,
  isLoading,
  onAddToNotebook,
  query,
  onCitationClick,
}) => {
  const [copied, setCopied] = useState(false);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);

  const data = useMemo(() => parseDeepResearchText(text), [text]);

  const tocIds = useMemo(() => {
    const ids: string[] = [];
    if (data.executiveSummary) ids.push('exec-summary');
    data.sections.forEach((_, idx) => ids.push(`section-${idx}`));
    if (data.keyFindings.length > 0) ids.push('key-findings');
    if (data.methodologyNotes) ids.push('methodology');
    if (data.references.length > 0) ids.push('references');
    return ids;
  }, [data]);

  const handleExportMarkdown = () => {
    let markdown = `# Deep Research Report: ${query}\n\n`;
    if (data.executiveSummary) {
      markdown += `## Executive Summary\n${data.executiveSummary}\n\n`;
    }

    if (data.sections.length > 0) {
      data.sections.forEach(s => {
        markdown += `## ${s.title}\n${s.content}\n\n`;
      });
    }

    if (data.keyFindings.length > 0) {
      markdown += `## Key Findings\n\n`;
      data.keyFindings.forEach(kf => {
        markdown += `* ${kf}\n`;
      });
      markdown += `\n`;
    }

    if (data.methodologyNotes) {
      markdown += `## Methodology Notes\n${data.methodologyNotes}\n\n`;
    }

    if (data.futureDirections) {
      markdown += `## Future Directions\n${data.futureDirections}\n\n`;
    }

    if (data.references.length > 0) {
      markdown += `## References & Sources\n\n`;
      data.references.forEach(r => {
        markdown += `* ${r}\n`;
      });
      markdown += `\n`;
    }

    markdown += `*Confidence Level: ${data.confidence.toUpperCase()}*\n`;

    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Deep_Research_Report_${query.replace(/[^a-z0-9]/gi, '_')}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleNotebookAdd = () => {
    let markdown = `### Deep Research Report: ${query}\n\n`;
    if (data.executiveSummary) markdown += `**Executive Summary**\n${data.executiveSummary}\n\n`;
    
    if (data.sections.length > 0) {
      data.sections.forEach(s => {
        markdown += `**${s.title}**\n${s.content}\n\n`;
      });
    }

    if (data.keyFindings.length > 0) {
      markdown += `**Key Findings**\n`;
      data.keyFindings.forEach(kf => {
        markdown += `- ${kf}\n`;
      });
      markdown += `\n`;
    }

    if (data.methodologyNotes) markdown += `**Methodology**\n${data.methodologyNotes}\n\n`;
    if (data.futureDirections) markdown += `**Future Directions**\n${data.futureDirections}\n\n`;

    onAddToNotebook(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Helper to parse citations inline
  const renderTextWithCitations = (content: string) => {
    if (!content) return null;
    const regex = /(\[S\d+\])/g;
    const parts = content.split(regex);
    return parts.map((part, index) => {
      const citeMatch = part.match(/^\[S(\d+)\]$/);
      if (citeMatch && onCitationClick) {
        const marker = `S${citeMatch[1]}`;
        return (
          <button
            key={index}
            className="citation-link"
            onClick={() => onCitationClick(marker)}
            title={`Click to view Source ${marker}`}
          >
            {part}
          </button>
        );
      }
      return <span key={index}>{part}</span>;
    });
  };

  // Scroll handler to highlight active section in TOC sidebar
  useEffect(() => {
    const handleScroll = () => {
      let currentId = null;
      for (const id of tocIds) {
        const el = document.getElementById(id);
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.top <= 140) {
            currentId = id;
          }
        }
      }
      setActiveSectionId(currentId);
    };

    window.addEventListener('scroll', handleScroll);
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, [tocIds]);

  const scrollToHeading = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const hasContent = text.trim().length > 0;

  return (
    <div className="deep-report-container">
      {/* Top Header Panel */}
      <div className="deep-report-header-band">
        <div className="deep-report-title-section">
          <FileText className="deep-report-icon" size={24} />
          <div>
            <h2>Deep Research Report</h2>
            <p className="query-subtext">Comprehensive Academic Synthesis: "{query}"</p>
          </div>
        </div>

        {hasContent && (
          <div className="deep-report-actions">
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
          <p>Compiling multi-source literature, synthesizing evidence layers, and writing academic report...</p>
        </div>
      )}

      {hasContent && (
        <div className="deep-report-layout">
          {/* TOC Sidebar */}
          <aside className="deep-report-toc-sidebar">
            <div className="toc-header">
              <List size={16} />
              <span>Table of Contents</span>
            </div>
            <nav className="toc-nav">
              {data.executiveSummary && (
                <button
                  onClick={() => scrollToHeading('exec-summary')}
                  className={`toc-link ${(!activeSectionId && data.executiveSummary) || activeSectionId === 'exec-summary' ? 'active' : ''}`}
                >
                  <Anchor size={12} />
                  <span>Executive Summary</span>
                </button>
              )}
              {data.sections.map((s, idx) => (
                <button
                  key={idx}
                  onClick={() => scrollToHeading(`section-${idx}`)}
                  className={`toc-link ${activeSectionId === `section-${idx}` ? 'active' : ''}`}
                >
                  <Anchor size={12} />
                  <span className="truncate">{s.title}</span>
                </button>
              ))}
              {data.keyFindings.length > 0 && (
                <button
                  onClick={() => scrollToHeading('key-findings')}
                  className={`toc-link ${activeSectionId === 'key-findings' ? 'active' : ''}`}
                >
                  <Anchor size={12} />
                  <span>Key Findings</span>
                </button>
              )}
              {data.methodologyNotes && (
                <button
                  onClick={() => scrollToHeading('methodology')}
                  className={`toc-link ${activeSectionId === 'methodology' ? 'active' : ''}`}
                >
                  <Anchor size={12} />
                  <span>Methodology</span>
                </button>
              )}
              {data.references.length > 0 && (
                <button
                  onClick={() => scrollToHeading('references')}
                  className={`toc-link ${activeSectionId === 'references' ? 'active' : ''}`}
                >
                  <Anchor size={12} />
                  <span>References</span>
                </button>
              )}
            </nav>
          </aside>

          {/* Main Content Area */}
          <main className="deep-report-document scroll-margin-top">
            {/* Executive Summary */}
            {data.executiveSummary && (
              <section id="exec-summary" className="report-section exec-summary-section">
                <h3 className="report-section-anchor">Executive Summary</h3>
                <p className="narrative-paragraph">{renderTextWithCitations(data.executiveSummary)}</p>
              </section>
            )}

            {/* Sections */}
            {data.sections.map((s, idx) => (
              <section 
                key={idx} 
                id={`section-${idx}`} 
                className="report-section"
              >
                <h3 className="report-section-anchor">{s.title}</h3>
                <div className="section-content">
                  {s.content.split('\n\n').map((p, pIdx) => (
                    <p key={pIdx} className="narrative-paragraph">
                      {renderTextWithCitations(p)}
                    </p>
                  ))}
                </div>
              </section>
            ))}

            {/* Key Findings */}
            {data.keyFindings.length > 0 && (
              <section id="key-findings" className="report-section key-findings-section">
                <h3 className="report-section-anchor">Key Findings</h3>
                <ul className="findings-bullets">
                  {data.keyFindings.map((kf, idx) => (
                    <li key={idx}>{renderTextWithCitations(kf)}</li>
                  ))}
                </ul>
              </section>
            )}

            {/* Methodology Notes */}
            {data.methodologyNotes && (
              <section id="methodology" className="report-section">
                <h3 className="report-section-anchor">Methodology Analysis & Evaluation</h3>
                <p className="narrative-paragraph">{renderTextWithCitations(data.methodologyNotes)}</p>
              </section>
            )}

            {/* Future Directions */}
            {data.futureDirections && (
              <section id="future-directions" className="report-section">
                <h3 className="report-section-anchor">Future Research Directions</h3>
                <p className="narrative-paragraph">{renderTextWithCitations(data.futureDirections)}</p>
              </section>
            )}

            {/* References */}
            {data.references.length > 0 && (
              <section id="references" className="report-section references-section">
                <h3 className="report-section-anchor">References</h3>
                <ol className="references-list">
                  {data.references.map((ref, idx) => (
                    <li key={idx} className="reference-item">
                      {renderTextWithCitations(ref)}
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {/* Footer */}
            <div className="deep-report-footer">
              <span className={`confidence-badge ${data.confidence}`}>
                Confidence: {data.confidence.toUpperCase()}
              </span>
              {isLoading && (
                <span className="streaming-badge">
                  <Loader2 className="animate-spin" size={12} />
                  Writing report...
                </span>
              )}
            </div>
          </main>
        </div>
      )}
    </div>
  );
};
