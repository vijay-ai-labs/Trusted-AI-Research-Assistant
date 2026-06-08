import React, { useState, useRef, useEffect } from 'react';
import { FileText, Upload, Trash2, Send, Loader2, User, Bot, HelpCircle, AlertCircle } from 'lucide-react';
import type { UploadedPDFState } from '../../research';
import { streamSynthesisAnswer, SynthesisSource } from '../lib/openaiSynthesisService';

interface ChatWithPDFViewProps {
  uploadedPDF: UploadedPDFState | null;
  onPDFUpload: (file: File) => Promise<void>;
  onRemovePDF: () => void;
  onCitationClick?: (marker: string) => void;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const parseInlineMarkdown = (text: string, onCitationClick?: (marker: string) => void) => {
  const parts = text.split(/(\*\*.*?\*\*|\*.*?\*|`.*?`|\[S\d+\])/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={idx}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={idx}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={idx} className="markdown-code" style={{ background: 'var(--bg-local)', padding: '2px 4px', borderRadius: '4px', fontFamily: 'monospace' }}>{part.slice(1, -1)}</code>;
    }
    if (part.match(/^\[S(\d+)\]$/)) {
      const match = part.match(/^\[S(\d+)\]$/);
      const num = match ? match[1] : '1';
      const marker = `S${num}`;
      if (onCitationClick) {
        return (
          <button
            key={idx}
            className="citation-link"
            onClick={() => onCitationClick(marker)}
            title={`Click to view details for ${marker}`}
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
      }
      return <span key={idx} className="citation-marker" style={{ color: 'var(--primary)', fontWeight: 'bold', verticalAlign: 'super', fontSize: '0.72rem' }}>{part}</span>;
    }
    return part;
  });
};

const renderMarkdownText = (text: string, onCitationClick?: (marker: string) => void) => {
  if (!text) return null;
  const blocks = text.split(/\n\n+/);
  return blocks.map((block, blockIdx) => {
    const trimmed = block.trim();
    if (!trimmed) return null;

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const content = headingMatch[2];
      const Tag = `h${level}` as any;
      return <Tag key={blockIdx} style={{ margin: '12px 0 6px 0', fontSize: level === 1 ? '1.5rem' : level === 2 ? '1.3rem' : '1.1rem' }}>{parseInlineMarkdown(content, onCitationClick)}</Tag>;
    }

    if (trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.match(/^\d+\.\s+/)) {
      const lines = trimmed.split('\n');
      const firstLineMatch = lines[0].match(/^(\d+)\.\s+/);
      const isOrdered = !!firstLineMatch;
      const ListTag = isOrdered ? 'ol' : 'ul';
      const startVal = firstLineMatch ? parseInt(firstLineMatch[1], 10) : undefined;
      return (
        <ListTag key={blockIdx} start={startVal} style={{ paddingLeft: '20px', margin: '8px 0' }}>
          {lines.map((line, lineIndex) => {
            const cleanLine = line.replace(/^(?:-\s+|\*\s+|\d+\.\s+)/, '');
            return <li key={lineIndex} style={{ marginBottom: '4px' }}>{parseInlineMarkdown(cleanLine, onCitationClick)}</li>;
          })}
        </ListTag>
      );
    }

    if (trimmed.startsWith('```')) {
      const content = trimmed.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '');
      return (
        <pre key={blockIdx} style={{ background: 'var(--bg-local)', padding: '10px', borderRadius: '6px', overflowX: 'auto', margin: '10px 0' }}>
          <code style={{ fontFamily: 'monospace' }}>{content}</code>
        </pre>
      );
    }

    const lines = trimmed.split('\n');
    return (
      <p key={blockIdx} style={{ margin: '0 0 10px 0', lineHeight: '1.5' }}>
        {lines.map((line, lineIndex) => (
          <React.Fragment key={lineIndex}>
            {lineIndex > 0 && <br />}
            {parseInlineMarkdown(line, onCitationClick)}
          </React.Fragment>
        ))}
      </p>
    );
  });
};

