import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { AssetCard } from '@/features/assets/AssetCard';
import type { Asset } from '@/lib/types';

const GRID_GAP_PX = 12;
const GRID_PADDING_PX = 16;
const MIN_CARD_WIDTH_PX = 220;
const CARD_BODY_HEIGHT_PX = 120;
const LOAD_MORE_HEIGHT_PX = 88;

interface Props {
  assets: Asset[];
  selectedIds: Set<string>;
  activeId: string | null;
  hasNextPage: boolean;
  loadingNextPage: boolean;
  loadMoreErrorMessage: string | null;
  onLoadNextPage: () => void;
  onToggleSelect: (id: string) => void;
  onOpen: (id: string) => void;
}

function useElementWidth(elementRef: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    function updateWidth() {
      setWidth(element?.clientWidth ?? 0);
    }

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, [elementRef]);

  return width;
}

function getGridMetrics(containerWidth: number) {
  const innerWidth = Math.max(0, containerWidth - GRID_PADDING_PX * 2);
  const columnCount = Math.max(
    1,
    Math.floor((innerWidth + GRID_GAP_PX) / (MIN_CARD_WIDTH_PX + GRID_GAP_PX)),
  );
  const cardWidth = Math.max(
    MIN_CARD_WIDTH_PX,
    (innerWidth - GRID_GAP_PX * (columnCount - 1)) / columnCount,
  );
  const cardHeight = Math.ceil((cardWidth * 10) / 16 + CARD_BODY_HEIGHT_PX);

  return { columnCount, cardWidth, cardHeight };
}

export function AssetGrid({
  assets,
  selectedIds,
  activeId,
  hasNextPage,
  loadingNextPage,
  loadMoreErrorMessage,
  onLoadNextPage,
  onToggleSelect,
  onOpen,
}: Props) {
  const scrollElementRef = useRef<HTMLDivElement>(null);
  const containerWidth = useElementWidth(scrollElementRef);
  const { columnCount, cardWidth, cardHeight } = useMemo(
    () => getGridMetrics(containerWidth),
    [containerWidth],
  );

  const cardVirtualizer = useVirtualizer({
    count: assets.length,
    getScrollElement: () => scrollElementRef.current,
    estimateSize: () => cardHeight,
    getItemKey: (index) => assets[index]?.id ?? index,
    lanes: columnCount,
    gap: GRID_GAP_PX,
    paddingStart: GRID_PADDING_PX,
    paddingEnd: GRID_PADDING_PX,
    overscan: columnCount * 2,
  });

  useLayoutEffect(() => {
    cardVirtualizer.measure();
  }, [cardHeight, cardVirtualizer, columnCount]);

  const virtualCards = cardVirtualizer.getVirtualItems();
  const highestVirtualIndex = virtualCards.reduce(
    (highestIndex, virtualCard) => Math.max(highestIndex, virtualCard.index),
    -1,
  );

  useEffect(() => {
    const reachedLoadThreshold = highestVirtualIndex >= assets.length - columnCount * 2;
    if (
      reachedLoadThreshold &&
      hasNextPage &&
      !loadingNextPage &&
      loadMoreErrorMessage === null
    ) {
      onLoadNextPage();
    }
  }, [
    assets.length,
    columnCount,
    hasNextPage,
    highestVirtualIndex,
    loadMoreErrorMessage,
    loadingNextPage,
    onLoadNextPage,
  ]);

  if (assets.length === 0) {
    return (
      <div className="empty">
        <p>Nothing matches these filters.</p>
        <p className="muted">Clear the search or remove one or more filters.</p>
      </div>
    );
  }

  const showLoadMoreState = hasNextPage || loadMoreErrorMessage !== null;
  const virtualizedHeight = cardVirtualizer.getTotalSize();
  const contentHeight = virtualizedHeight + (showLoadMoreState ? LOAD_MORE_HEIGHT_PX : 0);

  return (
    <div ref={scrollElementRef} className="grid-scroll" aria-busy={loadingNextPage}>
      <div className="grid-virtualizer" style={{ height: contentHeight }}>
        {virtualCards.map((virtualCard) => {
          const asset = assets[virtualCard.index];
          if (!asset) return null;

          return (
            <div
              key={virtualCard.key}
              className="virtual-card"
              style={{
                width: cardWidth,
                height: cardHeight,
                left: GRID_PADDING_PX + virtualCard.lane * (cardWidth + GRID_GAP_PX),
                transform: `translateY(${virtualCard.start}px)`,
              }}
            >
              <AssetCard
                asset={asset}
                selected={selectedIds.has(asset.id)}
                active={activeId === asset.id}
                onToggleSelect={onToggleSelect}
                onOpen={onOpen}
              />
            </div>
          );
        })}

        {showLoadMoreState && (
          <div className="load-more-state" style={{ top: virtualizedHeight }}>
            {loadMoreErrorMessage ? (
              <>
                <p>{loadMoreErrorMessage}</p>
                <button type="button" onClick={onLoadNextPage}>
                  Try again
                </button>
              </>
            ) : (
              <p>Loading more assets…</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
