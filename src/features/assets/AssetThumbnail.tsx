import { useState } from 'react';
import { thumbnailUrl } from '@/api/client';

interface Props {
  assetId: string;
  hasThumbnail: boolean;
  className: string;
}

export function AssetThumbnail({ assetId, hasThumbnail, className }: Props) {
  const [failedAssetId, setFailedAssetId] = useState<string | null>(null);
  const shouldLoadThumbnail = hasThumbnail && failedAssetId !== assetId;

  return (
    <div className={`${className} asset-thumbnail`}>
      {shouldLoadThumbnail ? (
        <img
          className="asset-thumbnail__image"
          src={thumbnailUrl(assetId)}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailedAssetId(assetId)}
        />
      ) : (
        <span className="asset-thumbnail__placeholder" aria-hidden="true">
          No preview
        </span>
      )}
    </div>
  );
}
