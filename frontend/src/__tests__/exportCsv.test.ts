/**
 * Tests for src/lib/exportCsv.ts — closes #1203
 *
 * Covers:
 *  - toCsvString: header row, value rows, RFC-4180 escaping, BOM prefix
 *  - downloadCsv: blob creation, anchor click, URL revocation
 *  - csvFilename: date-stamped filename format
 */
import { toCsvString, downloadCsv, csvFilename, type CsvColumn } from '../lib/exportCsv';

// ── toCsvString ──────────────────────────────────────────────────────────────

interface Row {
  id: string;
  status: string;
  amount: number;
}

const COLUMNS: CsvColumn<Row>[] = [
  { header: 'Loan ID', value: (r) => r.id },
  { header: 'Status', value: (r) => r.status },
  { header: 'Amount', value: (r) => String(r.amount) },
];

describe('toCsvString', () => {
  it('includes a UTF-8 BOM prefix', () => {
    const csv = toCsvString([], COLUMNS);
    expect(csv.startsWith('\uFEFF')).toBe(true);
  });

  it('generates a correct header row', () => {
    const csv = toCsvString([], COLUMNS);
    const lines = csv.slice(1).split('\n'); // skip BOM
    expect(lines[0]).toBe('Loan ID,Status,Amount');
  });

  it('generates data rows from rows', () => {
    const rows: Row[] = [
      { id: '1', status: 'active', amount: 1000 },
      { id: '2', status: 'repaid', amount: 2000 },
    ];
    const csv = toCsvString(rows, COLUMNS);
    const lines = csv.slice(1).split('\n');
    expect(lines[1]).toBe('1,active,1000');
    expect(lines[2]).toBe('2,repaid,2000');
  });

  it('wraps values containing commas in double-quotes', () => {
    const cols: CsvColumn<{ name: string }>[] = [
      { header: 'Name', value: (r) => r.name },
    ];
    const csv = toCsvString([{ name: 'hello, world' }], cols);
    expect(csv).toContain('"hello, world"');
  });

  it('escapes embedded double-quotes per RFC 4180', () => {
    const cols: CsvColumn<{ note: string }>[] = [
      { header: 'Note', value: (r) => r.note },
    ];
    const csv = toCsvString([{ note: 'say "hi"' }], cols);
    expect(csv).toContain('"say ""hi"""');
  });

  it('wraps values containing newlines in double-quotes', () => {
    const cols: CsvColumn<{ desc: string }>[] = [
      { header: 'Desc', value: (r) => r.desc },
    ];
    const csv = toCsvString([{ desc: 'line1\nline2' }], cols);
    expect(csv).toContain('"line1\nline2"');
  });

  it('returns only the header when rows array is empty', () => {
    const csv = toCsvString([], COLUMNS);
    const lines = csv.slice(1).split('\n');
    expect(lines).toHaveLength(1); // header only, no trailing empty line
  });
});

// ── csvFilename ──────────────────────────────────────────────────────────────

describe('csvFilename', () => {
  it('uses the provided prefix', () => {
    const name = csvFilename('loans');
    expect(name.startsWith('loans-')).toBe(true);
  });

  it('includes today's date in YYYY-MM-DD format', () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(csvFilename('loans')).toBe(`loans-${today}.csv`);
  });

  it('ends with .csv', () => {
    expect(csvFilename('history').endsWith('.csv')).toBe(true);
  });
});

// ── downloadCsv ──────────────────────────────────────────────────────────────

describe('downloadCsv', () => {
  let createObjectURLMock: jest.Mock;
  let revokeObjectURLMock: jest.Mock;
  let appendChildSpy: jest.SpyInstance;
  let removeChildSpy: jest.SpyInstance;
  let clickSpy: jest.Mock;

  beforeEach(() => {
    createObjectURLMock = jest.fn().mockReturnValue('blob:fake-url');
    revokeObjectURLMock = jest.fn();
    Object.defineProperty(window, 'URL', {
      writable: true,
      value: {
        createObjectURL: createObjectURLMock,
        revokeObjectURL: revokeObjectURLMock,
      },
    });

    clickSpy = jest.fn();
    jest.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = { href: '', setAttribute: jest.fn(), click: clickSpy } as unknown as HTMLAnchorElement;
      return tag === 'a' ? el : (document.createElement as jest.Mock).getMockImplementation()!(tag);
    });

    appendChildSpy = jest.spyOn(document.body, 'appendChild').mockImplementation(() => null as unknown as Node);
    removeChildSpy = jest.spyOn(document.body, 'removeChild').mockImplementation(() => null as unknown as Node);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates a Blob with text/csv mime type', () => {
    const BlobSpy = jest.spyOn(window, 'Blob').mockImplementation((parts, opts) => {
      return { parts, opts } as unknown as Blob;
    });
    downloadCsv('data', 'file.csv');
    expect(BlobSpy).toHaveBeenCalledWith(['data'], { type: 'text/csv;charset=utf-8;' });
    BlobSpy.mockRestore();
  });

  it('sets the download attribute on the anchor', () => {
    const anchor = { href: '', setAttribute: jest.fn(), click: clickSpy } as unknown as HTMLAnchorElement;
    jest.spyOn(document, 'createElement').mockReturnValue(anchor);
    downloadCsv('data', 'loans-2025-09-26.csv');
    expect(anchor.setAttribute).toHaveBeenCalledWith('download', 'loans-2025-09-26.csv');
  });

  it('triggers a click on the anchor', () => {
    const anchor = { href: '', setAttribute: jest.fn(), click: clickSpy } as unknown as HTMLAnchorElement;
    jest.spyOn(document, 'createElement').mockReturnValue(anchor);
    downloadCsv('data', 'file.csv');
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('revokes the object URL after clicking', () => {
    const anchor = { href: '', setAttribute: jest.fn(), click: clickSpy } as unknown as HTMLAnchorElement;
    jest.spyOn(document, 'createElement').mockReturnValue(anchor);
    downloadCsv('data', 'file.csv');
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:fake-url');
  });

  it('removes the anchor from the DOM after clicking', () => {
    const anchor = { href: '', setAttribute: jest.fn(), click: clickSpy } as unknown as HTMLAnchorElement;
    jest.spyOn(document, 'createElement').mockReturnValue(anchor);
    appendChildSpy.mockImplementation(() => null as unknown as Node);
    removeChildSpy.mockImplementation(() => null as unknown as Node);
    downloadCsv('data', 'file.csv');
    expect(removeChildSpy).toHaveBeenCalledWith(anchor);
  });
});
