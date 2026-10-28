import { describe, expect, it, vi } from 'vitest';
import { collection } from './pagination';

function page(ids: string[], number = 1, total = ids.length, pages = 1, size = 100) {
  return {
    items: ids.map((id) => ({ id })),
    paging: {
      total_items: total, total_pages: pages, page_number: String(number),
      items_per_page: String(size), next_page_number: number + 1,
    },
  };
}

describe('complete bounded pagination', () => {
  it('reads all pages, accepts string metadata, and ignores a next-page pointer beyond the last page', async () => {
    const read = vi.fn()
      .mockResolvedValueOnce(page(['A', 'B'], 1, 3, 2, 2))
      .mockResolvedValueOnce(page(['C'], 2, 3, 2, 2));
    expect(await collection(read, { verified: '1' })).toEqual([{ id: 'A' }, { id: 'B' }, { id: 'C' }]);
    expect(read).toHaveBeenNthCalledWith(2, {
      verified: '1', _items_per_page: '100', _page_number: '2',
    });
  });

  it('accepts the observed empty zero-page result', async () => {
    expect(await collection(async () => page([], 1, 0, 0))).toEqual([]);
  });

  it.each([
    ['duplicates', page(['A', 'A'])],
    ['missing items', page(['A'], 1, 2)],
    ['unexpected empty page', page([], 1, 1)],
    ['bad page identity', page(['A'], 2)],
    ['page budget', page([], 1, 20_001, 201)],
    ['item budget', page([], 1, 20_001, 200)],
    ['contradictory counts', page(['A'], 1, 1, 2)],
  ])('rejects %s instead of returning partial data', async (_label, response) => {
    await expect(collection(async () => response)).rejects.toHaveProperty(
      'code', _label === 'bad page identity' ? 'invalid-response' : 'incomplete-refresh',
    );
  });

  it('rejects changed totals and duplicate identities across pages', async () => {
    for (const second of [page(['C'], 2, 4, 2, 2), page(['A'], 2, 3, 2, 2)]) {
      const read = vi.fn()
        .mockResolvedValueOnce(page(['A', 'B'], 1, 3, 2, 2))
        .mockResolvedValueOnce(second);
      await expect(collection(read)).rejects.toHaveProperty('code', 'incomplete-refresh');
    }
  });
});
