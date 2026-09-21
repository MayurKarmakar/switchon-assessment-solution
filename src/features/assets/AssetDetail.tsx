import { useEffect, useRef, useState } from 'react';
import { ApiError, getAsset, updateAsset } from '@/api/client';
import { AssetThumbnail } from '@/features/assets/AssetThumbnail';
import { formatBytes, formatDate, formatDuration, statusLabel } from '@/lib/format';
import type { Asset, AssetStatus } from '@/lib/types';

const STATUSES: AssetStatus[] = ['draft', 'in_review', 'approved', 'archived'];

interface Props {
  id: string;
  listAsset: Asset | null;
  onClose: () => void;
  onSaved: (asset: Asset) => void | Promise<void>;
  onStatusActivityChange: (id: string, active: boolean) => void;
  statusUpdateDisabledMessage?: string;
}

interface StatusConflict {
  attemptedStatus: AssetStatus;
  latestVersionLoaded: boolean;
  latestStatusMatches: boolean;
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function AssetDetail({
  id,
  listAsset,
  onClose,
  onSaved,
  onStatusActivityChange,
  statusUpdateDisabledMessage,
}: Props) {
  const [asset, setAsset] = useState<Asset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [statusConflict, setStatusConflict] = useState<StatusConflict | null>(null);
  const currentIdRef = useRef(id);
  const detailLoadControllerRef = useRef<AbortController | null>(null);
  currentIdRef.current = id;

  useEffect(() => {
    const controller = new AbortController();
    detailLoadControllerRef.current?.abort();
    detailLoadControllerRef.current = controller;
    setAsset(null);
    setError(null);
    setStatusConflict(null);
    getAsset(id, controller.signal)
      .then((loadedAsset) => {
        if (currentIdRef.current === id) {
          setAsset((currentAsset) =>
            !currentAsset || loadedAsset.version >= currentAsset.version
              ? loadedAsset
              : currentAsset,
          );
        }
      })
      .catch((loadError: unknown) => {
        if (!isAbortError(loadError) && currentIdRef.current === id) {
          setError(loadError instanceof Error ? loadError.message : 'Load failed');
        }
      });

    return () => controller.abort();
  }, [id]);

  useEffect(() => {
    if (!listAsset || listAsset.id !== id) return;
    setAsset((currentAsset) => {
      if (!currentAsset || listAsset.version >= currentAsset.version) return listAsset;
      return currentAsset;
    });
  }, [id, listAsset]);

  async function loadLatestVersion(attemptedStatus: AssetStatus) {
    const requestedId = id;
    const controller = new AbortController();
    detailLoadControllerRef.current?.abort();
    detailLoadControllerRef.current = controller;
    try {
      const latestAsset = await getAsset(requestedId, controller.signal);
      if (currentIdRef.current !== requestedId) return;
      setAsset((currentAsset) =>
        !currentAsset || latestAsset.version >= currentAsset.version ? latestAsset : currentAsset,
      );
      await onSaved(latestAsset);
      if (currentIdRef.current !== requestedId) return;
      setStatusConflict({
        attemptedStatus,
        latestVersionLoaded: true,
        latestStatusMatches: latestAsset.status === attemptedStatus,
      });
    } catch (loadError) {
      if (!isAbortError(loadError) && currentIdRef.current === requestedId) {
        setStatusConflict({
          attemptedStatus,
          latestVersionLoaded: false,
          latestStatusMatches: false,
        });
      }
    }
  }

  async function setStatus(status: AssetStatus) {
    if (!asset || saving || statusUpdateDisabledMessage) return;
    setSaving(true);
    onStatusActivityChange(asset.id, true);
    setError(null);
    setStatusConflict(null);
    try {
      const updated = await updateAsset(asset.id, asset.version, { status });
      await onSaved(updated);
      if (currentIdRef.current === updated.id) setAsset(updated);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.code === 'version_conflict') {
        await loadLatestVersion(status);
      } else if (currentIdRef.current === asset.id) {
        setError(err instanceof Error ? err.message : 'Save failed');
      }
    } finally {
      onStatusActivityChange(asset.id, false);
      setSaving(false);
    }
  }

