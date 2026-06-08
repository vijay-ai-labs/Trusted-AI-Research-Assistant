import { describe, it, expect } from 'vitest';
import { parseLiteratureReviewText, parseDeepResearchText } from './agentModes';

describe('parseLiteratureReviewText', () => {
  it('should parse introduction background, objectives, scope, themes, methodology, discussion, conclusion, references', () => {
    const text = `
      INTRODUCTION_BACKGROUND: This is the background details.
      INTRODUCTION_OBJECTIVES: State objectives.
      INTRODUCTION_SCOPE: State scope.
      THEME: Theme A | Summary of A | Analysis of A | Gaps of A
      THEME: Theme B | Summary of B | Analysis of B | Gaps of B
      METHODOLOGY_COMPARISON: Methodology comparison details.
      METHODOLOGY_EVALUATION: Methodology evaluation details.
      DISCUSSION_SYNTHESIS: Discussion synthesis details.
      DISCUSSION_GAPS: Discussion gaps details.
      DISCUSSION_IMPLICATIONS: Discussion implications details.
      CONCLUSION_SUMMARY: Conclusion summary details.
      CONCLUSION_RELEVANCE: Conclusion relevance details.
      CONCLUSION_FUTURE_DIRECTIONS: Conclusion future directions.
      REFERENCES: [S1] Vaswani et al. (2017)
      REFERENCES: [S2] Devlin et al. (2018)
      CONFIDENCE: High
    `;
    const data = parseLiteratureReviewText(text);
    expect(data.introductionBackground).toBe('This is the background details.');
    expect(data.introductionObjectives).toBe('State objectives.');
    expect(data.introductionScope).toBe('State scope.');

    expect(data.themes).toHaveLength(2);
    expect(data.themes[0]).toEqual({
      title: 'Theme A',
      summaryOfStudies: 'Summary of A',
      criticalAnalysis: 'Analysis of A',
      gapsAndLimitations: 'Gaps of A',
    });
    expect(data.themes[1]).toEqual({
      title: 'Theme B',
      summaryOfStudies: 'Summary of B',
      criticalAnalysis: 'Analysis of B',
      gapsAndLimitations: 'Gaps of B',
    });

    expect(data.methodologyComparison).toBe('Methodology comparison details.');
    expect(data.methodologyEvaluation).toBe('Methodology evaluation details.');
    expect(data.discussionSynthesis).toBe('Discussion synthesis details.');
    expect(data.discussionGaps).toBe('Discussion gaps details.');
    expect(data.discussionImplications).toBe('Discussion implications details.');
    expect(data.conclusionSummary).toBe('Conclusion summary details.');
    expect(data.conclusionRelevance).toBe('Conclusion relevance details.');
    expect(data.conclusionFutureDirections).toBe('Conclusion future directions.');
    expect(data.references).toEqual(['[S1] Vaswani et al. (2017)', '[S2] Devlin et al. (2018)']);
    expect(data.confidence).toBe('high');

    // Backwards compatibility computed fields
    expect(data.introduction).toBe('This is the background details.\n\nState objectives.\n\nState scope.');
    expect(data.overview).toBe(data.introduction);
    expect(data.conclusion).toBe('Conclusion summary details.\n\nConclusion relevance details.\n\nConclusion future directions.');
    expect(data.futureDirections).toBe('Conclusion future directions.');
  });

  it('should parse legacy literature review formats for backward compatibility', () => {
    const text = `
      INTRODUCTION: Legacy introduction.
      THEME: Legacy Theme | Legacy Theme content.
      GAP: Legacy Gap | Legacy Gap content.
      COMPARISON: Legacy aspect | Legacy sources | Legacy details.
      FUTURE_DIRECTIONS: Legacy future directions.
      CONCLUSION: Legacy conclusion.
      REFERENCES: [S1] Source citation
      CONFIDENCE: medium
    `;
    const data = parseLiteratureReviewText(text);
    expect(data.introductionBackground).toBe('Legacy introduction.');
    expect(data.themes).toHaveLength(1);
    expect(data.themes[0]).toEqual({
      title: 'Legacy Theme',
      summaryOfStudies: 'Legacy Theme content.',
      criticalAnalysis: '',
      gapsAndLimitations: '',
    });
    expect(data.gaps).toHaveLength(1);
    expect(data.gaps?.[0]).toEqual({ title: 'Legacy Gap', content: 'Legacy Gap content.' });
    expect(data.comparison).toHaveLength(1);
    expect(data.comparison?.[0]).toEqual({ aspect: 'Legacy aspect', sources: 'Legacy sources', details: 'Legacy details.' });
    expect(data.conclusionSummary).toBe('Legacy conclusion.');
    expect(data.conclusionFutureDirections).toBe('Legacy future directions.');
    expect(data.references).toEqual(['[S1] Source citation']);
    expect(data.confidence).toBe('medium');

    // Computations
    expect(data.introduction).toBe('Legacy introduction.');
    expect(data.conclusion).toBe('Legacy conclusion.\n\n\n\nLegacy future directions.');
  });
});

describe('parseDeepResearchText', () => {
  it('should parse standard deep research report structure', () => {
    const text = `
      EXECUTIVE_SUMMARY: Exec summary paragraph.
      SECTION: Section 1 | Multi-paragraph text.
      KEY_FINDINGS: Finding A
      KEY_FINDINGS: Finding B
      METHODOLOGY_NOTES: Methodology summary.
      FUTURE_DIRECTIONS: Crucial future directions.
      REFERENCES: [S1] Source citation
      CONFIDENCE: medium
    `;
    const data = parseDeepResearchText(text);
    expect(data.executiveSummary).toBe('Exec summary paragraph.');
    expect(data.sections).toHaveLength(1);
    expect(data.sections[0]).toEqual({ title: 'Section 1', content: 'Multi-paragraph text.' });
    expect(data.keyFindings).toEqual(['Finding A', 'Finding B']);
    expect(data.methodologyNotes).toBe('Methodology summary.');
    expect(data.futureDirections).toBe('Crucial future directions.');
    expect(data.references).toEqual(['[S1] Source citation']);
    expect(data.confidence).toBe('medium');
  });
});
