import { useCallback, useEffect, useRef, useState } from 'react';
import {
  normalizeAssetFilters,
  parseAssetFilters,
  serializeAssetFilters,
  type AssetFilters,
} from '@/lib/asset-query';

type HistoryMode = 'push' | 'replace';
type AssetFilterUpdate = AssetFilters | ((currentFilters: AssetFilters) => AssetFilters);

function readAssetFiltersFromUrl(): AssetFilters {
  return parseAssetFilters(window.location.search);
}

function writeAssetFiltersToUrl(filters: AssetFilters, mode: HistoryMode) {
  const url = new URL(window.location.href);
  const search = serializeAssetFilters(filters);
  url.search = search ? `?${search}` : '';

  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  if (mode === 'replace') window.history.replaceState(null, '', nextUrl);
  else window.history.pushState(null, '', nextUrl);
}

export function useAssetFilters() {
  const [filters, setFilterState] = useState(readAssetFiltersFromUrl);
  const filtersRef = useRef(filters);

  useEffect(() => {
    // Make the default sort explicit so a copied URL fully describes the view.
    writeAssetFiltersToUrl(filtersRef.current, 'replace');

    function handlePopState() {
      const restoredFilters = readAssetFiltersFromUrl();
      filtersRef.current = restoredFilters;
      setFilterState(restoredFilters);
    }

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const setFilters = useCallback((update: AssetFilterUpdate, mode: HistoryMode = 'push') => {
    const updatedFilters = typeof update === 'function' ? update(filtersRef.current) : update;
    const normalizedFilters = normalizeAssetFilters(updatedFilters);
    writeAssetFiltersToUrl(normalizedFilters, mode);
    filtersRef.current = normalizedFilters;
    setFilterState(normalizedFilters);
  }, []);

  return { filters, setFilters };
}
