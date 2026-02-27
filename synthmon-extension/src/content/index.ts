/**
 * Content script — injected into every page at document_idle.
 * Listens for recording commands from the background service worker
 * and sends recorded steps back.
 */

import { getBestSelector, isSensitiveField, isInLoginForm } from './selector';
import { injectOverlay, updateOverlay, removeOverlay } from './overlay';
import type { ChromeMessage, RecordedStep, PendingCredential } from '../types';

// Announce the extension to the host page so the SynthMon dashboard
// can detect it without needing special permissions.
document.documentElement.setAttribute('data-synthmon-extension', '1.0.0');
window.dispatchEvent(
  new CustomEvent('synthmon-extension-ready', { detail: { version: '1.0.0' } })
);

let isRecording = false;

// Tracks the timestamp of the last recorded user interaction for idle-gap detection
let lastInteractionTimestamp = 0;

// Debounce timers keyed by selector — prevents character-by-character capture
const fillDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

// ─── Helpers ────────────────────────────────────────────────────────────────

function sendToBackground(message: ChromeMessage): void {
  chrome.runtime.sendMessage(message).catch(() => {
    // Background service worker may have been killed; ignore silently
  });
}

function buildBaseStep(): Omit<RecordedStep, 'action' | 'selector'> {
  return {
    value: null,
    url: window.location.href,
    key: null,
    timestamp: Date.now(),
    isCredential: false,
    credentialHint: null,
    fieldName: null,
  };
}

function getFieldName(el: HTMLInputElement): string | null {
  return el.name || el.id || el.placeholder || null;
}

// ─── Observation Helpers ─────────────────────────────────────────────────────

/**
 * If the user has been idle for more than 1500ms since the last interaction,
 * emit a user_wait_observed step BEFORE the next action.
 * This gives the runner a hint that async operations may have run during the pause.
 */
function emitUserWaitIfLong(): void {
  if (!isRecording) return;
  const now = Date.now();
  if (lastInteractionTimestamp > 0 && now - lastInteractionTimestamp > 1500) {
    const waitMs = now - lastInteractionTimestamp;
    sendToBackground({
      type: 'RECORD_STEP',
      payload: {
        ...buildBaseStep(),
        action: 'user_wait_observed',
        selector: '',
        waitMs,
      } as RecordedStep,
    });
  }
  lastInteractionTimestamp = now;
}

/**
 * Capture page load metrics (resource count, navigation timing) and emit as a
 * page_load_observed step. Called after full-page or SPA navigations.
 */
function emitPageLoadObserved(): void {
  if (!isRecording) return;

  const resourceCount = performance.getEntriesByType('resource').length;

  // For full page loads, PerformanceNavigationTiming gives accurate load time
  const navEntries = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
  const navEntry = navEntries[0];
  const loadTimeMs = navEntry && navEntry.loadEventEnd > 0
    ? Math.round(navEntry.loadEventEnd - navEntry.startTime)
    : 0;

  sendToBackground({
    type: 'RECORD_STEP',
    payload: {
      ...buildBaseStep(),
      action: 'page_load_observed',
      selector: '',
      loadTimeMs,
      resourceCount,
    } as RecordedStep,
  });
}

// ─── Event Handlers ─────────────────────────────────────────────────────────

function handleClick(event: MouseEvent): void {
  if (!isRecording) return;

  const target = event.target as Element | null;
  if (!target) return;

  // Ignore clicks on the SynthMon overlay itself
  if ((target as HTMLElement).closest?.('[data-synthmon-overlay]')) return;
  if (target.getAttribute?.('data-synthmon-overlay') === 'true') return;

  emitUserWaitIfLong();

  const selector = getBestSelector(target);
  const step: RecordedStep = {
    ...buildBaseStep(),
    action: 'click',
    selector,
  };

  sendToBackground({ type: 'RECORD_STEP', payload: step });
}

