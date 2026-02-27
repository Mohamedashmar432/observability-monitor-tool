Build a complete Chrome Extension (Manifest V3) from scratch called 
"SynthMon Recorder". This extension records browser interactions and 
sends them to a backend API. Do not use any external extension frameworks.

Tech stack for the extension:
- TypeScript
- Webpack 5 (for bundling)
- React 18 (for popup UI only)
- Tailwind CSS (for popup styling)
- Manifest V3

=============================================================
FOLDER STRUCTURE TO CREATE:
=============================================================

synthmon-extension/
├── src/
│   ├── background/
│   │   └── index.ts          ← service worker
│   ├── content/
│   │   ├── index.ts          ← injected into target pages
│   │   ├── overlay.ts        ← recording overlay bar on target page
│   │   └── selector.ts       ← smart CSS selector generator
│   ├── popup/
│   │   ├── index.tsx         ← React popup entry
│   │   ├── App.tsx           ← main popup component
│   │   ├── components/
│   │   │   ├── RecordingView.tsx
│   │   │   ├── IdleView.tsx
│   │   │   └── CredentialDialog.tsx
│   │   └── index.html
│   ├── options/
│   │   ├── index.tsx         ← settings page
│   │   └── index.html
│   └── types/
│       └── index.ts          ← shared TypeScript types
├── public/
│   └── icons/
│       ├── icon16.png
│       ├── icon32.png
│       ├── icon48.png
│       └── icon128.png       ← use simple colored squares as placeholders
├── manifest.json
├── webpack.config.js
├── tsconfig.json
├── tailwind.config.js
├── postcss.config.js
└── package.json

=============================================================
PART 1: MANIFEST.JSON
=============================================================

{
  "manifest_version": 3,
  "name": "SynthMon Recorder",
  "version": "1.0.0",
  "description": "Record browser flows for SynthMon synthetic monitoring",
  "permissions": [
    "activeTab",
    "scripting", 
    "storage",
    "tabs",
    "contextMenus"
  ],
  "host_permissions": ["<all_urls>"],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "32": "icons/icon32.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "options_page": "options.html",
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ],
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}

=============================================================
PART 2: src/types/index.ts
=============================================================

Build these TypeScript types:

// Recording states
type RecordingStatus = 'idle' | 'recording' | 'saving' | 'saved' | 'error'

// A single recorded step
interface RecordedStep {
  action: 'click' | 'fill' | 'goto' | 'hover' | 'select' | 'press' | 'scroll'
  selector: string
  value: string | null
  url: string | null
  key: string | null           // for press actions
  timestamp: number
  isCredential: boolean
  credentialHint: 'username' | 'password' | 'api_key' | null
  fieldName: string | null     // element name/id/placeholder
}

// A pending credential detected during recording
interface PendingCredential {
  stepIndex: number            // which step in the recording
  selector: string
  credentialHint: 'username' | 'password' | 'api_key'
  fieldName: string
  formSelector: string | null
  pairedWith: number | null    // stepIndex of the matching username/password
}

// State stored in background service worker
interface RecordingSession {
  sessionId: string | null
  status: RecordingStatus
  flowName: string
  steps: RecordedStep[]
  pendingCredentials: PendingCredential[]
  startedAt: number | null
  tabId: number | null
}

// Chrome message types
type MessageType =
  | 'START_RECORDING'
  | 'STOP_RECORDING'  
  | 'SAVE_RECORDING'
  | 'CANCEL_RECORDING'
  | 'RECORD_STEP'
  | 'CREDENTIAL_DETECTED'
  | 'GET_STATE'
  | 'PING_BACKEND'
  | 'OPEN_CREDENTIAL_DIALOG'

interface ChromeMessage {
  type: MessageType
  payload?: any
}

// API request/response types matching the SynthMon backend
interface StartSessionResponse {
  sessionId: string
}

interface SaveFlowResponse {
  flowId: string
  name: string
  stepCount: number
}

interface CredentialMapping {
  stepSelector: string
  credentialId: string
  credentialField: 'usernameValue' | 'passwordValue' | 'value'
}

interface BackendSettings {
  backendUrl: string
  apiKey: string | null
}

=============================================================
PART 3: src/content/selector.ts
=============================================================

Build a getBestSelector(element: Element): string function that tries 
selectors in this EXACT priority order:

