function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Render {{tag}} placeholders in a template string using a merge data object.
 * Unknown tags are left as-is rather than blanked, so broken data doesn't
 * silently produce empty output in a recipient's email.
 */
export function renderMergeTags(
  template: string,
  data: Record<string, unknown>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = data[key];
    if (value === undefined || value === null) return match;
    return escapeHtml(String(value));
  });
}
