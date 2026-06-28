/**
 * Strips HTML tags and trims whitespace from user-provided text fields.
 */
export function sanitizeString(input: string): string {
  return input.replace(/<[^>]*>/g, "").trim();
}
