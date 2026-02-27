/**
 * Background service worker — Manifest V3.
 * Manages recording session state, API communication, and
 * message routing between popup, content scripts, and backend.
 */

import type {
  BackendSettings,
  ChromeMessage,
  CredentialMapping,
  PendingCredential,
  RecordedStep,
  RecordingSession,
  StartSessionResponse,
  SaveFlowResponse,
} from '../types';

// ─── Initial State ───────────────────────────────────────────────────────────

function makeEmptySession(): RecordingSession {
  return {
    sessionId: null,
    status: 'idle',
    flowName: '',
    steps: [],
    pendingCredentials: [],
    failedSteps: [],
    startedAt: null,
    tabId: null,
  };
}

let session: RecordingSession = makeEmptySession();

// ─── Settings ────────────────────────────────────────────────────────────────

async function getSettings(): Promise<BackendSettings> {
  const result = await chrome.storage.sync.get(['backendUrl', 'apiKey']);
  return {
    backendUrl: (result['backendUrl'] as string | undefined) ?? 'http://localhost:5000',
    apiKey: (result['apiKey'] as string | undefined) ?? null,
  };
}

// ─── API Helper ──────────────────────────────────────────────────────────────

async function apiCall(
  path: string,
  method: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body?: Record<string, any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const settings = await getSettings();
  const url = `${settings.backendUrl}${path}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-synthmon-extension-version': '1.0.0',
  };

  // SECURITY: API key sent as Bearer token; never logged or stored in steps
  if (settings.apiKey) {
    headers['Authorization'] = `Bearer ${settings.apiKey}`;
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`API error ${response.status}: ${text}`);
  }

  return response.json();
}

// ─── State Persistence ───────────────────────────────────────────────────────

async function persistSession(): Promise<void> {
  await chrome.storage.session.set({ recordingSession: session });
}

async function restoreSession(): Promise<void> {
  const result = await chrome.storage.session.get('recordingSession');
  const stored = result['recordingSession'] as RecordingSession | undefined;
  if (stored) {
    session = stored;
    // If the service worker was killed mid-recording, mark as interrupted
    if (session.status === 'recording') {
      session.status = 'error';
      await persistSession();
    }
  }
}

// ─── Badge Helpers ───────────────────────────────────────────────────────────

function setBadgeRecording(): void {
  chrome.action.setBadgeText({ text: 'REC' });
  chrome.action.setBadgeBackgroundColor({ color: '#e94560' });
}

function setBadgeSaved(): void {
  chrome.action.setBadgeText({ text: '✓' });
  chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });
  setTimeout(() => {
    chrome.action.setBadgeText({ text: '' });
  }, 3000);
}

function clearBadge(): void {
  chrome.action.setBadgeText({ text: '' });
}

// ─── Message Sender to Tab ────────────────────────────────────────────────────

async function sendToTab(tabId: number, message: ChromeMessage): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    // Tab may be closed or navigated away; ignore
  }
}

// ─── Handlers ────────────────────────────────────────────────────────────────

async function handleStartRecording(
  flowName: string,
  tabId: number
): Promise<{ sessionId: string }> {
  const data: StartSessionResponse = await apiCall(
    '/api/flows/record/start',
    'POST',
    { name: flowName }
  );

  session = {
    sessionId: data.sessionId,
    status: 'recording',
    flowName,
    steps: [],
    pendingCredentials: [],
    failedSteps: [],
    startedAt: Date.now(),
    tabId,
  };

  await persistSession();

  // FIX: Record the initial page URL as the very first step (goto).
  // Without this the Playwright runner starts from about:blank and immediately
  // fails to find any elements.
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
      const gotoStep: RecordedStep = {
        action: 'goto',
        selector: '',
        value: null,
        url: tab.url,
        key: null,
        timestamp: Date.now(),
        isCredential: false,
        credentialHint: null,
        fieldName: null,
      };
      await handleRecordStep(gotoStep);
    }
  } catch {
    // Non-fatal: tab might not be accessible
  }

  setBadgeRecording();
  await sendToTab(tabId, { type: 'RECORDING_STARTED' });

  return { sessionId: data.sessionId };
}

async function handleRecordStep(step: RecordedStep): Promise<void> {
  step.timestamp = Date.now();
  session.steps.push(step);

  const postStep = async () => {
    const data = await apiCall('/api/flows/record/action', 'POST', {
      sessionId: session.sessionId,
      ...step,
    });
    // Verify the server's step count matches our local count
    if (data && typeof data.totalSteps === 'number' && data.totalSteps !== session.steps.length) {
      console.warn(
        `[Background] Step count mismatch — local: ${session.steps.length}, server: ${data.totalSteps}`
      );
    }
    return data;
  };

  try {
    await postStep();
  } catch {
    // Retry once after 500ms before marking the step as failed
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      await postStep();
    } catch {
      // Step was lost — track it for re-sync on save
      console.warn(
        `[Background] Step lost after retry: ${step.action} ${step.selector || step.url || ''}`
      );
      if (!session.failedSteps) session.failedSteps = [];
      session.failedSteps.push(step);
    }
  }

  await persistSession();

  // Update the overlay with ONLY executable step count — metadata steps
  // (page_load_observed, user_wait_observed) are skipped on save so we
  // must not count them here, otherwise the user sees a higher number than
  // the steps that will actually be in the saved flow.
  if (session.tabId !== null) {
    const executableCount = session.steps.filter(
      (s) => s.action !== 'page_load_observed' && s.action !== 'user_wait_observed'
    ).length;
    await sendToTab(session.tabId, {
      type: 'UPDATE_STEP_COUNT',
      payload: executableCount,
    });
  }
}

async function handleCredentialDetected(
  field: PendingCredential
): Promise<void> {
  // Deduplicate: both handleInput (debounced) and handleChange fire CREDENTIAL_DETECTED
  // for the same field, which would produce duplicate entries in the dialog.
  const alreadyTracked = session.pendingCredentials.some(
    (c) => c.selector === field.selector
  );
  if (alreadyTracked) {
    console.log(
      `[Background] Duplicate CREDENTIAL_DETECTED for "${field.selector}" — skipping`
    );
    return;
  }

  // SECURITY: Assign the actual step index so credentials map correctly
  field.stepIndex = session.steps.length;

  // FIX: Capture the site URL for friendly credential naming in the dialog
  if (!field.siteUrl && session.tabId !== null) {
    try {
      const tab = await chrome.tabs.get(session.tabId);
      field.siteUrl = tab.url ?? null;
    } catch {
      field.siteUrl = null;
    }
  }

  // Attempt to pair with an existing pending credential of the opposite type
  const opposite = field.credentialHint === 'password' ? 'username' : 'password';
  const pair = session.pendingCredentials.find(
    (c) => c.credentialHint === opposite && c.pairedWith === null
  );
  if (pair) {
    pair.pairedWith = field.stepIndex;
    field.pairedWith = pair.stepIndex;
  }

  session.pendingCredentials.push(field);

  // SECURITY: Record placeholder in backend — actual value is never sent
  const placeholderStep: RecordedStep = {
    action: 'fill',
    selector: field.selector,
    value: '{{credential:PENDING}}',
    url: null,
    key: null,
    timestamp: Date.now(),
    isCredential: true,
    credentialHint: field.credentialHint,
    fieldName: field.fieldName,
  };
  session.steps.push(placeholderStep);

  try {
    await apiCall('/api/flows/record/action', 'POST', {
      sessionId: session.sessionId,
      ...placeholderStep,
    });
  } catch {
    // Non-fatal; the placeholder step is already in local session
  }

  await persistSession();

  // Notify popup to open the credential dialog
  chrome.runtime.sendMessage({ type: 'OPEN_CREDENTIAL_DIALOG' }).catch(() => {
    // Popup may be closed; ignore
  });
}

async function handleSaveRecording(
  flowName: string,
  credentialMappings: CredentialMapping[]
): Promise<SaveFlowResponse> {
  session.status = 'saving';
  await persistSession();

  // Re-sync any steps that failed to reach the backend during recording
  if (session.failedSteps && session.failedSteps.length > 0) {
    console.warn(
      `[Background] Re-syncing ${session.failedSteps.length} failed step(s) before save...`
    );
    for (const failedStep of session.failedSteps) {
      try {
        await apiCall('/api/flows/record/action', 'POST', {
          sessionId: session.sessionId,
          ...failedStep,
        });
      } catch {
        console.warn(
          `[Background] Re-sync failed for step: ${failedStep.action} ${failedStep.selector || ''} — step may be missing from saved flow`
        );
      }
    }
    session.failedSteps = [];
  }

  const data: SaveFlowResponse = await apiCall(
    '/api/flows/record/save',
    'POST',
    {
      sessionId: session.sessionId,
      name: flowName,
      credentialMappings,
    }
  );

  session = makeEmptySession();
  await persistSession();
  clearBadge();
  setBadgeSaved();

  return data;
}

async function handleCancelRecording(): Promise<void> {
  if (session.sessionId) {
    try {
      await apiCall('/api/flows/record/cancel', 'POST', {
        sessionId: session.sessionId,
      });
    } catch {
      // Best effort cancel
    }
  }

  const tabId = session.tabId;
  session = makeEmptySession();
  await persistSession();
  clearBadge();

  if (tabId !== null) {
    await sendToTab(tabId, { type: 'RECORDING_STOPPED' });
  }
}

// ─── Message Router ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (
    message: ChromeMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: { success: boolean; data?: unknown; error?: string }) => void
  ) => {
    const handle = async () => {
      switch (message.type) {
        case 'START_RECORDING': {
          const { flowName } = message.payload as { flowName: string };
          // Use the sender tab or the active tab
          let tabId = sender.tab?.id;
          if (tabId === undefined) {
            const [activeTab] = await chrome.tabs.query({
              active: true,
              currentWindow: true,
            });
            tabId = activeTab?.id;
          }
          if (!tabId) throw new Error('No active tab found');
          const result = await handleStartRecording(flowName, tabId);
          return result;
        }

        case 'STOP_RECORDING': {
          await handleCancelRecording();
          return null;
        }

        case 'CANCEL_RECORDING': {
          await handleCancelRecording();
          return null;
        }

        case 'RECORD_STEP': {
          await handleRecordStep(message.payload as RecordedStep);
          return null;
        }

        case 'CREDENTIAL_DETECTED': {
          await handleCredentialDetected(message.payload as PendingCredential);
          return null;
        }

        case 'SAVE_RECORDING': {
          const { flowName, credentialMappings } = message.payload as {
            flowName: string;
            credentialMappings: CredentialMapping[];
          };
          const result = await handleSaveRecording(flowName, credentialMappings);
          return result;
        }

        case 'GET_STATE': {
          return session;
        }

        case 'PING_BACKEND': {
          const settings = await getSettings();
          const res = await fetch(
            `${settings.backendUrl}/api/extension/ping`,
            {
              headers: { 'x-synthmon-extension-version': '1.0.0' },
            }
          );
          return { ok: res.ok, status: res.status };
        }

        default:
          return null;
      }
    };

    handle()
      .then((data) => sendResponse({ success: true, data }))
      .catch((err: unknown) =>
        sendResponse({
          success: false,
          error: err instanceof Error ? err.message : String(err),
        })
      );

    return true; // keep message channel open for async response
  }
);

// ─── Tab Navigation Re-injection ─────────────────────────────────────────────
// FIX: When a page finishes loading in the recording tab (e.g. after login),
// re-inject the RECORDING_STARTED message so the new page's content script
// resumes recording. Also record the navigation as a goto step.

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (session.status !== 'recording') return;
  if (session.tabId !== tabId) return;
  if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) return;

  // Record this navigation as a goto step (avoid duplicate if last step was same URL)
  const lastStep = session.steps[session.steps.length - 1];
  const isDuplicate = lastStep && lastStep.action === 'goto' && lastStep.url === tab.url;
  if (!isDuplicate) {
    const gotoStep: RecordedStep = {
      action: 'goto',
      selector: '',
      value: null,
      url: tab.url,
      key: null,
      timestamp: Date.now(),
      isCredential: false,
      credentialHint: null,
      fieldName: null,
    };
    await handleRecordStep(gotoStep);
  }

  // Re-inject recording state into the new page's content script
  await sendToTab(tabId, { type: 'RECORDING_STARTED' });
  // Update the overlay with current step count
  await sendToTab(tabId, { type: 'UPDATE_STEP_COUNT', payload: session.steps.length });
});

// ─── Startup / Install ────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  restoreSession();
});

chrome.runtime.onStartup.addListener(() => {
  restoreSession();
});

// Restore on service worker init (handles Chrome killing the worker)
restoreSession();
