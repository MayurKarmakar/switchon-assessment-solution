import { useQuery } from '@tanstack/react-query';
import { getFacets, listAssets } from '@/api/client';
import { toAssetQuery, type AssetFilters } from '@/lib/asset-query';

export function useAssets(filters: AssetFilters) {
  const assetQuery = toAssetQuery(filters);
  const assetsQuery = useQuery({
    queryKey: ['assets', assetQuery],
    queryFn: ({ signal }) => listAssets(assetQuery, signal),
  });

  return {
    items: assetsQuery.data?.items ?? [],
    total: assetsQuery.data?.total ?? 0,
    nextCursor: assetsQuery.data?.nextCursor ?? null,
    loading: assetsQuery.isPending,
    refreshing: assetsQuery.isFetching && !assetsQuery.isPending,
    error: assetsQuery.error,
    reload: assetsQuery.refetch,
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
