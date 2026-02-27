import React, { useEffect, useState } from 'react';
import type { RecordedStep } from '../../types';

interface RecordingViewProps {
  flowName: string;
  steps: RecordedStep[];
  startedAt: number | null;
  onSave: () => void;
  onCancel: () => void;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function truncate(str: string, maxLen = 35): string {
  return str.length > maxLen ? str.slice(0, maxLen - 1) + '…' : str;
}

export default function RecordingView({
  flowName,
  steps,
  startedAt,
  onSave,
  onCancel,
}: RecordingViewProps): React.ReactElement {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed(Date.now() - (startedAt ?? Date.now()));
    }, 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  const recentSteps = [...steps].reverse().slice(0, 5);

  return (
    <div className="flex flex-col p-4 gap-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
        <span className="font-bold text-red-600 text-sm">Recording…</span>
        <span className="ml-auto text-xs text-gray-400 font-mono">
          {formatDuration(elapsed)}
        </span>
      </div>

      {/* Flow name */}
      <div className="text-xs text-gray-500">
        Flow: <span className="font-semibold text-gray-700">{flowName}</span>
      </div>

      {/* Step counter */}
      <div className="text-sm font-semibold text-gray-700">
        {steps.length} step{steps.length !== 1 ? 's' : ''} recorded
      </div>

      {/* Recent steps */}
      {recentSteps.length > 0 && (
        <div className="flex flex-col gap-1 bg-gray-50 rounded p-2 border border-gray-100">
          {recentSteps.map((step, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="bg-synthmon-navy text-white px-1.5 py-0.5 rounded text-[10px] font-mono uppercase flex-shrink-0">
                {step.action}
              </span>
              <span className="text-gray-600 truncate">
                {truncate(step.selector || step.url || '')}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Action buttons */}
      <button
        className="bg-green-600 hover:bg-green-700 text-white font-bold py-2.5 px-4 rounded transition-colors text-sm mt-1"
        onClick={onSave}
      >
        Save Flow
      </button>
      <button
        className="text-gray-500 hover:text-gray-700 text-sm py-1 transition-colors"
        onClick={onCancel}
      >
        Cancel
      </button>
    </div>
  );
}
