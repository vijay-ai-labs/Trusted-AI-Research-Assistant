import React, { useState, useRef, useEffect } from 'react';
import { Sparkles, Globe, BookOpen, FileText, FileSpreadsheet, ChevronDown } from 'lucide-react';
import { AGENT_MODES, AgentMode } from '../lib/agentModes';

interface AgentModeSelectorProps {
  currentMode: AgentMode;
  onChange: (mode: AgentMode) => void;
  disabled?: boolean;
}

export const AgentModeSelector: React.FC<AgentModeSelectorProps> = ({ currentMode, onChange, disabled }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const activeMode = AGENT_MODES.find(m => m.id === currentMode) || AGENT_MODES[0];

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getIcon = (iconName: string) => {
    switch (iconName) {
      case 'SearchCode': return <Sparkles className="mode-icon" size={18} />;
      case 'Globe': return <Globe className="mode-icon" size={18} />;
      case 'BookOpen': return <BookOpen className="mode-icon" size={18} />;
      case 'FileText': return <FileText className="mode-icon" size={18} />;
      case 'FileSpreadsheet': return <FileSpreadsheet className="mode-icon" size={18} />;
      default: return <Sparkles className="mode-icon" size={18} />;
    }
  };

  return (
    <div className="agent-mode-selector" ref={dropdownRef}>
      <button
        type="button"
        className="agent-mode-trigger"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        aria-label={`Select agent mode (current: ${activeMode.label})`}
        title={`Select agent mode (current: ${activeMode.label})`}
      >
        {getIcon(activeMode.icon)}
      </button>

      {isOpen && (
        <div className="agent-mode-dropdown">
          <div className="dropdown-header">Select Search Mode</div>
          <div className="dropdown-options">
            {AGENT_MODES.map(mode => {
              const isActive = mode.id === currentMode;
              return (
                <button
                  key={mode.id}
                  type="button"
                  className={`agent-mode-option ${isActive ? 'active' : ''}`}
                  onClick={() => {
                    onChange(mode.id);
                    setIsOpen(false);
                  }}
                >
                  <div className="mode-option-icon-wrapper">
                    {getIcon(mode.icon)}
                  </div>
                  <div className="mode-option-info">
                    <div className="mode-option-label">{mode.label}</div>
                    <div className="mode-option-description">{mode.description}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