function handleInput(event: Event): void {
  if (!isRecording) return;

  const target = event.target as HTMLInputElement | null;
  if (!target || !('value' in target)) return;

  const selector = getBestSelector(target);
  const fieldName = getFieldName(target);

  // Clear any pending debounce for this selector
  const existingTimer = fillDebounceTimers.get(selector);
  if (existingTimer !== undefined) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(() => {
    fillDebounceTimers.delete(selector);

    // SECURITY: Never capture values of password/secret fields
    if (isSensitiveField(target)) {
      const credential: PendingCredential = {
        stepIndex: -1, // background assigns actual index
        selector,
        credentialHint: 'password',
        fieldName: fieldName ?? selector,
        formSelector: target.closest('form')
          ? getBestSelector(target.closest('form') as Element)
          : null,
        pairedWith: null,
        siteUrl: window.location.href,
      };
      sendToBackground({ type: 'CREDENTIAL_DETECTED', payload: credential });
      return;
    }

    // SECURITY: Treat text fields inside login forms as usernames
    if (isInLoginForm(target) && target.type !== 'password') {
      const credential: PendingCredential = {
        stepIndex: -1,
        selector,
        credentialHint: 'username',
        fieldName: fieldName ?? selector,
        formSelector: target.closest('form')
          ? getBestSelector(target.closest('form') as Element)
          : null,
        pairedWith: null,
        siteUrl: window.location.href,
      };
      sendToBackground({ type: 'CREDENTIAL_DETECTED', payload: credential });
      return;
    }

    // Normal fill — capture value
    const step: RecordedStep = {
      ...buildBaseStep(),
      action: 'fill',
      selector,
      value: target.value,
      fieldName,
    };
    sendToBackground({ type: 'RECORD_STEP', payload: step });
  }, 600);

  fillDebounceTimers.set(selector, timer);
}

// FIX: Separate handler for <select> elements vs browser autocomplete on <input>.
// Previously ALL change events were captured as 'select' steps — this caused
// browser autofill to store plaintext passwords as select steps, bypassing
// all credential detection.
function handleChange(event: Event): void {
  if (!isRecording) return;

  const target = event.target as HTMLElement | null;
  if (!target) return;

  // ── Input element: browser autocomplete fired a change event ────────────
  // Route through the same credential detection as handleInput.
  if (target instanceof HTMLInputElement) {
    const inputEl = target;
    const selector = getBestSelector(inputEl);
    const fieldName = getFieldName(inputEl);

    // Cancel any pending debounce so we don't double-fire
    const existingTimer = fillDebounceTimers.get(selector);
    if (existingTimer !== undefined) {
      clearTimeout(existingTimer);
      fillDebounceTimers.delete(selector);
    }

    // SECURITY: Autocomplete on a password/sensitive field → credential
    if (isSensitiveField(inputEl)) {
      const credential: PendingCredential = {
        stepIndex: -1,
        selector,
        credentialHint: 'password',
        fieldName: fieldName ?? selector,
        formSelector: inputEl.closest('form')
          ? getBestSelector(inputEl.closest('form') as Element)
          : null,
        pairedWith: null,
        siteUrl: window.location.href,
      };
      sendToBackground({ type: 'CREDENTIAL_DETECTED', payload: credential });
      return;
    }

    // SECURITY: Autocomplete on a username field in a login form → credential
    if (isInLoginForm(inputEl) && inputEl.type !== 'password') {
      const credential: PendingCredential = {
        stepIndex: -1,
        selector,
        credentialHint: 'username',
        fieldName: fieldName ?? selector,
        formSelector: inputEl.closest('form')
          ? getBestSelector(inputEl.closest('form') as Element)
          : null,
        pairedWith: null,
        siteUrl: window.location.href,
      };
      sendToBackground({ type: 'CREDENTIAL_DETECTED', payload: credential });
      return;
    }

    // Regular input autocomplete (non-credential) — record as fill
    const step: RecordedStep = {
      ...buildBaseStep(),
      action: 'fill',
      selector,
      value: inputEl.value,
      fieldName,
    };
    sendToBackground({ type: 'RECORD_STEP', payload: step });
    return;
  }

  // ── Actual <select> dropdown element ──────────────────────────────────────
  if (target instanceof HTMLSelectElement) {
    const selector = getBestSelector(target);
    const step: RecordedStep = {
      ...buildBaseStep(),
      action: 'select',
      selector,
      value: target.value,
    };
    sendToBackground({ type: 'RECORD_STEP', payload: step });
  }
}

