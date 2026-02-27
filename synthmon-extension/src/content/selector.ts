/**
 * Smart CSS selector generator.
 * Tries selectors in priority order to produce the most stable,
 * readable selector for a given element.
 */

export function isUniqueSelector(selector: string): boolean {
  try {
    return document.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
}

// SECURITY: Checks whether an input field likely holds a secret value.
// We never capture the value of sensitive fields — only record a placeholder.
export function isSensitiveField(element: HTMLInputElement): boolean {
  if (element.type === 'password') return true;
  const sensitivePattern = /password|passwd|pwd|secret|token|api.?key|auth/i;
  return (
    sensitivePattern.test(element.name ?? '') ||
    sensitivePattern.test(element.id ?? '') ||
    sensitivePattern.test(element.placeholder ?? '')
  );
}

// SECURITY: Detects whether a text input is inside a login form.
// Used to flag username fields so credentials are never stored in plain steps.
export function isInLoginForm(element: HTMLInputElement): boolean {
  const form = element.closest('form');
  if (!form) return false;
  return form.querySelector('input[type="password"]') !== null;
}

function escapeAttributeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function generateCSSPath(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;
  let depth = 0;
  const maxDepth = 4;

  while (current && current !== document.body && depth < maxDepth) {
    const tag = current.tagName.toLowerCase();

    // Try tag alone first
    const pathSoFar = [tag, ...parts].join(' > ');
    if (isUniqueSelector(pathSoFar)) {
      return pathSoFar;
    }

    // Try tag + nth-of-type
    const siblings = current.parentElement
      ? Array.from(current.parentElement.children).filter(
          (c) => c.tagName === current!.tagName
        )
      : [];
    const index = siblings.indexOf(current) + 1;
    const nthPart = siblings.length > 1 ? `${tag}:nth-of-type(${index})` : tag;
    parts.unshift(nthPart);

    const candidate = parts.join(' > ');
    if (isUniqueSelector(candidate)) {
      return candidate;
    }

    current = current.parentElement;
    depth++;
  }

  return parts.join(' > ') || element.tagName.toLowerCase();
}

export function getBestSelector(element: Element): string {
  // 1. data-testid
  const testId = element.getAttribute('data-testid');
  if (testId) {
    const sel = `[data-testid="${escapeAttributeValue(testId)}"]`;
    if (isUniqueSelector(sel)) return sel;
  }

  // 2. data-cy
  const dataCy = element.getAttribute('data-cy');
  if (dataCy) {
    const sel = `[data-cy="${escapeAttributeValue(dataCy)}"]`;
    if (isUniqueSelector(sel)) return sel;
  }

  // 3. data-qa
  const dataQa = element.getAttribute('data-qa');
  if (dataQa) {
    const sel = `[data-qa="${escapeAttributeValue(dataQa)}"]`;
    if (isUniqueSelector(sel)) return sel;
  }

  // 4. Unique id
  const id = element.id;
  if (id) {
    const sel = `#${CSS.escape(id)}`;
    if (isUniqueSelector(sel)) return sel;
  }

  // 5. aria-label
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) {
    const sel = `[aria-label="${escapeAttributeValue(ariaLabel)}"]`;
    if (isUniqueSelector(sel)) return sel;
  }

  // 6. name attribute (inputs)
  const name = element.getAttribute('name');
  if (name) {
    const sel = `[name="${escapeAttributeValue(name)}"]`;
    if (isUniqueSelector(sel)) return sel;
  }

  // 7. Role + text for buttons
  const role = element.getAttribute('role');
  const textContent = element.textContent?.trim() ?? '';
  if (
    (role === 'button' || element.tagName.toLowerCase() === 'button') &&
    textContent.length > 0 &&
    textContent.length < 30
  ) {
    const tag = element.tagName.toLowerCase();
    const sel = `${tag}[role="button"]`;
    if (isUniqueSelector(sel)) return sel;
  }

  // 8. Text content for buttons/links
  const tag = element.tagName.toLowerCase();
  if (
    (tag === 'button' || tag === 'a') &&
    textContent.length > 0 &&
    textContent.length < 30
  ) {
    // Return a descriptive text fallback (not a real CSS selector, but descriptive)
    const escapedText = textContent.replace(/"/g, '\\"');
    const textSel = `${tag}:contains("${escapedText}")`;
    // We can't use :contains in standard CSS, so try to find by other means
    // Fall through to next options if not unique via standard CSS
    const allMatchingTags = Array.from(document.querySelectorAll(tag));
    const matching = allMatchingTags.filter(
      (el) => el.textContent?.trim() === textContent
    );
    if (matching.length === 1) {
      // :has-text() is a valid Playwright CSS pseudo-class (not standard CSS)
      return `${tag}:has-text("${escapedText}")`; // Playwright :has-text() pseudo-class
    }
    void textSel; // suppress unused variable
  }

  // 9. Type + placeholder for inputs
  if (tag === 'input') {
    const inputEl = element as HTMLInputElement;
    const placeholder = inputEl.placeholder;
    if (placeholder) {
      const sel = `input[placeholder="${escapeAttributeValue(placeholder)}"]`;
      if (isUniqueSelector(sel)) return sel;
    }
    if (inputEl.type) {
      const sel = `input[type="${inputEl.type}"]`;
      if (isUniqueSelector(sel)) return sel;
    }
  }

  // 10. Full CSS path as last resort
  return generateCSSPath(element);
}
