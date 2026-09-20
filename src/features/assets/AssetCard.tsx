import { memo } from 'react';
import { AssetThumbnail } from '@/features/assets/AssetThumbnail';
import { formatBytes, formatDate, statusLabel } from '@/lib/format';
import type { Asset } from '@/lib/types';

interface Props {
  asset: Asset;
  selected: boolean;
  active: boolean;
  onToggleSelect: (id: string) => void;
  onOpen: (id: string) => void;
}

export const AssetCard = memo(function AssetCard({
  asset,
  selected,
  active,
  onToggleSelect,
  onOpen,
}: Props) {
  return (
    <div
      className={`card${selected ? ' card--selected' : ''}${active ? ' card--active' : ''}`}
      onClick={() => onOpen(asset.id)}
    >
      <AssetThumbnail
        assetId={asset.id}
        hasThumbnail={asset.hasThumbnail}
        className="card__thumb"
      />
      <div className="card__body">
        <p className="card__name">{asset.name}</p>
        <p className="muted card__metadata">
          {asset.kind} · {formatBytes(asset.sizeBytes)} · {formatDate(asset.updatedAt)}
        </p>
        <span className={`pill pill--${asset.status}`}>{statusLabel(asset.status)}</span>
      </div>
      <input
        type="checkbox"
        className="card__check"
        checked={selected}
        onClick={(event) => event.stopPropagation()}
        onChange={() => onToggleSelect(asset.id)}
      />
    </div>
  );
});
