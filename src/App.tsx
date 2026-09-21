import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import { AssetDetail } from '@/features/assets/AssetDetail';
import {
  ASSET_LIST_QUERY_KEY,
  getAssetIdsInQueryCache,
  getAssetListQueryKey,
  keepFirstAssetPage,
  replaceAssetsInListCache,
  replaceAssetsInQueryCache,
  setAssetStatusesInQueryCache,
  type AssetListQueryKey,
} from '@/features/assets/assetCache';
import { AssetGrid } from '@/features/assets/AssetGrid';
import { runBulkStatusRequests } from '@/features/assets/bulkAssetStatus';
import { useAssetFilters } from '@/features/assets/useAssetFilters';
import { useAssets, useAssetFacets } from '@/features/assets/useAssets';
import { useDebouncedCallback } from '@/features/assets/useDebouncedCallback';
import {
  ASSET_KINDS,
  ASSET_STATUSES,
  toAssetQuery,
  type AssetFilters,
} from '@/lib/asset-query';
import { statusLabel } from '@/lib/format';
import type { Asset, AssetKind, AssetSort, AssetStatus, BulkResult } from '@/lib/types';

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

type BulkRetryKind = 'conflict' | 'transient_request' | null;

interface BulkFailure {
  id: string;
  asset: Asset;
  code: string;
  message: string;
  retryKind: BulkRetryKind;
}

interface BulkOutcome {
  targetStatus: AssetStatus;
  succeededCount: number;
  failures: BulkFailure[];
  selectionScopeKey: string;
}

interface BulkOperationContext {
  operationId: number;
  targetIds: Set<string>;
  targetStatus: AssetStatus;
  originalAssetsById: Map<string, Asset>;
  filters: AssetFilters;
  queryKey: AssetListQueryKey;
  selectionScopeKey: string;
}

interface RangeSelectionContext {
  anchorId: string | null;
  baseIds: Set<string>;
}

interface RequestFailureDetails {
  code: string;
  message: string;
  retryKind: BulkRetryKind;
}

function getAssetListErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return 'Search is temporarily busy. Wait a moment and try again.';
    if (error.status === 503) return 'The asset library is temporarily unavailable. Try again.';
  }
  return 'We could not load the asset library. Check your connection and try again.';
}

function getBulkItemFailureMessage(result: Extract<BulkResult['results'][number], { ok: false }>) {
  if (result.code === 'legal_hold') {
    return 'This asset is on legal hold and cannot be moved to the requested status.';
  }
  if (result.code === 'conflict') {
    return 'The asset changed while this update was applied. Retry this asset.';
  }
  if (result.code === 'not_found') return 'This asset no longer exists.';
  return result.message ?? 'The asset could not be updated.';
}

function getRequestFailureDetails(error: unknown): RequestFailureDetails {
  if (error instanceof ApiError) {
    if (error.status === 429) {
      return {
        code: error.code,
        message: 'The service is busy. Apply the status again after a short wait.',
        retryKind: 'transient_request',
      };
    }
    if (error.status === 503) {
      return {
        code: error.code,
        message: 'The service is temporarily unavailable. Apply the status again later.',
        retryKind: 'transient_request',
      };
    }
    return {
      code: error.code,
      message: 'The request failed before per-asset results were available.',
      retryKind: null,
    };
  }

  return {
    code: 'network_error',
    message: 'The request could not reach the service. Check the connection and try again.',
    retryKind: 'transient_request',
  };
}

function shouldResetAssetPages(filters: AssetFilters, targetStatus: AssetStatus) {
  const statusMembershipChanges =
    filters.status.length > 0 && !filters.status.includes(targetStatus);
  const updatedAtControlsOrder = filters.sort.startsWith('updatedAt:');
  return statusMembershipChanges || updatedAtControlsOrder;
}

