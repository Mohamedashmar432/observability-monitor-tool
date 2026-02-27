import React, { useEffect, useRef, useState } from 'react';
import type { BackendCredential, CredentialMapping, PendingCredential } from '../../types';

interface CredentialDialogProps {
  pendingCredentials: PendingCredential[];
  onSave: (mappings: CredentialMapping[]) => void;
  onSkip: () => void;
}

interface CredentialInputs {
  [selector: string]: string;
}

// Derive a friendly site name from the URL stored in the first pending credential
function getSiteName(pendingCredentials: PendingCredential[]): string {
  const url = pendingCredentials[0]?.siteUrl;
  if (!url) return '';
  try {
    const { hostname } = new URL(url);
    // Strip www. prefix and return e.g. "callthecar.com Login"
    return `${hostname.replace(/^www\./, '')} Login`;
  } catch {
    return '';
  }
}

export default function CredentialDialog({
  pendingCredentials,
  onSave,
  onSkip,
}: CredentialDialogProps): React.ReactElement {
  const [credentialName, setCredentialName] = useState(() => getSiteName(pendingCredentials));
  const [inputs, setInputs] = useState<CredentialInputs>({});
  const [existingCredentials, setExistingCredentials] = useState<BackendCredential[]>([]);
  const [selectedExisting, setSelectedExisting] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs so we can clear values after POST
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  useEffect(() => {
    // Fetch existing credentials for the dropdown
    chrome.storage.sync.get(['backendUrl', 'apiKey']).then((result) => {
      const backendUrl = (result['backendUrl'] as string | undefined) ?? 'http://localhost:5000';
      const apiKey = result['apiKey'] as string | undefined;

      const headers: Record<string, string> = {
        'x-synthmon-extension-version': '1.0.0',
      };
      // SECURITY: API key sent as Bearer; never logged
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

      fetch(`${backendUrl}/api/credentials`, { headers })
        .then((r) => r.json())
        .then((data: BackendCredential[]) => setExistingCredentials(data))
        .catch(() => {
          // Non-critical; dropdown just stays empty
        });
    });
  }, []);

  const handleInput = (selector: string, value: string) => {
    setInputs((prev) => ({ ...prev, [selector]: value }));
  };

  const handleSave = async () => {
    if (!credentialName.trim() && !selectedExisting) {
      setError('Enter a credential name or select an existing one.');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const result = await chrome.storage.sync.get(['backendUrl', 'apiKey']);
      const backendUrl = (result['backendUrl'] as string | undefined) ?? 'http://localhost:5000';
      const apiKey = result['apiKey'] as string | undefined;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-synthmon-extension-version': '1.0.0',
      };
      // SECURITY: API key sent as Bearer; never logged
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

      let credentialId: string;

      if (selectedExisting) {
        credentialId = selectedExisting;
      } else {
        // Build payload — find username + password pair
        const usernameCredential = pendingCredentials.find(
          (c) => c.credentialHint === 'username'
        );
        const passwordCredential = pendingCredentials.find(
          (c) => c.credentialHint === 'password'
        );

        // SECURITY: Credential values are only sent once to the backend over HTTPS;
        // they are cleared from memory immediately after POST completes.
        const hasUsername = !!usernameCredential;
        const hasPassword = !!passwordCredential;
        const credType = hasUsername || hasPassword ? 'login_pair' : 'other';

        const payload: Record<string, string> = {
          name: credentialName.trim(),
          type: credType,
          value: '', // empty for login_pair; required field for non-pair types
        };
        if (usernameCredential) {
          payload['usernameValue'] = inputs[usernameCredential.selector] ?? '';
        }
        if (passwordCredential) {
          payload['passwordValue'] = inputs[passwordCredential.selector] ?? '';
        }

        const response = await fetch(`${backendUrl}/api/credentials`, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error(`Failed to save credential: ${response.statusText}`);
        }

        const data = (await response.json()) as { id: string };
        credentialId = data.id;
      }

      // SECURITY: Clear all credential inputs immediately after POST completes
      inputRefs.current.forEach((inputEl) => {
        inputEl.value = '';
      });
      setInputs({});

      // Build credential mappings
      const mappings: CredentialMapping[] = pendingCredentials.map((cred) => ({
        stepSelector: cred.selector,
        credentialId,
        credentialField:
          cred.credentialHint === 'username'
            ? 'usernameValue'
            : cred.credentialHint === 'password'
            ? 'passwordValue'
            : 'value',
      }));

      onSave(mappings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save credentials.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col p-4 gap-3">
      <div className="flex items-center gap-2">
        <span className="text-base">🔐</span>
        <span className="font-bold text-gray-800 text-sm">Credentials Detected</span>
      </div>
      <p className="text-xs text-gray-500">
        These fields were detected. Enter values to store securely.
      </p>

      {/* Credential fields */}
      {pendingCredentials.map((cred) => (
        <div key={cred.selector} className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-600">
            {cred.fieldName} ({cred.credentialHint})
          </label>
          <input
            type={cred.credentialHint === 'password' ? 'password' : 'text'}
            className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-synthmon-navy"
            autoComplete={cred.credentialHint === 'password' ? 'new-password' : 'off'}
            placeholder={`Enter ${cred.credentialHint}`}
            onChange={(e) => handleInput(cred.selector, e.target.value)}
            ref={(el) => {
              if (el) inputRefs.current.set(cred.selector, el);
            }}
          />
        </div>
      ))}

      {/* Credential name */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold text-gray-600">Credential Name</label>
        <input
          type="text"
          className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-synthmon-navy"
          placeholder='e.g. "My App Login"'
          autoComplete="off"
          value={credentialName}
          onChange={(e) => setCredentialName(e.target.value)}
        />
      </div>

      {/* Existing credentials dropdown */}
      {existingCredentials.length > 0 && (
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-600">
            Or use existing credential
          </label>
          <select
            className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-synthmon-navy"
            value={selectedExisting}
            onChange={(e) => setSelectedExisting(e.target.value)}
          >
            <option value="">— Select existing —</option>
            {existingCredentials.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}

      <button
        className="bg-synthmon-navy hover:bg-synthmon-accent text-white font-bold py-2 px-4 rounded text-sm transition-colors disabled:opacity-50"
        onClick={handleSave}
        disabled={isSaving}
      >
        {isSaving ? 'Saving…' : 'Save & Encrypt'}
      </button>
      <button
        className="text-gray-500 hover:text-gray-700 text-sm py-1 transition-colors"
        onClick={onSkip}
      >
        Skip
      </button>
    </div>
  );
}