function handleKeydown(event: KeyboardEvent): void {
  if (!isRecording) return;

  const target = event.target as HTMLInputElement | null;
  if (!target || !('value' in target)) return;

  const trackedKeys = ['Enter', 'Tab', 'Escape'];
  if (!trackedKeys.includes(event.key)) return;

  const selector = getBestSelector(target);
  const step: RecordedStep = {
    ...buildBaseStep(),
    action: 'press',
    selector,
    key: event.key,
  };

  sendToBackground({ type: 'RECORD_STEP', payload: step });
}

// ─── Navigation Tracking ────────────────────────────────────────────────────

// Intercept history.pushState to detect SPA navigations
const originalPushState = history.pushState.bind(history);
history.pushState = function (...args) {
  originalPushState(...args);
  if (isRecording) {
    const step: RecordedStep = {
      ...buildBaseStep(),
      action: 'goto',
      selector: '',
      url: window.location.href,
    };
    sendToBackground({ type: 'RECORD_STEP', payload: step });
    // Capture page load metrics after a short settle period
    setTimeout(emitPageLoadObserved, 800);
    lastInteractionTimestamp = Date.now();
  }
};

window.addEventListener('popstate', () => {
  if (!isRecording) return;
  const step: RecordedStep = {
    ...buildBaseStep(),
    action: 'goto',
    selector: '',
    url: window.location.href,
  };
  sendToBackground({ type: 'RECORD_STEP', payload: step });
  // Capture page load metrics after a short settle period
  setTimeout(emitPageLoadObserved, 800);
  lastInteractionTimestamp = Date.now();
});

// ─── Attach / Detach Listeners ───────────────────────────────────────────────

function startListening(): void {
  document.addEventListener('click', handleClick, true);
  document.addEventListener('input', handleInput, true);
  document.addEventListener('change', handleChange, true);
  document.addEventListener('keydown', handleKeydown, true);
}

function stopListening(): void {
  document.removeEventListener('click', handleClick, true);
  document.removeEventListener('input', handleInput, true);
  document.removeEventListener('change', handleChange, true);
  document.removeEventListener('keydown', handleKeydown, true);
  // Clear any pending debounce timers
  fillDebounceTimers.forEach((timer) => clearTimeout(timer));
  fillDebounceTimers.clear();
}

// ─── Message Listener ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: ChromeMessage, _sender, sendResponse) => {
    switch (message.type) {
      case 'RECORDING_STARTED':
        isRecording = true;
        startListening();
        injectOverlay(() => {
          sendToBackground({ type: 'STOP_RECORDING' });
        });
        sendResponse({ success: true });
        break;

      case 'RECORDING_STOPPED':
        isRecording = false;
        stopListening();
        removeOverlay();
        sendResponse({ success: true });
        break;

      case 'INJECT_OVERLAY':
        injectOverlay(() => {
          sendToBackground({ type: 'STOP_RECORDING' });
        });
        sendResponse({ success: true });
        break;

      case 'UPDATE_STEP_COUNT':
        updateOverlay((message.payload as number) ?? 0);
        sendResponse({ success: true });
        break;

      default:
        break;
    }
  }
);

// ─── Initialization: Resume recording if already active ──────────────────────
// FIX: After a page navigation (e.g. post-login), the content script restarts
// from scratch with isRecording = false. Proactively query the background to
// check if a recording session is in progress and resume it immediately.
// This runs before tabs.onUpdated fires (which is a backup re-injection).

chrome.runtime.sendMessage({ type: 'GET_STATE' })
  .then((response: { success: boolean; data?: { status: string; steps?: unknown[] } }) => {
    if (response?.success && response?.data?.status === 'recording') {
      isRecording = true;
      startListening();
      injectOverlay(() => {
        sendToBackground({ type: 'STOP_RECORDING' });
      });
      updateOverlay(response.data.steps?.length ?? 0);
    }
  })
  .catch(() => {
    // Background not ready or no session; nothing to do
  });