export function App() {
  const queryClient = useQueryClient();
  const { filters, setFilters } = useAssetFilters();
  const [searchDraft, setSearchDraft] = useState(filters.q);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detailAssetUpdate, setDetailAssetUpdate] = useState<Asset | null>(null);
  const [pendingDetailStatusId, setPendingDetailStatusId] = useState<string | null>(null);
  const [bulkOutcome, setBulkOutcome] = useState<BulkOutcome | null>(null);
  const [activeBulkOperation, setActiveBulkOperation] =
    useState<BulkOperationContext | null>(null);
  const rangeSelectionRef = useRef<RangeSelectionContext>({
    anchorId: null,
    baseIds: new Set(),
  });
  const selectedIdsRef = useRef(selectedIds);
  const activeBulkOperationRef = useRef<BulkOperationContext | null>(null);
  const pendingDetailStatusIdRef = useRef<string | null>(null);
  const operationSequenceRef = useRef(0);
  const activeIdRef = useRef(activeId);

  const activeQueryKey = useMemo(() => getAssetListQueryKey(filters), [filters]);
  const selectionScopeKey = useMemo(() => JSON.stringify(toAssetQuery(filters)), [filters]);
  const filtersRef = useRef(filters);
  const activeQueryKeyRef = useRef(activeQueryKey);
  const selectionScopeKeyRef = useRef(selectionScopeKey);
  filtersRef.current = filters;
  activeQueryKeyRef.current = activeQueryKey;
  selectionScopeKeyRef.current = selectionScopeKey;
  activeIdRef.current = activeId;
  selectedIdsRef.current = selectedIds;

  const { run: commitSearchQuery, cancel: cancelPendingSearch } = useDebouncedCallback(
    (searchQuery: string) =>
      setFilters((currentFilters) => ({ ...currentFilters, q: searchQuery }), 'replace'),
    SEARCH_DEBOUNCE_MS,
  );

  useEffect(() => {
    cancelPendingSearch();
    setSearchDraft(filters.q);
  }, [cancelPendingSearch, filters.q]);

  useEffect(() => {
    rangeSelectionRef.current = { anchorId: null, baseIds: new Set() };
    selectedIdsRef.current = new Set();
    setSelectedIds(new Set());
    setBulkOutcome(null);
  }, [selectionScopeKey]);

  const {
    items,
    total,
    loading,
    refreshing,
    error,
    reload,
    hasNextPage,
    loadingNextPage,
    loadNextPageError,
    loadNextPage,
  } = useAssets(filters);
  const assetFacetsQuery = useAssetFacets();
  const isSearchPending = searchDraft.trim() !== filters.q;
  const isBulkUpdating = activeBulkOperation !== null;

  function clearSelection() {
    if (activeBulkOperationRef.current || pendingDetailStatusIdRef.current) return;
    rangeSelectionRef.current = { anchorId: null, baseIds: new Set() };
    selectedIdsRef.current = new Set();
    setSelectedIds(new Set());
    setBulkOutcome(null);
  }

  function handleSearchChange(value: string) {
    setSearchDraft(value);
    if (value.trim() !== filters.q) clearSelection();
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

  const toggleSelect = useCallback(
    (id: string, shiftKey: boolean) => {
      if (activeBulkOperationRef.current || pendingDetailStatusIdRef.current) return;
      const rangeSelection = rangeSelectionRef.current;
      const anchorIndex = rangeSelection.anchorId
        ? items.findIndex((asset) => asset.id === rangeSelection.anchorId)
        : -1;
      const targetIndex = items.findIndex((asset) => asset.id === id);
      const usesRangeSelection = shiftKey && anchorIndex >= 0 && targetIndex >= 0;

      if (!usesRangeSelection && selectedIdsRef.current.has(id)) {
        setBulkOutcome((currentOutcome) => {
          if (!currentOutcome) return currentOutcome;
          const failures = currentOutcome.failures.filter((failure) => failure.id !== id);
          return failures.length === currentOutcome.failures.length
            ? currentOutcome
            : { ...currentOutcome, failures };
        });
      }
      setSelectedIds((currentIds) => {
        if (usesRangeSelection) {
          const rangeStart = Math.min(anchorIndex, targetIndex);
          const rangeEnd = Math.max(anchorIndex, targetIndex);
          const nextIds = new Set(rangeSelection.baseIds);
          for (let index = rangeStart; index <= rangeEnd; index += 1) {
            const asset = items[index];
            if (asset) nextIds.add(asset.id);
          }
          selectedIdsRef.current = nextIds;
          return nextIds;
        }

        const nextIds = new Set(currentIds);
        if (nextIds.has(id)) nextIds.delete(id);
        else nextIds.add(id);

        rangeSelectionRef.current = {
          anchorId: id,
          baseIds: new Set(nextIds),
        };
        selectedIdsRef.current = nextIds;
        return nextIds;
      });
    },
    [items],
  );

  function selectAllLoaded() {
    if (activeBulkOperationRef.current || pendingDetailStatusIdRef.current) return;
    const loadedIds = new Set(items.map((asset) => asset.id));
    rangeSelectionRef.current = { anchorId: null, baseIds: new Set(loadedIds) };
    selectedIdsRef.current = loadedIds;
    setSelectedIds(loadedIds);
  }

  const openAssetDetail = useCallback((id: string) => {
    setDetailAssetUpdate(null);
    setActiveId(id);
  }, []);

  function closeAssetDetail() {
    setDetailAssetUpdate(null);
    setActiveId(null);
  }

  const handleLoadNextPage = useCallback(() => {
    if (
      activeBulkOperationRef.current ||
      queryClient.isFetching({ queryKey: activeQueryKeyRef.current, exact: true }) > 0
    ) {
      return;
    }
    void loadNextPage();
  }, [loadNextPage, queryClient]);

  async function reconcileQueriesAfterStatusChange(
    operationFilters: AssetFilters,
    operationQueryKey: AssetListQueryKey,
    targetStatus: AssetStatus,
    succeededCount: number,
    forcePageReset = false,
  ) {
    const resetPages =
      succeededCount > 0 &&
      (forcePageReset || shouldResetAssetPages(operationFilters, targetStatus));
    if (resetPages) keepFirstAssetPage(queryClient, operationQueryKey);

    await queryClient.invalidateQueries({
      queryKey: ASSET_LIST_QUERY_KEY,
      refetchType: 'none',
    });

    if (resetPages) {
      await queryClient.refetchQueries({
        queryKey: operationQueryKey,
        exact: true,
        type: 'active',
      });
    }
  }

  async function runBulkStatusOperation(
    requestedIds: string[],
    targetStatus: AssetStatus,
    preservedFailures: BulkFailure[] = [],
    previousSucceededCount = 0,
    outcomeSelectionScopeKey = selectionScopeKey,
  ) {
    if (
      activeBulkOperationRef.current ||
      pendingDetailStatusIdRef.current ||
      requestedIds.length === 0
    ) {
      return;
    }

    const knownAssetsById = new Map(items.map((asset) => [asset.id, asset]));
    for (const failure of bulkOutcome?.failures ?? []) {
      if (!knownAssetsById.has(failure.id)) knownAssetsById.set(failure.id, failure.asset);
    }

    const targetIds = [...new Set(requestedIds)].filter((id) => knownAssetsById.has(id));
    if (targetIds.length === 0) return;

    const originalAssetsById = new Map<string, Asset>();
    for (const id of targetIds) {
      const asset = knownAssetsById.get(id);
      if (!asset) continue;
      originalAssetsById.set(id, asset);
    }

    const operation: BulkOperationContext = {
      operationId: operationSequenceRef.current + 1,
      targetIds: new Set(targetIds),
      targetStatus,
      originalAssetsById,
      filters,
      queryKey: activeQueryKey,
      selectionScopeKey,
    };
    operationSequenceRef.current = operation.operationId;
    activeBulkOperationRef.current = operation;
    setActiveBulkOperation(operation);
    if (preservedFailures.length === 0) setBulkOutcome(null);

    try {
      await queryClient.cancelQueries({ queryKey: ASSET_LIST_QUERY_KEY });
      setAssetStatusesInQueryCache(
        queryClient,
        operation.queryKey,
        operation.targetIds,
        targetStatus,
      );
      const chunkOutcomes = await runBulkStatusRequests(targetIds, targetStatus);
      const reconciledAssetsById = new Map<string, Asset>();
      const successfulAssetsById = new Map<string, Asset>();
      const failedAssets: BulkFailure[] = [];
      let succeededCount = 0;

      for (const chunkOutcome of chunkOutcomes) {
        if (!chunkOutcome.ok) {
          const requestFailure = getRequestFailureDetails(chunkOutcome.error);
          for (const id of chunkOutcome.ids) {
            const originalAsset = operation.originalAssetsById.get(id);
            if (!originalAsset) continue;
            reconciledAssetsById.set(id, originalAsset);
            failedAssets.push({
              id,
              asset: originalAsset,
              code: requestFailure.code,
              message: requestFailure.message,
              retryKind: requestFailure.retryKind,
            });
          }
          continue;
        }

        const resultById = new Map(
          chunkOutcome.result.results.map((result) => [result.id, result]),
        );
        for (const id of chunkOutcome.ids) {
          const originalAsset = operation.originalAssetsById.get(id);
          if (!originalAsset) continue;
          const result = resultById.get(id);

          if (result?.ok) {
            reconciledAssetsById.set(id, result.asset);
            successfulAssetsById.set(id, result.asset);
            succeededCount += 1;
          } else if (result) {
            reconciledAssetsById.set(id, originalAsset);
            failedAssets.push({
              id,
              asset: originalAsset,
              code: result.code,
              message: getBulkItemFailureMessage(result),
              retryKind: result.code === 'conflict' ? 'conflict' : null,
            });
          } else {
            reconciledAssetsById.set(id, originalAsset);
            failedAssets.push({
              id,
              asset: originalAsset,
              code: 'missing_result',
              message: 'The service did not return an outcome for this asset.',
              retryKind: null,
            });
          }
        }
      }

      replaceAssetsInQueryCache(queryClient, operation.queryKey, reconciledAssetsById);
      replaceAssetsInListCache(queryClient, successfulAssetsById);
      const activeDetailAsset = activeIdRef.current
        ? reconciledAssetsById.get(activeIdRef.current)
        : undefined;
      if (activeDetailAsset) setDetailAssetUpdate(activeDetailAsset);
      await reconcileQueriesAfterStatusChange(
        operation.filters,
        operation.queryKey,
        operation.targetStatus,
        succeededCount,
        outcomeSelectionScopeKey !== operation.selectionScopeKey,
      );
      if (selectionScopeKeyRef.current !== operation.selectionScopeKey) {
        await reconcileQueriesAfterStatusChange(
          filtersRef.current,
          activeQueryKeyRef.current,
          operation.targetStatus,
          succeededCount,
          true,
        );
      }

      const retainedFailures = preservedFailures.filter(
        (failure) => !operation.targetIds.has(failure.id),
      );
      const unresolvedFailures = [...retainedFailures, ...failedAssets];
      const loadedIds = getAssetIdsInQueryCache(queryClient, activeQueryKeyRef.current);
      setSelectedIds((currentIds) => {
        const nextIds = new Set(
          [...currentIds].filter(
            (id) => loadedIds.has(id) && !operation.targetIds.has(id),
          ),
        );
        if (selectionScopeKeyRef.current === outcomeSelectionScopeKey) {
          for (const failure of unresolvedFailures) nextIds.add(failure.id);
        }
        rangeSelectionRef.current = { anchorId: null, baseIds: new Set(nextIds) };
        selectedIdsRef.current = nextIds;
        return nextIds;
      });
      setBulkOutcome({
        targetStatus,
        succeededCount: previousSucceededCount + succeededCount,
        failures: unresolvedFailures,
        selectionScopeKey: outcomeSelectionScopeKey,
      });
    } finally {
      if (activeBulkOperationRef.current?.operationId === operation.operationId) {
        activeBulkOperationRef.current = null;
        setActiveBulkOperation(null);
      }
    }
  }

  function applyBulkStatus(targetStatus: AssetStatus) {
    void runBulkStatusOperation([...selectedIds], targetStatus);
  }

  function retryConflictFailures() {
    if (!bulkOutcome) return;
    const conflictIds = bulkOutcome.failures
      .filter((failure) => failure.retryKind === 'conflict')
      .map((failure) => failure.id);
    const conflictIdSet = new Set(conflictIds);
    const preservedFailures = bulkOutcome.failures.filter(
      (failure) => !conflictIdSet.has(failure.id),
    );
    void runBulkStatusOperation(
      conflictIds,
      bulkOutcome.targetStatus,
      preservedFailures,
      bulkOutcome.succeededCount,
      bulkOutcome.selectionScopeKey,
    );
  }

  async function handleSaved(asset: Asset) {
    rangeSelectionRef.current = { anchorId: null, baseIds: new Set() };
    selectedIdsRef.current = new Set();
    setSelectedIds(new Set());
    setBulkOutcome(null);
    await queryClient.cancelQueries({ queryKey: ASSET_LIST_QUERY_KEY });
    setDetailAssetUpdate(asset);
    replaceAssetsInListCache(queryClient, new Map([[asset.id, asset]]));
    const reconciledScopeKey = selectionScopeKeyRef.current;
    await reconcileQueriesAfterStatusChange(
      filtersRef.current,
      activeQueryKeyRef.current,
      asset.status,
      1,
      true,
    );
    if (selectionScopeKeyRef.current !== reconciledScopeKey) {
      await reconcileQueriesAfterStatusChange(
        filtersRef.current,
        activeQueryKeyRef.current,
        asset.status,
        1,
        true,
      );
    }
  }

  const handleDetailStatusActivity = useCallback((id: string, active: boolean) => {
    if (active) {
      pendingDetailStatusIdRef.current = id;
      setPendingDetailStatusId(id);
    } else if (pendingDetailStatusIdRef.current === id) {
      pendingDetailStatusIdRef.current = null;
      setPendingDetailStatusId(null);
    }
  }, []);

  const availableTags = (assetFacetsQuery.data?.tags ?? []).filter(
    (tag) => !filters.tag.includes(tag),
  );
  const isSearching = isSearchPending || loading;
  const retryableConflictCount =
    bulkOutcome?.failures.filter((failure) => failure.retryKind === 'conflict').length ?? 0;
  const activeListAsset = activeId ? (items.find((asset) => asset.id === activeId) ?? null) : null;
  const detailListAsset =
    detailAssetUpdate?.id === activeId &&
    (!activeListAsset || detailAssetUpdate.version >= activeListAsset.version)
      ? detailAssetUpdate
      : activeListAsset;

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

      {(items.length > 0 || selectedIds.size > 0) && (
        <div className="bulkbar">
          <span>{selectedIds.size} selected</span>
          <button
            type="button"
            disabled={isBulkUpdating || pendingDetailStatusId !== null || isSearching}
            onClick={selectAllLoaded}
          >
            Select all {items.length.toLocaleString()} loaded
          </button>
          {ASSET_STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              disabled={
                isBulkUpdating ||
                pendingDetailStatusId !== null ||
                isSearching ||
                selectedIds.size === 0
              }
              onClick={() => applyBulkStatus(status)}
            >
              Set {statusLabel(status).toLowerCase()}
            </button>
          ))}
          <button
            type="button"
            disabled={
              isBulkUpdating || pendingDetailStatusId !== null || selectedIds.size === 0
            }
            onClick={clearSelection}
          >
            Clear selection
          </button>
          {isBulkUpdating && (
            <span className="muted">
              Updating {activeBulkOperation.targetIds.size.toLocaleString()} assets…
            </span>
          )}
        </div>
      )}

      {bulkOutcome && (
        <section className="bulk-outcome" aria-label="Bulk update result">
          <p>
            <strong>
              {bulkOutcome.succeededCount.toLocaleString()} updated to{' '}
              {statusLabel(bulkOutcome.targetStatus).toLowerCase()}.
            </strong>{' '}
            {bulkOutcome.failures.length > 0 &&
              `${bulkOutcome.failures.length.toLocaleString()} could not be updated.`}
          </p>
          {retryableConflictCount > 0 && (
            <button
              type="button"
              disabled={isBulkUpdating || pendingDetailStatusId !== null}
              onClick={retryConflictFailures}
            >
              Retry {retryableConflictCount.toLocaleString()} conflicts
            </button>
          )}
          {bulkOutcome.failures.length > 0 && (
            <ul className="bulk-failure-list">
              {bulkOutcome.failures.map((failure) => (
                <li key={failure.id}>
                  <strong>{failure.asset.name}</strong> <span>({failure.id})</span>:{' '}
                  {failure.message}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

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
            selectionDisabled={isBulkUpdating || pendingDetailStatusId !== null}
            hasNextPage={hasNextPage && !isBulkUpdating && !refreshing}
            loadingNextPage={loadingNextPage}
            loadMoreErrorMessage={
              !isBulkUpdating && !refreshing && loadNextPageError
                ? getAssetListErrorMessage(loadNextPageError)
                : null
            }
            onLoadNextPage={handleLoadNextPage}
            onToggleSelect={toggleSelect}
            onOpen={openAssetDetail}
          />
        )}
        {activeId && (
          <AssetDetail
            id={activeId}
            listAsset={detailListAsset}
            statusUpdateDisabledMessage={
              isBulkUpdating
                ? 'Status changes are unavailable during this bulk update.'
                : pendingDetailStatusId !== null
                  ? 'A status update is still finishing.'
                  : undefined
            }
            onStatusActivityChange={handleDetailStatusActivity}
            onClose={closeAssetDetail}
            onSaved={handleSaved}
          />
        )}
      </main>
    </div>
  );
}
