import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import { toAssetQuery, type AssetFilters } from '@/lib/asset-query';
import type { Asset, AssetPage, AssetStatus } from '@/lib/types';

export const ASSET_LIST_QUERY_KEY = ['assets'] as const;

export type AssetListQueryKey = ReturnType<typeof getAssetListQueryKey>;
type AssetInfiniteData = InfiniteData<AssetPage, string | null>;

export function getAssetListQueryKey(filters: AssetFilters) {
  return [...ASSET_LIST_QUERY_KEY, toAssetQuery(filters)] as const;
}

function updateAssetData(
  currentData: AssetInfiniteData | undefined,
  updateAsset: (asset: Asset) => Asset,
) {
  if (!currentData) return currentData;

  let dataChanged = false;
  const pages = currentData.pages.map((page) => {
    let pageChanged = false;
    const items = page.items.map((asset) => {
      const updatedAsset = updateAsset(asset);
      if (updatedAsset === asset) return asset;

      pageChanged = true;
      return updatedAsset;
    });

    if (!pageChanged) return page;
    dataChanged = true;
    return { ...page, items };
  });

  return dataChanged ? { ...currentData, pages } : currentData;
}

function getAssetReplacement(asset: Asset, assetsById: ReadonlyMap<string, Asset>) {
  const replacement = assetsById.get(asset.id);
  if (!replacement || replacement === asset || replacement.version < asset.version) return asset;
  return replacement;
}

export function replaceAssetsInListCache(
  queryClient: QueryClient,
  assetsById: ReadonlyMap<string, Asset>,
) {
  if (assetsById.size === 0) return;

  queryClient.setQueriesData<AssetInfiniteData>(
    { queryKey: ASSET_LIST_QUERY_KEY },
    (currentData) =>
      updateAssetData(currentData, (asset) => getAssetReplacement(asset, assetsById)),
  );
}

export function replaceAssetsInQueryCache(
  queryClient: QueryClient,
  queryKey: AssetListQueryKey,
  assetsById: ReadonlyMap<string, Asset>,
) {
  if (assetsById.size === 0) return;
  queryClient.setQueryData<AssetInfiniteData>(queryKey, (currentData) =>
    updateAssetData(currentData, (asset) => getAssetReplacement(asset, assetsById)),
  );
}

export function setAssetStatusesInQueryCache(
  queryClient: QueryClient,
  queryKey: AssetListQueryKey,
  targetIds: ReadonlySet<string>,
  status: AssetStatus,
) {
  if (targetIds.size === 0) return;
  queryClient.setQueryData<AssetInfiniteData>(queryKey, (currentData) =>
    updateAssetData(currentData, (asset) =>
      targetIds.has(asset.id) && asset.status !== status ? { ...asset, status } : asset,
    ),
  );
}

export function getAssetIdsInQueryCache(
  queryClient: QueryClient,
  queryKey: AssetListQueryKey,
) {
  const currentData = queryClient.getQueryData<AssetInfiniteData>(queryKey);
  return new Set(currentData?.pages.flatMap((page) => page.items.map((asset) => asset.id)) ?? []);
}

export function keepFirstAssetPage(queryClient: QueryClient, queryKey: AssetListQueryKey) {
  queryClient.setQueryData<AssetInfiniteData>(queryKey, (currentData) => {
    const firstPage = currentData?.pages[0];
    if (!currentData || !firstPage || currentData.pages.length === 1) return currentData;

    return {
      pages: [firstPage],
      pageParams: [currentData.pageParams[0] ?? null],
    };
  });
}
