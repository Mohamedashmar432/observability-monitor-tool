// Recording states
export type RecordingStatus = 'idle' | 'recording' | 'saving' | 'saved' | 'error';

// A single recorded step
export interface RecordedStep {
  action:
    | 'click'
    | 'fill'
    | 'goto'
    | 'hover'
    | 'select'
    | 'press'
    | 'scroll'
    | 'page_load_observed'  // metadata: page timing (skipped by runner)
    | 'user_wait_observed'; // metadata: user idle gap (skipped by runner)
  selector: string;
  value: string | null;
  url: string | null;
  key: string | null; // for press actions
  timestamp: number;
  isCredential: boolean;
  credentialHint: 'username' | 'password' | 'api_key' | null;
  fieldName: string | null; // element name/id/placeholder
  // Observation-only metadata fields (only present on page_load_observed / user_wait_observed steps)
  loadTimeMs?: number;
  resourceCount?: number;
  waitMs?: number;
}

// A pending credential detected during recording
export interface PendingCredential {
  stepIndex: number; // which step in the recording
  selector: string;
  credentialHint: 'username' | 'password' | 'api_key';
  fieldName: string;
  formSelector: string | null;
  pairedWith: number | null; // stepIndex of the matching username/password
  siteUrl: string | null;   // page URL when credential was detected (for naming)
}

// State stored in background service worker
export interface RecordingSession {
  sessionId: string | null;
  status: RecordingStatus;
  flowName: string;
  steps: RecordedStep[];
  pendingCredentials: PendingCredential[];
  /** Steps that failed to sync with the backend during recording (for re-sync on save). */
  failedSteps: RecordedStep[];
  startedAt: number | null;
  tabId: number | null;
}

// Chrome message types
export type MessageType =
  | 'START_RECORDING'
  | 'STOP_RECORDING'
  | 'SAVE_RECORDING'
  | 'CANCEL_RECORDING'
  | 'RECORD_STEP'
  | 'CREDENTIAL_DETECTED'
  | 'GET_STATE'
  | 'PING_BACKEND'
  | 'OPEN_CREDENTIAL_DIALOG'
  | 'RECORDING_STARTED'
  | 'RECORDING_STOPPED'
  | 'UPDATE_STEP_COUNT'
  | 'INJECT_OVERLAY';

export interface ChromeMessage {
  type: MessageType;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any; // intentionally loose — messages cross the extension boundary
}

// API request/response types matching the SynthMon backend
export interface StartSessionResponse {
  sessionId: string;
}

export interface SaveFlowResponse {
  flowId: string;
  name: string;
  stepCount: number;
}

export interface CredentialMapping {
  stepSelector: string;
  credentialId: string;
  credentialField: 'usernameValue' | 'passwordValue' | 'value';
}

export interface BackendSettings {
  backendUrl: string;
  apiKey: string | null;
}

export interface BackendCredential {
  id: string;
  name: string;
}
