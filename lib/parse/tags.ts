// The two people tagged before families existed. Family member tags replace these in FEAT-002.
export const DEFAULT_TAGS = ['AZ', 'GS'] as const;

const SAFE_TAG = /^[A-Za-z]{2,4}$/;

/** Remove `@TAG` mentions for the given tags. Returned tags are upper-case; text is not trimmed. */
export const extractTags = (text: string, knownTags: readonly string[]): { text: string; tags: string[] } => {
  const safe = knownTags.filter(t => SAFE_TAG.test(t));
  if (safe.length === 0) return { text, tags: [] };

  const tags: string[] = [];
  const stripped = text.replace(new RegExp(`@(${safe.join('|')})\\b`, 'gi'), (_, tag: string) => {
    tags.push(tag.toUpperCase());
    return '';
  });
  return { text: stripped, tags };
};
