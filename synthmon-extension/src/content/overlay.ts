/**
 * Recording overlay bar injected at the bottom of the target page.
 * Uses Shadow DOM to isolate styles and prevent layout interference.
 * Pure DOM manipulation — no React, no external libs.
 */

let overlayHost: HTMLDivElement | null = null;
let stepCountEl: HTMLSpanElement | null = null;

const OVERLAY_STYLES = `
  :host {
    all: initial;
  }
  .bar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: 48px;
    background: #1a1a2e;
    z-index: 2147483647;
    display: flex;
    align-items: center;
    padding: 0 16px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 13px;
    color: #ffffff;
    box-sizing: border-box;
    gap: 10px;
    box-shadow: 0 -2px 8px rgba(0,0,0,0.4);
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #e94560;
    flex-shrink: 0;
    animation: pulse 1.4s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.5; transform: scale(0.85); }
  }
  .label {
    font-weight: 600;
    letter-spacing: 0.02em;
    color: #e94560;
  }
  .badge {
    background: #0f3460;
    color: #ffffff;
    border-radius: 12px;
    padding: 2px 10px;
    font-size: 12px;
    font-weight: 600;
  }
  .spacer {
    flex: 1;
  }
  .stop-btn {
    background: #e94560;
    color: #ffffff;
    border: none;
    border-radius: 6px;
    padding: 6px 16px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    outline: none;
    transition: background 0.15s;
  }
  .stop-btn:hover {
    background: #c73652;
  }
  .stop-btn:focus-visible {
    box-shadow: 0 0 0 2px #ffffff;
  }
`;

export function injectOverlay(onStop: () => void): void {
  if (overlayHost) return; // already injected

  overlayHost = document.createElement('div');
  overlayHost.setAttribute('data-synthmon-overlay', 'true');
  // Use Shadow DOM to isolate styles from the target page
  const shadow = overlayHost.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = OVERLAY_STYLES;

  const bar = document.createElement('div');
  bar.className = 'bar';

  const dot = document.createElement('span');
  dot.className = 'dot';

  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = 'SynthMon Recording';

  stepCountEl = document.createElement('span');
  stepCountEl.className = 'badge';
  stepCountEl.textContent = '0 steps';

  const spacer = document.createElement('span');
  spacer.className = 'spacer';

  const stopBtn = document.createElement('button');
  stopBtn.className = 'stop-btn';
  stopBtn.textContent = 'Stop';
  stopBtn.setAttribute('type', 'button');
  stopBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    onStop();
  });

  bar.appendChild(dot);
  bar.appendChild(label);
  bar.appendChild(stepCountEl);
  bar.appendChild(spacer);
  bar.appendChild(stopBtn);

  shadow.appendChild(style);
  shadow.appendChild(bar);

  document.body.appendChild(overlayHost);
}

export function updateOverlay(stepCount: number): void {
  if (stepCountEl) {
    stepCountEl.textContent = `${stepCount} step${stepCount !== 1 ? 's' : ''}`;
  }
}

export function removeOverlay(): void {
  if (overlayHost) {
    overlayHost.remove();
    overlayHost = null;
    stepCountEl = null;
  }
}
