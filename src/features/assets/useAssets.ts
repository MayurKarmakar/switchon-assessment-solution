import { useMemo } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { getFacets, listAssets } from '@/api/client';
import { getAssetListQueryKey } from '@/features/assets/assetCache';
import { toAssetQuery, type AssetFilters } from '@/lib/asset-query';

export function useAssets(filters: AssetFilters) {
  const assetQuery = toAssetQuery(filters);
  const assetsQuery = useInfiniteQuery({
    queryKey: getAssetListQueryKey(filters),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      listAssets(
        {
          ...assetQuery,
          cursor: pageParam ?? undefined,
        },
        signal,
      ),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const items = useMemo(
    () => assetsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [assetsQuery.data],
  );
  const initialError = items.length === 0 ? assetsQuery.error : null;
  const loadNextPageError = assetsQuery.isFetchNextPageError ? assetsQuery.error : null;

  return {
    items,
    total: assetsQuery.data?.pages[0]?.total ?? 0,
    loading: assetsQuery.isPending,
    refreshing:
      assetsQuery.isFetching && !assetsQuery.isPending && !assetsQuery.isFetchingNextPage,
    error: initialError,
    reload: assetsQuery.refetch,
    hasNextPage: Boolean(assetsQuery.hasNextPage),
    loadingNextPage: assetsQuery.isFetchingNextPage,
    loadNextPageError,
    loadNextPage: assetsQuery.fetchNextPage,
  };
}

export function useAssetFacets() {
  return useQuery({
    queryKey: ['asset-facets'],
    queryFn: ({ signal }) => getFacets(signal),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}
