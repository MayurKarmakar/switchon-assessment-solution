import { useEffect, useState } from 'react';
import { ApiError, bulkSetStatus } from '@/api/client';
import { AssetDetail } from '@/features/assets/AssetDetail';
import { AssetGrid } from '@/features/assets/AssetGrid';
import { useAssetFilters } from '@/features/assets/useAssetFilters';
import { useAssets, useAssetFacets } from '@/features/assets/useAssets';
import { useDebouncedCallback } from '@/features/assets/useDebouncedCallback';
import { ASSET_KINDS, ASSET_STATUSES } from '@/lib/asset-query';
import { statusLabel } from '@/lib/format';
import type { Asset, AssetKind, AssetSort, AssetStatus } from '@/lib/types';

const SEARCH_DEBOUNCE_MS = 300;

const SORT_OPTIONS: Array<{ value: AssetSort; label: string }> = [
  { value: 'updatedAt:desc', label: 'Recently updated' },
  { value: 'updatedAt:asc', label: 'Least recently updated' },
  { value: 'name:asc', label: 'Name A–Z' },
  { value: 'name:desc', label: 'Name Z–A' },
  { value: 'sizeBytes:desc', label: 'Largest first' },
  { value: 'createdAt:desc', label: 'Newest' },
];

const KIND_LABELS: Record<AssetKind, string> = {
  image: 'Images',
  video: 'Videos',
  document: 'Documents',
};

function getAssetListErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return 'Search is temporarily busy. Wait a moment and try again.';
    if (error.status === 503) return 'The asset library is temporarily unavailable. Try again.';
  }
  return 'We could not load the asset library. Check your connection and try again.';
}

export function App() {
  const { filters, setFilters } = useAssetFilters();
  const [searchDraft, setSearchDraft] = useState(filters.q);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const { run: commitSearchQuery, cancel: cancelPendingSearch } = useDebouncedCallback(
    (searchQuery: string) =>
      setFilters((currentFilters) => ({ ...currentFilters, q: searchQuery }), 'replace'),
    SEARCH_DEBOUNCE_MS,
  );

  useEffect(() => {
    cancelPendingSearch();
    setSearchDraft(filters.q);
  }, [cancelPendingSearch, filters.q]);

  const { items, total, loading, refreshing, error, reload } = useAssets(filters);
  const assetFacetsQuery = useAssetFacets();
  const isSearchPending = searchDraft.trim() !== filters.q;

  function handleSearchChange(value: string) {
    setSearchDraft(value);
    commitSearchQuery(value.trim());
  }

  function toggleStatus(status: AssetStatus) {
    setFilters((current) => ({
      ...current,
      status: current.status.includes(status)
        ? current.status.filter((value) => value !== status)
        : [...current.status, status],
    }));
  }

  function toggleKind(kind: AssetKind) {
    setFilters((current) => ({
      ...current,
      kind: current.kind.includes(kind)
        ? current.kind.filter((value) => value !== kind)
        : [...current.kind, kind],
    }));
  }

  function addTag(tag: string) {
    if (!tag) return;
    setFilters((current) => ({ ...current, tag: [...current.tag, tag] }));
  }

  function removeTag(tag: string) {
    setFilters((current) => ({
      ...current,
      tag: current.tag.filter((value) => value !== tag),
    }));
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function applyBulkStatus(next: AssetStatus) {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setNotice(null);
    try {
      const result = await bulkSetStatus(ids, next);
      setNotice(`${result.applied} updated, ${result.failed} failed.`);
      setSelectedIds(new Set());
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Bulk update failed');
    }
  }

  function handleSaved(_asset: Asset) {}

  const availableTags = (assetFacetsQuery.data?.tags ?? []).filter(
    (tag) => !filters.tag.includes(tag),
  );
  const isSearching = isSearchPending || loading;

  return (
    <div className="app">
      <header className="topbar">
        <h1>MediaVault</h1>
        <label className="search-field">
          <span className="visually-hidden">Search assets</span>
          <input
            className="search"
            type="search"
            placeholder="Search assets"
            value={searchDraft}
            onChange={(event) => handleSearchChange(event.target.value)}
          />
        </label>
        <label className="sort-field">
          <span>Sort</span>
          <select
            value={filters.sort}
            onChange={(event) =>
              setFilters((current) => ({ ...current, sort: event.target.value as AssetSort }))
            }
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </header>

      <section className="filters" aria-label="Asset filters">
        <fieldset className="filter-group">
          <legend>Status</legend>
          {ASSET_STATUSES.map((status) => (
            <label key={status}>
              <input
                type="checkbox"
                checked={filters.status.includes(status)}
                onChange={() => toggleStatus(status)}
              />
              {statusLabel(status)}
            </label>
          ))}
        </fieldset>

        <fieldset className="filter-group">
          <legend>Kind</legend>
          {ASSET_KINDS.map((kind) => (
            <label key={kind}>
              <input
                type="checkbox"
                checked={filters.kind.includes(kind)}
                onChange={() => toggleKind(kind)}
              />
              {KIND_LABELS[kind]}
            </label>
          ))}
        </fieldset>

        <div className="tag-filter">
          <label htmlFor="tag-filter">Tags</label>
          <select
            id="tag-filter"
            value=""
            disabled={
              assetFacetsQuery.isPending || assetFacetsQuery.isError || availableTags.length === 0
            }
            onChange={(event) => addTag(event.target.value)}
          >
            <option value="">
              {assetFacetsQuery.isPending
                ? 'Loading tags…'
                : assetFacetsQuery.isError
                  ? 'Tags unavailable'
                  : 'Add a tag'}
            </option>
            {availableTags.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
          {filters.tag.length > 0 && (
            <div className="tag-chips" aria-label="Selected tags">
              {filters.tag.map((tag) => (
                <button key={tag} type="button" onClick={() => removeTag(tag)}>
                  {tag} <span aria-hidden="true">×</span>
                  <span className="visually-hidden">Remove {tag} filter</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <span className="muted result-count">
          {isSearching
            ? 'Searching…'
            : error
              ? 'Results unavailable'
              : `${items.length} of ${total.toLocaleString()} shown`}
          {refreshing ? ' · Updating…' : ''}
        </span>
      </section>

      {selectedIds.size > 0 && (
        <div className="bulkbar">
          <span>{selectedIds.size} selected</span>
          {ASSET_STATUSES.map((status) => (
            <button key={status} onClick={() => applyBulkStatus(status)}>
              Set {statusLabel(status).toLowerCase()}
            </button>
          ))}
          <button onClick={() => setSelectedIds(new Set())}>Clear selection</button>
        </div>
      )}

      {notice && <p className="notice">{notice}</p>}

      <main className="content" aria-busy={isSearching}>
        {isSearching ? (
          <div className="request-state">
            <p>Searching the asset library…</p>
          </div>
        ) : error ? (
          <div className="request-state request-state--error">
            <p>{getAssetListErrorMessage(error)}</p>
            <button type="button" onClick={() => void reload()}>
              Try again
            </button>
          </div>
        ) : (
          <AssetGrid
            assets={items}
            selectedIds={selectedIds}
            activeId={activeId}
            onToggleSelect={toggleSelect}
            onOpen={setActiveId}
          />
        )}
        {activeId && (
          <AssetDetail id={activeId} onClose={() => setActiveId(null)} onSaved={handleSaved} />
        )}
      </main>
    </div>
  );
}
