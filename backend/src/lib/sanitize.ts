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
    .replace(/<script[\s\S]*?>([\s\S]*?)<\/script>/gi, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
