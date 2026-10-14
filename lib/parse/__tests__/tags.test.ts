import { DEFAULT_TAGS, extractTags } from '../tags';

describe('extractTags', () => {
  it('finds known tags in any case and returns them upper-case', () => {
    const result = extractTags('dinner @az @GS', DEFAULT_TAGS);
    expect(result.tags).toEqual(['AZ', 'GS']);
    expect(result.text.trim()).toBe('dinner');
  });

  it('only matches whole tags', () => {
    expect(extractTags('meet @AZX', ['AZ']).tags).toEqual([]);
  });

  it('accepts a family-specific tag list', () => {
    expect(extractTags('lunch @ZQ', ['ZQ']).tags).toEqual(['ZQ']);
  });

  it('ignores tags that are not 2-4 letters, so they cannot inject regex syntax', () => {
    expect(extractTags('a @A.B', ['A.B'])).toEqual({ text: 'a @A.B', tags: [] });
  });

  it('does nothing with an empty tag list', () => {
    expect(extractTags('lunch @AZ', [])).toEqual({ text: 'lunch @AZ', tags: [] });
  });
});
