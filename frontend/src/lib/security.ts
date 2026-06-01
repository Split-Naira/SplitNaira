/**
 * Security: HTML/XSS Escaping Utilities
 * 
 * Provides secure text rendering utilities to prevent XSS attacks.
 * All user-provided content should be passed through these utilities
 * before rendering in the DOM.
 */

/**
 * Escapes HTML special characters to prevent XSS
 * Converts: < > & " '
 * 
 * @param text - Raw user input text
 * @returns Safely escaped HTML string
 */
export function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return text.replace(/[&<>"']/g, (char) => map[char] || char);
}

/**
 * Sanitizes user input by removing/escaping dangerous content
 * - Removes script tags and event handlers
 * - Escapes HTML special characters
 * - Removes suspicious URL schemes (javascript:, data:, etc.)
 * 
 * @param text - Raw user input
 * @returns Sanitized text safe for display
 */
export function sanitizeText(text: string): string {
  // First escape HTML
  let sanitized = escapeHtml(text);

  // Remove any remaining suspicious patterns in case validation was bypassed
  const dangerousPatterns = [
    /javascript:/gi,
    /vbscript:/gi,
    /on\w+\s*=/gi, // event handlers
    /<script/gi,
    /eval\(/gi,
  ];

  for (const pattern of dangerousPatterns) {
    sanitized = sanitized.replace(pattern, "");
  }

  return sanitized;
}

/**
 * Validates that text contains only safe characters
 * Used to catch issues that may have bypassed backend validation
 * 
 * @param text - Text to validate
 * @returns true if text appears safe, false otherwise
 */
export function isSafeText(text: string): boolean {
  // Check for dangerous patterns
  const dangerousPatterns = [
    /<script/i,
    /onclick/i,
    /onerror/i,
    /onload/i,
    /javascript:/i,
    /eval\(/i,
  ];

  return !dangerousPatterns.some((pattern) => pattern.test(text));
}

/**
 * Truncates text to a maximum length while preserving word boundaries
 * 
 * @param text - Text to truncate
 * @param maxLength - Maximum length
 * @param suffix - Suffix to add if truncated (default: "...")
 * @returns Truncated text
 */
export function truncateText(
  text: string,
  maxLength: number,
  suffix: string = "..."
): string {
  if (text.length <= maxLength) {
    return text;
  }

  let truncated = text.substring(0, maxLength - suffix.length);

  // Try to preserve word boundaries
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > maxLength * 0.7) {
    // Only use last space if it's not too far back
    truncated = truncated.substring(0, lastSpace);
  }

  return truncated + suffix;
}

/**
 * Formats user-provided text safely for display
 * Combines escaping and truncation
 * 
 * @param text - Raw user input
 * @param maxLength - Optional maximum length
 * @returns Formatted safe text
 */
export function formatUserText(
  text: string,
  maxLength?: number
): string {
  let formatted = sanitizeText(text);
  if (maxLength) {
    formatted = truncateText(formatted, maxLength);
  }
  return formatted;
}
