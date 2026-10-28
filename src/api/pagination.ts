import { identity, integer, record, type RecordData } from '../domain/validation';
import { ApiError } from './errors';

/**
 * Reads a complete collection using numbered pages of up to 100 requested items.
 *
 * @param read - Fetches and unwraps one result with the supplied paging/qualifier fields.
 * @param qualifiers - Applied on every page; paging fields take precedence.
 * @returns Validated object records in page order, never a successful truncated list.
 * @throws {@link ApiError} - Promise rejection for malformed paging or incomplete
 * counts, changing metadata, duplicate IDs, or the 200-page/20,000-item safety cap.
 * Field guards can also reject with InvalidData; the client maps that failure.
 * @remarks
 * Uses total pages, not the unreliable next-page field. Empty zero-page and
 * one-page responses are accepted. Consistent metadata cannot prove a
 * transactional server snapshot.
 */
export async function collection(
  read: (parameters: Record<string, string>) => Promise<unknown>,
  qualifiers: Record<string, string> = {},
): Promise<RecordData[]> {
  const items: RecordData[] = [];
  const seen = new Set<string>();
  let totalItems: number | undefined;
  let totalPages: number | undefined;
  let pageSize: number | undefined;
  for (let page = 1; ; page += 1) {
    const response = record(await read({
      ...qualifiers, _items_per_page: '100', _page_number: String(page),
    }));
    const paging = record(response.paging);
    const count = integer(paging.total_items);
    const pages = integer(paging.total_pages);
    const size = integer(paging.items_per_page);
    if (!Array.isArray(response.items) || integer(paging.page_number) !== page ||
        size < 1 || size > 100) throw new ApiError('invalid-response');
    if (pages > 200 || count > 20_000) throw new ApiError('incomplete-refresh');
    if ((count === 0 && pages !== 0 && pages !== 1) ||
        (count > 0 && pages !== Math.ceil(count / size))) {
      throw new ApiError('incomplete-refresh');
    }
    if (totalItems !== undefined &&
        (count !== totalItems || pages !== totalPages || size !== pageSize)) {
      throw new ApiError('incomplete-refresh');
    }
    totalItems = count;
    totalPages = pages;
    pageSize = size;
    const expected = Math.min(size, Math.max(0, count - (page - 1) * size));
    if (response.items.length !== expected) throw new ApiError('incomplete-refresh');
    const pageItems: readonly unknown[] = response.items;
    for (const raw of pageItems) {
      const item = record(raw);
      const id = identity(item.id);
      if (seen.has(id)) throw new ApiError('incomplete-refresh');
      seen.add(id);
      items.push(item);
    }
    if (page >= pages) break;
  }
  if (items.length !== totalItems) throw new ApiError('incomplete-refresh');
  return items;
}