export const ChatWithPDFView: React.FC<ChatWithPDFViewProps> = ({
  uploadedPDF,
  onPDFUpload,
  onRemovePDF,
  onCitationClick,
}) => {
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, streamingText]);

  // Reset chat history when PDF changes or is removed
  useEffect(() => {
    setChatHistory([]);
    setStreamingText('');
    setIsLoading(false);
  }, [uploadedPDF?.fileName]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onPDFUpload(e.target.files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      onPDFUpload(e.dataTransfer.files[0]);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isLoading || !uploadedPDF) return;

    const userMessage = inputValue.trim();
    setInputValue('');
    setChatHistory(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsLoading(true);
    setStreamingText('');

    // Package the PDF text as the single source
    const pdfSource: SynthesisSource = {
      marker: 'S1',
      title: uploadedPDF.fileName,
      authors: uploadedPDF.analysis?.authors || ['Uploaded Document'],
      year: uploadedPDF.analysis?.year || new Date().getFullYear(),
      sourceName: 'Uploaded PDF',
      sourceType: 'paper',
      peerReviewed: false,
      provenance: 'uploaded-pdf',
      abstract: uploadedPDF.extractedText || uploadedPDF.analysis?.summaryForPhDStudent || 'PDF Content',
      trustNotes: 'User-provided PDF text context.',
      url: uploadedPDF.objectUrl || '',
    };

    const historyPayload = chatHistory.map(msg => ({
      role: msg.role,
      content: msg.content,
    }));

    try {
      await streamSynthesisAnswer(
        userMessage,
        [pdfSource],
        (chunk) => {
          setStreamingText(prev => prev + chunk);
        },
        (doneText) => {
          setChatHistory(prev => [...prev, { role: 'assistant', content: doneText }]);
          setStreamingText('');
          setIsLoading(false);
        },
        (error) => {
          console.error('PDF chat stream error:', error);
          setChatHistory(prev => [
            ...prev,
            { role: 'assistant', content: `Error: ${error.message || 'Failed to stream answer from PDF.'}` }
          ]);
          setStreamingText('');
          setIsLoading(false);
        },
        undefined,
        historyPayload,
        true, // acts as follow-up to include history context
        'chat-with-pdf'
      );
    } catch (err) {
      console.error('PDF chat execution error:', err);
      setChatHistory(prev => [
        ...prev,
        { role: 'assistant', content: 'An unexpected error occurred while communicating with the model.' }
      ]);
      setIsLoading(false);
    }
  };

  return (
    <div className="chat-pdf-container">
      {!uploadedPDF ? (
        /* Empty / Upload State */
        <div className="chat-pdf-upload-panel">
          <div 
            className="chat-pdf-dropzone"
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileChange} 
              accept=".pdf" 
              style={{ display: 'none' }}
            />
            <div className="dropzone-icon-wrapper">
              <Upload className="dropzone-icon" size={32} />
            </div>
            <h3>Upload PDF to Start Chatting</h3>
            <p>Drag and drop your academic paper or research document here, or click to browse files.</p>
            <span className="file-info-limit">Supports standard PDF documents up to 50 pages (approx. 60k characters).</span>
          </div>
        </div>
      ) : (
        /* Active Two-Pane Layout */
        <div className="chat-pdf-workspace">
          {/* Left Column: PDF Viewer */}
          <div className="chat-pdf-viewer-pane">
            <div className="pane-header">
              <div className="pdf-title-info">
                <FileText size={18} className="text-accent" />
                <span className="pdf-filename">{uploadedPDF.fileName}</span>
              </div>
              <button 
                onClick={onRemovePDF} 
                className="pdf-remove-btn"
                title="Remove PDF and upload new"
              >
                <Trash2 size={14} />
                <span>Remove</span>
              </button>
            </div>
            
            <div className="pdf-iframe-container">
              {uploadedPDF.status === 'extracting' || uploadedPDF.status === 'analyzing' || uploadedPDF.status === 'enriching' ? (
                <div className="pdf-loading-overlay">
                  <Loader2 className="animate-spin text-accent" size={32} />
                  <p>{uploadedPDF.statusMessage}</p>
                </div>
              ) : uploadedPDF.objectUrl ? (
                <iframe 
                  src={`${uploadedPDF.objectUrl}#toolbar=0`} 
                  className="pdf-iframe"
                  title="PDF Viewer"
                />
              ) : (
                <div className="pdf-error-overlay">
                  <p>PDF Viewer unavailable. (Object URL missing)</p>
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Chat Interface */}
          <div className="chat-pdf-chat-pane">
            <div className="pane-header">
              <h3>Chat with Document</h3>
              {uploadedPDF.analysis && (
                <span className="metadata-badge">
                  Confidence: {uploadedPDF.analysis.confidence}
                </span>
              )}
            </div>

            {/* Message Area */}
            <div className="chat-pdf-messages-list">
              {uploadedPDF.status === 'low-text' && (
                <div className="pdf-status-banner warning" style={{ display: 'flex', gap: '8px', padding: '12px', background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.2)', borderRadius: '8px', marginBottom: '16px', color: '#b45309' }}>
                  <AlertCircle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
                  <div>
                    <strong style={{ display: 'block', fontSize: '0.9rem', marginBottom: '2px' }}>Extraction Limited</strong>
                    <p style={{ margin: 0, fontSize: '0.85rem', lineHeight: '1.4' }}>{uploadedPDF.statusMessage}</p>
                  </div>
                </div>
              )}
              {uploadedPDF.status === 'error' && (
                <div className="pdf-status-banner error" style={{ display: 'flex', gap: '8px', padding: '12px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '8px', marginBottom: '16px', color: '#b91c1c' }}>
                  <AlertCircle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
                  <div>
                    <strong style={{ display: 'block', fontSize: '0.9rem', marginBottom: '2px' }}>Analysis Failed</strong>
                    <p style={{ margin: 0, fontSize: '0.85rem', lineHeight: '1.4' }}>{uploadedPDF.statusMessage || 'Could not analyze document content.'}</p>
                  </div>
                </div>
              )}

              {chatHistory.length === 0 && !streamingText && (
                <div className="chat-empty-state">
                  <HelpCircle className="chat-empty-icon" size={40} />
                  <h4>Ask questions about this paper</h4>
                  <p>You can ask for summaries, explain methodologies, extract key equations, or challenge findings. The AI will only use this PDF to answer.</p>
                  <div className="suggested-queries">
                    <button 
                      onClick={() => setInputValue("Summarize the main contributions of this paper.")}
                      className="suggested-btn"
                      disabled={uploadedPDF.status === 'low-text' || uploadedPDF.status === 'error'}
                    >
                      "Summarize main contributions"
                    </button>
                    <button 
                      onClick={() => setInputValue("What methodology did the authors use?")}
                      className="suggested-btn"
                      disabled={uploadedPDF.status === 'low-text' || uploadedPDF.status === 'error'}
                    >
                      "Explain the methodology"
                    </button>
                  </div>
                </div>
              )}

              {chatHistory.map((msg, index) => (
                <div key={index} className={`chat-message-bubble-wrapper ${msg.role}`}>
                  <div className="chat-message-avatar">
                    {msg.role === 'user' ? <User size={14} /> : <Bot size={14} />}
                  </div>
                  <div className="chat-message-bubble">
                    {msg.role === 'user' ? <p>{msg.content}</p> : renderMarkdownText(msg.content, onCitationClick)}
                  </div>
                </div>
              ))}

              {/* Streaming Content */}
              {streamingText && (
                <div className="chat-message-bubble-wrapper assistant streaming">
                  <div className="chat-message-avatar">
                    <Bot size={14} />
                  </div>
                  <div className="chat-message-bubble">
                    {renderMarkdownText(streamingText, onCitationClick)}
                  </div>
                </div>
              )}

              {isLoading && !streamingText && (
                <div className="chat-message-bubble-wrapper assistant loading">
                  <div className="chat-message-avatar">
                    <Bot size={14} />
                  </div>
                  <div className="chat-message-bubble">
                    <Loader2 className="animate-spin" size={16} />
                  </div>
                </div>
              )}
              
              <div ref={chatEndRef} />
            </div>

            {/* Input Bar */}
            <form onSubmit={handleSend} className="chat-pdf-input-form">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder={uploadedPDF.status === 'low-text' || uploadedPDF.status === 'error' ? "Chat disabled for this document" : "Ask about this paper..."}
                disabled={isLoading || !uploadedPDF || uploadedPDF.status === 'low-text' || uploadedPDF.status === 'error'}
                className="chat-pdf-input"
              />
              <button
                type="submit"
                disabled={isLoading || !inputValue.trim() || !uploadedPDF || uploadedPDF.status === 'low-text' || uploadedPDF.status === 'error'}
                className="chat-pdf-send-btn"
                title="Send message"
              >
                <Send size={16} />
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
