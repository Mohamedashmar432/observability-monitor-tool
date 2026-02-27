import React, { useEffect, useState } from 'react';
import type { ChromeMessage } from '../../types';

interface IdleViewProps {
  onStart: (flowName: string) => void;
}

export default function IdleView({ onStart }: IdleViewProps): React.ReactElement {
  const [flowName, setFlowName] = useState('');
  const [backendReachable, setBackendReachable] = useState<boolean | null>(null);
  const [backendUrl, setBackendUrl] = useState('http://localhost:5000');
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Load backend URL from settings
    chrome.storage.sync.get(['backendUrl']).then((result) => {
      const url = (result['backendUrl'] as string | undefined) ?? 'http://localhost:5000';
      setBackendUrl(url);
    });

    // Ping backend on mount
    const pingMsg: ChromeMessage = { type: 'PING_BACKEND' };
    chrome.runtime.sendMessage(pingMsg).then((response) => {
      if (response?.success && response.data?.ok) {
        setBackendReachable(true);
      } else {
        setBackendReachable(false);
      }
    }).catch(() => {
      setBackendReachable(false);
    });
  }, []);

  const handleStart = async () => {
    const trimmed = flowName.trim();
    if (!trimmed) {
      setError('Please enter a flow name.');
      return;
    }
    setIsStarting(true);
    setError(null);
    onStart(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleStart();
  };

  return (
    <div className="flex flex-col p-4 gap-4">
      {/* Logo */}
      <div className="flex items-center gap-2">
        <span className="text-xl font-bold text-synthmon-navy tracking-tight">
          SynthMon
        </span>
        <span className="text-xs bg-synthmon-navy text-white px-2 py-0.5 rounded font-semibold">
          Recorder
        </span>
      </div>

      {/* Backend status */}
      <div className="flex items-center gap-2 text-sm">
        <span
          className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
            backendReachable === null
              ? 'bg-gray-300 animate-pulse'
              : backendReachable
              ? 'bg-green-500'
              : 'bg-red-500'
          }`}
        />
        <span className="text-gray-500 text-xs truncate">{backendUrl}</span>
      </div>

      {/* Unreachable warning */}
      {backendReachable === false && (
        <div className="text-xs text-red-600 bg-red-50 rounded p-2 border border-red-200">
          Cannot reach SynthMon backend. Check your URL in Settings.
        </div>
      )}

      {/* Flow name input */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
          Flow Name
        </label>
        <input
          type="text"
          className="border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-synthmon-navy"
          placeholder="e.g. User Login Flow"
          value={flowName}
          onChange={(e) => setFlowName(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>

      {/* Start button */}
      <button
        className="bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white font-bold py-2.5 px-4 rounded transition-colors text-sm"
        onClick={handleStart}
        disabled={isStarting}
      >
        {isStarting ? 'Starting…' : '● Start Recording'}
      </button>

      {/* Settings link */}
      <button
        className="text-xs text-gray-400 hover:text-gray-600 text-left"
        onClick={() => chrome.runtime.openOptionsPage()}
      >
        ⚙ Settings
      </button>
    </div>
  );
}
