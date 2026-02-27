import React, { useEffect, useState, useCallback } from 'react';
import type { ChromeMessage, CredentialMapping, PendingCredential, RecordedStep, RecordingSession } from '../types';
import IdleView from './components/IdleView';
import RecordingView from './components/RecordingView';
import CredentialDialog from './components/CredentialDialog';

type AppView = 'idle' | 'recording' | 'credential_dialog' | 'saving' | 'saved' | 'error';

export default function App(): React.ReactElement {
  const [view, setView] = useState<AppView>('idle');
  const [session, setSession] = useState<RecordingSession | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savedFlowId, setSavedFlowId] = useState<string | null>(null);

  // ─── Load current state from background on mount ─────────────────────────
  useEffect(() => {
    const msg: ChromeMessage = { type: 'GET_STATE' };
    chrome.runtime.sendMessage(msg).then((response) => {
      if (response?.success && response.data) {
        const s = response.data as RecordingSession;
        setSession(s);
        if (s.status === 'recording') {
          // If credentials were detected while the popup was closed, go straight to
          // the credential dialog so they are not silently lost on save.
          if (s.pendingCredentials && s.pendingCredentials.length > 0) {
            setView('credential_dialog');
          } else {
            setView('recording');
          }
        } else if (s.status === 'error') {
          setView('error');
          setErrorMessage('Recording was interrupted. Please start a new recording.');
        } else {
          setView('idle');
        }
      }
    }).catch(() => {
      setView('idle');
    });
  }, []);

  // ─── Listen for background messages (e.g. OPEN_CREDENTIAL_DIALOG) ────────
  useEffect(() => {
    const listener = (message: ChromeMessage) => {
      if (message.type === 'OPEN_CREDENTIAL_DIALOG') {
        setView('credential_dialog');
        // Refresh session to get latest pending credentials
        const msg: ChromeMessage = { type: 'GET_STATE' };
        chrome.runtime.sendMessage(msg).then((response) => {
          if (response?.success) setSession(response.data as RecordingSession);
        }).catch(() => {});
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  // ─── Poll session state while recording ──────────────────────────────────
  useEffect(() => {
    if (view !== 'recording') return;
    const interval = setInterval(() => {
      const msg: ChromeMessage = { type: 'GET_STATE' };
      chrome.runtime.sendMessage(msg).then((response) => {
        if (response?.success && response.data) {
          setSession(response.data as RecordingSession);
        }
      }).catch(() => {});
    }, 1000);
    return () => clearInterval(interval);
  }, [view]);

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const handleStart = useCallback(async (flowName: string) => {
    try {
      const msg: ChromeMessage = {
        type: 'START_RECORDING',
        payload: { flowName },
      };
      const response = await chrome.runtime.sendMessage(msg);
      if (response?.success) {
        const stateMsg: ChromeMessage = { type: 'GET_STATE' };
        const stateRes = await chrome.runtime.sendMessage(stateMsg);
        if (stateRes?.success) setSession(stateRes.data as RecordingSession);
        setView('recording');
      } else {
        setErrorMessage(response?.error ?? 'Failed to start recording.');
        setView('error');
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Cannot reach SynthMon backend. Check your URL in Settings.'
      );
      setView('error');
    }
  }, []);

  /**
   * Core save action — sends the flow to the backend with the provided credential mappings.
   * This is the single place where SAVE_RECORDING is dispatched.
   */
  const doSave = useCallback(async (credentialMappings: CredentialMapping[]) => {
    setView('saving');
    try {
      const msg: ChromeMessage = {
        type: 'SAVE_RECORDING',
        payload: { flowName: session?.flowName ?? '', credentialMappings },
      };
      const response = await chrome.runtime.sendMessage(msg);
      if (response?.success) {
        setSavedFlowId((response.data as { flowId: string })?.flowId ?? null);
        setView('saved');
        setTimeout(() => {
          setSession(null);
          setView('idle');
        }, 2000);
      } else {
        setErrorMessage(response?.error ?? 'Failed to save recording.');
        setView('error');
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Save failed.');
      setView('error');
    }
  }, [session]);

  /**
   * Called by the "Save Flow" button in RecordingView.
   * If credentials were detected but not yet handled, show the credential dialog first
   * so they are not silently dropped (key fix for "Value is required for fill action").
   */
  const handleSave = useCallback(() => {
    if (session?.pendingCredentials && session.pendingCredentials.length > 0) {
      setView('credential_dialog');
      return;
    }
    doSave([]);
  }, [session, doSave]);

  const handleCancel = useCallback(async () => {
    try {
      const msg: ChromeMessage = { type: 'CANCEL_RECORDING' };
      await chrome.runtime.sendMessage(msg);
    } catch {
      // Best effort
    }
    setSession(null);
    setView('idle');
  }, []);

  /** Called by CredentialDialog "Save & Encrypt" — saves with credential mappings. */
  const handleCredentialSave = useCallback(
    async (mappings: CredentialMapping[]) => {
      await doSave(mappings);
    },
    [doSave]
  );

  /** Called by CredentialDialog "Skip" — saves immediately without credential mappings. */
  const handleCredentialSkip = useCallback(() => {
    doSave([]);
  }, [doSave]);

  // ─── Render ───────────────────────────────────────────────────────────────

  if (view === 'idle') {
    return <IdleView onStart={handleStart} />;
  }

  if (view === 'recording' && session) {
    // Exclude metadata-only steps (page_load_observed, user_wait_observed) so the
    // displayed step count matches what will actually be saved as Playwright actions.
    const METADATA_ACTIONS = new Set<string>(['page_load_observed', 'user_wait_observed']);
    const executableSteps = (session.steps as RecordedStep[]).filter(
      (s) => !METADATA_ACTIONS.has(s.action)
    );
    return (
      <RecordingView
        flowName={session.flowName}
        steps={executableSteps}
        startedAt={session.startedAt}
        onSave={handleSave}
        onCancel={handleCancel}
      />
    );
  }

  if (view === 'credential_dialog' && session) {
    return (
      <CredentialDialog
        pendingCredentials={session.pendingCredentials as PendingCredential[]}
        onSave={handleCredentialSave}
        onSkip={handleCredentialSkip}
      />
    );
  }

  if (view === 'saving') {
    return (
      <div className="flex flex-col items-center justify-center p-8 gap-3">
        <div className="w-8 h-8 border-4 border-synthmon-navy border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-gray-600">Saving flow…</p>
      </div>
    );
  }

  if (view === 'saved') {
    return (
      <div className="flex flex-col items-center justify-center p-8 gap-3">
        <div className="text-3xl">✓</div>
        <p className="text-sm font-semibold text-green-600">Flow saved!</p>
        {savedFlowId && (
          <p className="text-xs text-gray-400">ID: {savedFlowId}</p>
        )}
      </div>
    );
  }

  if (view === 'error') {
    return (
      <div className="flex flex-col p-4 gap-3">
        <div className="text-red-600 font-semibold text-sm">Error</div>
        <p className="text-xs text-gray-600">
          {errorMessage ?? 'Something went wrong.'}
        </p>
        <button
          className="bg-synthmon-navy text-white py-2 px-4 rounded text-sm font-semibold hover:bg-synthmon-accent transition-colors"
          onClick={() => {
            setErrorMessage(null);
            setView('idle');
          }}
        >
          Back to Home
        </button>
      </div>
    );
  }

  // Fallback
  return <IdleView onStart={handleStart} />;
}
