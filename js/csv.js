/**
 * Minimal CSV serialisation — enough for Excel-compatible exports.
 */

function csvCell(value) {
  const text = value == null ? '' : String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * @param {Array<string>} header
 * @param {Array<Array<string|number|null>>} rows
 * @returns {string}
 */
export function toCsv(header, rows) {
  const lines = [header, ...rows].map((cells) => cells.map(csvCell).join(','));
  return lines.join('\r\n');
}
