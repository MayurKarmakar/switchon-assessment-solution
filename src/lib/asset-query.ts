import type { AssetKind, AssetQuery, AssetSort, AssetStatus } from './types';

export const ASSET_STATUSES = ['draft', 'in_review', 'approved', 'archived'] as const;
export const ASSET_KINDS = ['image', 'video', 'document'] as const;
export const ASSET_SORTS = [
  'updatedAt:desc',
  'updatedAt:asc',
  'name:asc',
  'name:desc',
  'sizeBytes:desc',
  'createdAt:desc',
] as const;

export const DEFAULT_ASSET_SORT: AssetSort = 'updatedAt:desc';
export const ASSET_PAGE_SIZE = 50;

export interface AssetFilters {
  q: string;
  status: AssetStatus[];
  kind: AssetKind[];
  tag: string[];
  sort: AssetSort;
}

const validStatuses = new Set<string>(ASSET_STATUSES);
const validKinds = new Set<string>(ASSET_KINDS);
const validSorts = new Set<string>(ASSET_SORTS);

function readCsvValues(params: URLSearchParams, key: string): string[] {
  return params
    .getAll(key)
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean);
}

function uniqueValues<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function normalizeAssetFilters(filters: AssetFilters): AssetFilters {
  return {
    q: filters.q.trim(),
    status: ASSET_STATUSES.filter((status) => filters.status.includes(status)),
    kind: ASSET_KINDS.filter((kind) => filters.kind.includes(kind)),
    tag: uniqueValues(filters.tag.map((tag) => tag.trim()).filter(Boolean)).sort((a, b) =>
      a.localeCompare(b),
    ),
    sort: filters.sort,
  };
}

export function parseAssetFilters(search: string): AssetFilters {
  const params = new URLSearchParams(search);
  const sort = params.get('sort');

  return normalizeAssetFilters({
    q: params.get('q') ?? '',
    status: readCsvValues(params, 'status').filter((value): value is AssetStatus =>
      validStatuses.has(value),
    ),
    kind: readCsvValues(params, 'kind').filter((value): value is AssetKind =>
      validKinds.has(value),
    ),
    tag: readCsvValues(params, 'tag'),
    sort: sort && validSorts.has(sort) ? (sort as AssetSort) : DEFAULT_ASSET_SORT,
  });
}

export function serializeAssetFilters(filters: AssetFilters): string {
  const normalized = normalizeAssetFilters(filters);
  const params = new URLSearchParams();

  if (normalized.q) params.set('q', normalized.q);
  if (normalized.status.length) params.set('status', normalized.status.join(','));
  if (normalized.kind.length) params.set('kind', normalized.kind.join(','));
  if (normalized.tag.length) params.set('tag', normalized.tag.join(','));
  params.set('sort', normalized.sort);

  return params.toString();
}

export function toAssetQuery(filters: AssetFilters): AssetQuery {
  const normalized = normalizeAssetFilters(filters);

  return {
    q: normalized.q || undefined,
    status: normalized.status.length ? normalized.status : undefined,
    kind: normalized.kind.length ? normalized.kind : undefined,
    tag: normalized.tag.length ? normalized.tag : undefined,
    sort: normalized.sort,
    limit: ASSET_PAGE_SIZE,
  };
}
