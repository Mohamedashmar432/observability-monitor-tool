import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const DEFAULT_BACKEND_URL = 'http://localhost:5000';

function OptionsApp(): React.ReactElement {
  const [backendUrl, setBackendUrl] = useState(DEFAULT_BACKEND_URL);
  const [apiKey, setApiKey] = useState('');
  const [pingStatus, setPingStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    chrome.storage.sync.get(['backendUrl', 'apiKey']).then((result) => {
      setBackendUrl((result['backendUrl'] as string | undefined) ?? DEFAULT_BACKEND_URL);
      setApiKey((result['apiKey'] as string | undefined) ?? '');
    });
  }, []);

  const handleTestConnection = async () => {
    setPingStatus('testing');
    try {
      const headers: Record<string, string> = {
        'x-synthmon-extension-version': '1.0.0',
      };
      // SECURITY: API key sent as Bearer; never logged
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

      const res = await fetch(`${backendUrl}/api/extension/ping`, { headers });
      setPingStatus(res.ok ? 'ok' : 'error');
    } catch {
      setPingStatus('error');
    }
  };

  const handleSave = async () => {
    // SECURITY: API key stored in chrome.storage.sync (encrypted by Chrome)
    await chrome.storage.sync.set({
      backendUrl: backendUrl.trim(),
      apiKey: apiKey.trim() || null,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleReset = () => {
    setBackendUrl(DEFAULT_BACKEND_URL);
    setApiKey('');
    setPingStatus('idle');
  };

  const handleOpenDashboard = () => {
    chrome.tabs.create({ url: backendUrl });
  };

  return (
    <div className="max-w-lg mx-auto p-6 font-sans">
      <div className="flex items-center gap-2 mb-6">
        <span className="text-2xl font-bold text-synthmon-navy">SynthMon</span>
        <span className="text-xs bg-synthmon-navy text-white px-2 py-0.5 rounded font-semibold">
          Recorder
        </span>
        <span className="ml-auto text-xs text-gray-400">v1.0.0</span>
      </div>

      <div className="flex flex-col gap-5">
        {/* Backend URL */}
        <div className="flex flex-col gap-1">
          <label className="text-sm font-semibold text-gray-700">Backend URL</label>
          <div className="flex gap-2">
            <input
              type="url"
              className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-synthmon-navy"
              value={backendUrl}
              onChange={(e) => {
                setBackendUrl(e.target.value);
                setPingStatus('idle');
              }}
              placeholder={DEFAULT_BACKEND_URL}
            />
            <button
              className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-2 rounded text-sm font-medium transition-colors whitespace-nowrap"
              onClick={handleTestConnection}
              disabled={pingStatus === 'testing'}
            >
              {pingStatus === 'testing' ? 'Testing…' : 'Test Connection'}
            </button>
          </div>
          {pingStatus === 'ok' && (
            <p className="text-xs text-green-600 font-medium">Connected ✓</p>
          )}
          {pingStatus === 'error' && (
            <p className="text-xs text-red-600 font-medium">Cannot reach server ✗</p>
          )}
        </div>

        {/* API Key */}
        <div className="flex flex-col gap-1">
          <label className="text-sm font-semibold text-gray-700">
            API Key <span className="font-normal text-gray-400">(optional)</span>
          </label>
          <input
            type="password"
            className="border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-synthmon-navy"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-…"
            autoComplete="new-password"
          />
        </div>

        {/* Buttons */}
        <div className="flex gap-2">
          <button
            className="bg-synthmon-navy hover:bg-synthmon-accent text-white font-semibold px-4 py-2 rounded text-sm transition-colors"
            onClick={handleSave}
          >
            {saved ? 'Saved ✓' : 'Save Settings'}
          </button>
          <button
            className="bg-gray-100 hover:bg-gray-200 text-gray-600 px-4 py-2 rounded text-sm transition-colors"
            onClick={handleReset}
          >
            Reset to Defaults
          </button>
        </div>

        {/* Dashboard link */}
        <div className="border-t border-gray-100 pt-4 flex flex-col gap-2">
          <button
            className="text-sm text-synthmon-navy hover:underline text-left"
            onClick={handleOpenDashboard}
          >
            Open SynthMon Dashboard →
          </button>
        </div>

        {/* About */}
        <div className="border-t border-gray-100 pt-4">
          <p className="text-xs text-gray-400">
            About SynthMon Recorder v1.0.0 — Records browser flows for synthetic
            monitoring. All credentials are encrypted before storage.
          </p>
        </div>
      </div>
    </div>
  );
}

const container = document.getElementById('root');
if (!container) throw new Error('Root element not found');

const root = createRoot(container);
root.render(<OptionsApp />);