1. data-testid attribute → [data-testid="value"]
2. data-cy attribute → [data-cy="value"]  
3. data-qa attribute → [data-qa="value"]
4. Unique id (verify it's unique with document.querySelectorAll) → #id
5. aria-label attribute → [aria-label="value"]
6. name attribute (for inputs) → [name="value"]
7. Role + text combo for buttons → role=button with text content
8. Text content for buttons/links (if < 30 chars and unique) → 
   use format: text content as fallback
9. Type + placeholder for inputs → input[placeholder="value"]
10. Full CSS path as last resort (generate shortest unique path)

For step 10, generate CSS path like this:
- Walk up the DOM from element to body
- At each level, check if tag alone is unique → use tag
- If not, try tag + nth-of-type
- Stop as soon as the selector becomes unique
- Maximum 4 levels deep

Also export:
- isUniqueSelector(selector: string): boolean
  (checks document.querySelectorAll(selector).length === 1)
- isSensitiveField(element: HTMLInputElement): boolean
  (returns true if type=password OR name/id/placeholder matches 
   /password|passwd|pwd|secret|token|api.?key|auth/i)
- isInLoginForm(element: HTMLInputElement): boolean
  (returns true if element's closest form contains input[type=password])

=============================================================
PART 4: src/content/index.ts
=============================================================

This is the content script injected into every page.

On load:
- Listen for messages from background: 
  'RECORDING_STARTED' → set isRecording = true, inject overlay
  'RECORDING_STOPPED' → set isRecording = false, remove overlay
  'INJECT_OVERLAY' → inject overlay

- Inject a marker so the SynthMon dashboard can detect the extension:
  document.documentElement.setAttribute('data-synthmon-extension', '1.0.0')
  window.dispatchEvent(new CustomEvent('synthmon-extension-ready', { 
    detail: { version: '1.0.0' } 
  }))

Event listeners (only active when isRecording = true):

1. CLICK events (capture phase, useCapture: true):
   - Ignore clicks on the SynthMon overlay itself
   - Get selector via getBestSelector
   - Send RECORD_STEP message with action: 'click'

2. INPUT/CHANGE events (capture phase):
   - If isSensitiveField(element):
     Send CREDENTIAL_DETECTED message with field info
     DO NOT capture the value
   - Else if isInLoginForm(element) and not password:
     Send CREDENTIAL_DETECTED with credentialHint: 'username'
     DO NOT capture the value  
   - Else:
     Send RECORD_STEP with action: 'fill', value: element.value
   - Debounce 600ms to avoid character-by-character capture

3. NAVIGATION (popstate + pushstate intercept):
   - Send RECORD_STEP with action: 'goto', url: window.location.href

4. SELECT change events:
   - Send RECORD_STEP with action: 'select', value: selected option value

5. KEYDOWN for Enter/Tab/Escape:
   - Only on focused input elements
   - Send RECORD_STEP with action: 'press', key: event.key

Smart grouping: 
- For fill events, cancel the previous pending fill on the same 
  selector before sending the new one (debounce pattern)
- This prevents 10 steps for typing "hello world"

=============================================================
PART 5: src/content/overlay.ts
=============================================================

Inject a recording overlay bar at the BOTTOM of the target page.

The overlay is a fixed-position div injected into document.body:
- Position: fixed, bottom: 0, left: 0, right: 0, z-index: 2147483647
- Height: 48px
- Background: #1a1a2e (dark navy)
- Shows: red pulsing dot + "SynthMon Recording" + step count badge
- A "Stop" button on the right (sends STOP_RECORDING to background)
- DO NOT use React for this — pure DOM manipulation only
  (React is not available in content scripts)
- Use a Shadow DOM so the overlay styles don't affect the target page:
  const shadow = overlayDiv.attachShadow({ mode: 'open' })

Export:
- injectOverlay(onStop: () => void): void
- updateOverlay(stepCount: number): void  
- removeOverlay(): void

=============================================================
PART 6: src/background/index.ts
=============================================================

This is the Manifest V3 service worker.

State (in-memory, resets when service worker sleeps):
Use a RecordingSession object as the main state variable.
Also persist critical state to chrome.storage.session 
(survives service worker restarts within the same browser session).

Functions to build:

1. getSettings(): Promise<BackendSettings>
   - Read backendUrl and apiKey from chrome.storage.sync
   - Default backendUrl: 'http://localhost:5000'

2. apiCall(path, method, body): Promise<any>
   - Fetch from backendUrl + path
   - Add Content-Type: application/json header
   - Add x-synthmon-extension-version: '1.0.0' header
   - If apiKey is set, add Authorization: Bearer apiKey header
   - Throw with clear error message on non-200 responses

3. handleStartRecording(flowName, tabId):
   - Call POST /api/flows/record/start with { name: flowName }
   - Get back sessionId
   - Set session state to recording
   - Send 'RECORDING_STARTED' message to the active tab
   - Update extension icon badge to red "REC"
   - Persist state to chrome.storage.session

4. handleRecordStep(step: RecordedStep):
   - Add step to session.steps array
   - Call POST /api/flows/record/action with:
     { sessionId, ...step }
   - Update overlay step count in the tab
   - If API call fails, queue the step and retry once

5. handleCredentialDetected(field: PendingCredential):
   - Add to session.pendingCredentials
   - Record a placeholder step:
     POST /api/flows/record/action with value: '{{credential:PENDING}}'
   - Send message to popup: OPEN_CREDENTIAL_DIALOG

6. handleSaveRecording(flowName, credentialMappings):
   - Call POST /api/flows/record/save with:
     { sessionId, name: flowName, credentialMappings }
   - Get back flowId
   - Reset session state
   - Update icon badge to green checkmark briefly
   - Return { flowId, name }

7. handleCancelRecording():
   - Call POST /api/flows/record/cancel with { sessionId }
   - Reset session state
   - Send 'RECORDING_STOPPED' to active tab

8. Message listener (chrome.runtime.onMessage):
   Switch on message.type and call the appropriate handler above.
   Always respond with { success: true, data: ... } or 
   { success: false, error: '...' }
   
   Use sendResponse pattern AND return true for async handlers.

9. On extension install/startup:
   - Restore session state from chrome.storage.session
   - If a session was recording, mark it as interrupted

=============================================================
PART 7: src/popup/App.tsx
=============================================================

React popup application. Width: 320px. Use Tailwind classes.

States:
- idle: show IdleView
- recording: show RecordingView  
- credential_dialog: show CredentialDialog
- saving: show spinner
- saved: show success for 2s then reset to idle
- error: show error message with retry button

Components:

IdleView.tsx:
- SynthMon logo text at top (just styled text, no image needed)
- Green dot if backend is reachable, red dot if not
  (ping GET /api/extension/ping on mount, show result)
- Input field: "Flow Name" (placeholder: "e.g. User Login Flow")
- Big red "Start Recording" button
- Small link: "⚙ Settings" → opens chrome.runtime.openOptionsPage()
- Small text showing the current backend URL (from settings)

RecordingView.tsx:
- Pulsing red circle + "Recording..." text
- Flow name displayed
- Step counter: "14 steps recorded" (updates in real-time)
- Live list of last 5 steps (action + selector, truncated to 35 chars)
  showing most recent at top
- "Save Flow" button (green, prominent)
- "Cancel" button (grey, smaller)
- Timer showing how long recording has been active

CredentialDialog.tsx:
- Shown when credentials are detected during recording
- Title: "🔐 Credentials Detected"
- Subtitle: "These fields were detected. Enter values to store securely."
- For each pendingCredential pair (username + password grouped):
  - Label showing field name
  - Input field (text for username, password type for password)
  - autocomplete="off" and autocomplete="new-password"
- "Credential Name" input (e.g. "My App Login") 
- Dropdown: "Or use existing credential" 
  (fetches GET /api/credentials, shows name list)
- "Save & Encrypt" button → 
  POST /api/credentials, then continue to save flow
- "Skip" button → save flow without credentials
- IMPORTANT: Clear all input values immediately after POST completes

=============================================================
PART 8: src/options/index.tsx  
=============================================================

Settings page with:
- Backend URL input (default: http://localhost:5000)
  With a "Test Connection" button that calls GET /api/extension/ping
  Show green "Connected ✓" or red "Cannot reach server ✗"
- API Key input (optional, type=password, masked)
- Save button → chrome.storage.sync.set(...)
- Reset to defaults button
- Section: "About SynthMon Recorder v1.0.0"
- Link to SynthMon dashboard (opens backend URL in new tab)

=============================================================
PART 9: webpack.config.js
=============================================================

Build config for Chrome extension with these entry points:
- background: ./src/background/index.ts → background.js
- content: ./src/content/index.ts → content.js
- popup: ./src/popup/index.tsx → popup.js
- options: ./src/options/index.tsx → options.js

Output to dist/ folder.
Copy manifest.json and icons/ to dist/.
Copy popup/index.html and options/index.html to dist/.
Use HtmlWebpackPlugin for popup.html and options.html.
Use CopyWebpackPlugin for manifest.json and icons.
Configure TailwindCSS via postcss-loader for popup and options.
Source maps: inline for development, none for production.

Add npm scripts:
- "build": webpack --mode production
- "dev": webpack --mode development --watch
- "clean": rm -rf dist

=============================================================
PART 10: PLACEHOLDER ICONS
=============================================================

Create simple PNG placeholder icons using a canvas script or 
just create colored square PNG files programmatically.
The icons should be a dark navy square (#1a1a2e) with 
a white "S" letter centered.
Create all 4 sizes: 16x16, 32x32, 48x48, 128x128.
Use the sharp npm package or write a small Node script 
(scripts/generate-icons.js) to generate them.

=============================================================
FINAL REQUIREMENTS:
=============================================================

1. yarn build should produce a working dist/ folder with no errors
2. TypeScript strict mode — no 'any' types except where absolutely 
   necessary with a comment explaining why
3. Every function that touches credentials must have a comment:
   // SECURITY: [explanation]
4. The content script must work on ALL pages including 
   React/Angular/Vue SPAs
5. Handle the case where the background service worker was killed 
   by Chrome (restore state from chrome.storage.session)
6. All API calls must have try/catch with user-friendly error messages
7. The popup must show a clear error if backend is unreachable with 
   the message: "Cannot reach SynthMon backend. Check your URL in Settings."
8. Debounce fill events at 600ms to prevent character-by-character recording
9. Never use eval() or innerHTML with user data (CSP compliance)
10. The overlay must not break the layout of ANY website it's injected into
    (use Shadow DOM, fixed positioning, high z-index)

Build the complete project now. Create every file. 
After creating all files run: yarn build
Fix any TypeScript or webpack errors until the build succeeds.
At the end, show me the exact steps to load the extension in Chrome.