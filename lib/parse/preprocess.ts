// Expand shorthand time ranges before chrono parses them.
// Handles both bare hours (2-5pm) and times with minutes (5:15-6:15pm).
// "2-5pm"        → "2pm-5pm"
// "11-4pm"       → "11am-4pm"    (start > end with pm → start must be am)
// "11-4"         → "11am-4pm"    (no suffix, start > end → crosses noon)
// "11:30-2:45pm" → "11:30am-2:45pm"
// "5:15-6:15pm"  → "5:15pm-6:15pm"
export const preprocessInput = (raw: string): string => {
  // Pattern: H[:MM]-H[:MM] am/pm
  let out = raw.replace(/\b(\d{1,2}(?::\d{2})?)-(\d{1,2}(?::\d{2})?)\s*(am|pm)\b/gi, (_, s: string, e: string, mer: string) => {
    const startH = parseInt(s, 10), endH = parseInt(e, 10), m = mer.toLowerCase();
    if (startH === 12) return `${s}${m}-${e}${m}`;
    if (startH > endH && m === 'pm') return `${s}am-${e}${m}`;
    return `${s}${m}-${e}${m}`;
  });
  // Pattern: H[:MM]-H[:MM] with no am/pm suffix
  out = out.replace(/\b(\d{1,2}(?::\d{2})?)-(\d{1,2}(?::\d{2})?)\b(?!\s*(?:am|pm))/gi, (match: string, s: string, e: string) => {
    const startH = parseInt(s, 10), endH = parseInt(e, 10);
    if (startH > endH) return `${startH === 12 ? `${s}pm` : `${s}am`}-${e}pm`;
    return match;
  });
  return out;
};
