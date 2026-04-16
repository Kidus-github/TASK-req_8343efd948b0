import { describe, expect, it } from 'vitest';
import { parseCsv, stringifyCsv } from '../../src/lib/util/csv';

describe('csv round-trip', () => {
  it('parses headers and rows', () => {
    const { headers, rows } = parseCsv('a,b\n1,2\n3,4\n');
    expect(headers).toEqual(['a', 'b']);
    expect(rows).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' }
    ]);
  });

  it('handles quoted cells with commas and escaped quotes', () => {
    const { rows } = parseCsv('a,b\n"x,y","say ""hi"""\n');
    expect(rows[0]).toEqual({ a: 'x,y', b: 'say "hi"' });
  });

  it('stringify quotes fields with specials', () => {
    const csv = stringifyCsv([{ a: 'x,y', b: 'say "hi"' }], ['a', 'b']);
    expect(csv).toContain('"x,y"');
    expect(csv).toContain('"say ""hi"""');
  });

  it('tolerates CRLF line endings', () => {
    const { rows } = parseCsv('a,b\r\n1,2\r\n');
    expect(rows).toEqual([{ a: '1', b: '2' }]);
  });
});
