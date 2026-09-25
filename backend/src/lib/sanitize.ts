/**
 * Strips HTML tags and trims whitespace from user-provided text fields.
 *
 * This intentionally handles a few edge cases that regularly slip past simple
 * tag stripping: inline event attributes, script blocks, and control chars that
 * can be used to smuggle active content or malformed text into project metadata.
 */
export function sanitizeString(input: string): string {
  if (typeof input !== "string") return "";

  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, " ")
    .replace(/javascript\s*:/gi, " ")
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