  async function reloadLatestVersion() {
    if (!statusConflict || saving || statusUpdateDisabledMessage) return;
    setSaving(true);
    onStatusActivityChange(id, true);
    try {
      await loadLatestVersion(statusConflict.attemptedStatus);
    } finally {
      onStatusActivityChange(id, false);
      setSaving(false);
    }
  }

  return (
    <aside className="panel">
      <div className="panel__head">
        <h2>Asset detail</h2>
        <button type="button" onClick={onClose}>Close</button>
      </div>

      {error && <p className="error">{error}</p>}
      {!asset && !error && <p className="muted">Loading…</p>}

      {asset && (
        <div className="panel__body">
          <AssetThumbnail
            assetId={asset.id}
            hasThumbnail={asset.hasThumbnail}
            className="panel__thumb"
          />
          <h3>{asset.name}</h3>
          <dl className="facts">
            <dt>Id</dt>
            <dd>{asset.id}</dd>
            <dt>Kind</dt>
            <dd>{asset.kind}</dd>
            <dt>Size</dt>
            <dd>{formatBytes(asset.sizeBytes)}</dd>
            {asset.width && (
              <>
                <dt>Dimensions</dt>
                <dd>
                  {asset.width}×{asset.height}
                </dd>
              </>
            )}
            {asset.durationSec && (
              <>
                <dt>Duration</dt>
                <dd>{formatDuration(asset.durationSec)}</dd>
              </>
            )}
            <dt>Owner</dt>
            <dd>{asset.owner.name}</dd>
            <dt>Updated</dt>
            <dd>{formatDate(asset.updatedAt)}</dd>
            <dt>Version</dt>
            <dd>{asset.version}</dd>
          </dl>

          {asset.tags.length > 0 && (
            <ul className="tags">
              {asset.tags.map((tag) => (
                <li key={tag}>{tag}</li>
              ))}
            </ul>
          )}

          <p className="muted">Status</p>
          {statusUpdateDisabledMessage && <p className="muted">{statusUpdateDisabledMessage}</p>}
          {statusConflict && (
            <div className="error" role="alert">
              <p>
                This asset changed before your update.{' '}
                {statusConflict.latestStatusMatches
                  ? `The latest version is already ${statusLabel(statusConflict.attemptedStatus).toLowerCase()}, so no further update is needed.`
                  : statusConflict.latestVersionLoaded
                  ? `The latest version is shown. Review it before reapplying ${statusLabel(statusConflict.attemptedStatus).toLowerCase()}.`
                  : 'The latest version could not be loaded. Reload it before reapplying your change.'}
              </p>
              <div className="row">
                {statusConflict.latestVersionLoaded && !statusConflict.latestStatusMatches ? (
                  <button
                    type="button"
                    disabled={saving || Boolean(statusUpdateDisabledMessage)}
                    onClick={() => setStatus(statusConflict.attemptedStatus)}
                  >
                    Reapply {statusLabel(statusConflict.attemptedStatus).toLowerCase()}
                  </button>
                ) : !statusConflict.latestVersionLoaded ? (
                  <button
                    type="button"
                    disabled={saving || Boolean(statusUpdateDisabledMessage)}
                    onClick={reloadLatestVersion}
                  >
                    Reload latest version
                  </button>
                ) : null}
                <button type="button" disabled={saving} onClick={() => setStatusConflict(null)}>
                  Dismiss
                </button>
              </div>
            </div>
          )}
          <div className="row">
            {STATUSES.map((status) => (
              <button
                key={status}
                disabled={saving || Boolean(statusUpdateDisabledMessage) || status === asset.status}
                onClick={() => setStatus(status)}
              >
                {statusLabel(status)}
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
