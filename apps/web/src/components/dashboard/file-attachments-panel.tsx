"use client";

import { useAuth } from "@clerk/nextjs";
import Image from "next/image";
import { useEffect, useState, type ChangeEvent } from "react";
import {
  fetchFileContent,
  formatFileDate,
  formatFileSize,
  formatFileType,
  listProjectFiles,
  listTaskAttachments,
  removeProjectFile,
  uploadProjectFile,
  uploadTaskAttachment,
  type FileAttachment,
  type FileAttachmentPage,
} from "@/lib/files";

type FileAttachmentsPanelProps = {
  organizationId: string;
  projectId: string;
  taskId?: string;
};

const allowedFileTypes = ".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv";

export function FileAttachmentsPanel({
  organizationId,
  projectId,
  taskId,
}: FileAttachmentsPanelProps) {
  const { getToken, isLoaded } = useAuth();
  const [loaded, setLoaded] = useState<{
    key: string;
    result: FileAttachmentPage | null;
    error: string | null;
  }>({ key: "", result: null, error: null });
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [busyFileId, setBusyFileId] = useState<string | null>(null);
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    file: FileAttachment;
    url: string;
  } | null>(null);
  const requestKey = `${organizationId}:${projectId}:${taskId ?? "project"}:${retry}`;
  const isLoading = !isLoaded || loaded.key !== requestKey;
  const result = loaded.key === requestKey ? loaded.result : null;
  const loadError = loaded.key === requestKey ? loaded.error : null;

  useEffect(() => {
    if (!isLoaded) return;
    let active = true;

    async function loadFiles() {
      try {
        const token = await getToken();
        if (!token) throw new Error("Your session expired. Sign in again.");
        const page = taskId
          ? await listTaskAttachments(
              token,
              organizationId,
              projectId,
              taskId,
            )
          : await listProjectFiles(token, organizationId, projectId);
        if (active) setLoaded({ key: requestKey, result: page, error: null });
      } catch (requestError) {
        if (active) {
          setLoaded({
            key: requestKey,
            result: null,
            error:
              requestError instanceof Error
                ? requestError.message
                : "We couldn’t load files. Please try again.",
          });
        }
      }
    }

    void loadFiles();
    return () => {
      active = false;
    };
  }, [
    getToken,
    isLoaded,
    organizationId,
    projectId,
    requestKey,
    taskId,
  ]);

  useEffect(() => {
    const objectUrl = preview?.url;
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [preview]);

  async function uploadSelectedFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    setError(null);
    setNotice(null);
    setUploadProgress(0);
    try {
      const token = await getToken();
      if (!token) throw new Error("Your session expired. Sign in again.");
      const uploaded = taskId
        ? await uploadTaskAttachment(
            token,
            organizationId,
            projectId,
            taskId,
            file,
            setUploadProgress,
          )
        : await uploadProjectFile(
            token,
            organizationId,
            projectId,
            file,
            setUploadProgress,
          );
      setLoaded((current) =>
        current.key === requestKey && current.result
          ? {
              ...current,
              result: {
                ...current.result,
                items: [
                  uploaded,
                  ...current.result.items.filter(
                    (item) => item.id !== uploaded.id,
                  ),
                ],
              },
            }
          : current,
      );
      setNotice(`${uploaded.originalName} uploaded.`);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "We couldn’t upload this file. Please try again.",
      );
    } finally {
      setUploadProgress(null);
    }
  }

  async function loadMore() {
    if (!result?.hasMore || isLoadingMore) return;
    setError(null);
    setIsLoadingMore(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Your session expired. Sign in again.");
      const next = result.page + 1;
      const nextPage = taskId
        ? await listTaskAttachments(
            token,
            organizationId,
            projectId,
            taskId,
            next,
          )
        : await listProjectFiles(token, organizationId, projectId, next);
      setLoaded((current) =>
        current.key === requestKey && current.result
          ? {
              ...current,
              result: {
                ...nextPage,
                items: [
                  ...current.result.items,
                  ...nextPage.items.filter(
                    (item) =>
                      !current.result?.items.some(
                        (existing) => existing.id === item.id,
                      ),
                  ),
                ],
              },
            }
          : current,
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "We couldn’t load more files. Please try again.",
      );
    } finally {
      setIsLoadingMore(false);
    }
  }

  async function download(file: FileAttachment) {
    setBusyFileId(file.id);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Your session expired. Sign in again.");
      const blob = await fetchFileContent(
        token,
        organizationId,
        projectId,
        file,
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.originalName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "We couldn’t download this file. Please try again.",
      );
    } finally {
      setBusyFileId(null);
    }
  }

  async function showPreview(file: FileAttachment) {
    setPreviewLoadingId(file.id);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Your session expired. Sign in again.");
      const blob = await fetchFileContent(
        token,
        organizationId,
        projectId,
        file,
        true,
      );
      setPreview({ file, url: URL.createObjectURL(blob) });
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "We couldn’t preview this file. Please try again.",
      );
    } finally {
      setPreviewLoadingId(null);
    }
  }

  async function remove(file: FileAttachment) {
    if (!window.confirm(`Remove “${file.originalName}” from this ${taskId ? "task" : "project"}?`)) {
      return;
    }
    setBusyFileId(file.id);
    setError(null);
    setNotice(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Your session expired. Sign in again.");
      await removeProjectFile(token, organizationId, projectId, file.id);
      setRetry((value) => value + 1);
      if (preview?.file.id === file.id) setPreview(null);
      setNotice(`${file.originalName} removed.`);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "We couldn’t remove this file. Please try again.",
      );
    } finally {
      setBusyFileId(null);
    }
  }

  const title = taskId ? "Task attachments" : "Project files";

  return (
    <section className="file-panel" aria-labelledby={`file-panel-title-${taskId ?? projectId}`}>
      <header className="file-panel-header">
        <div>
          <p className="file-panel-eyebrow">{taskId ? "Task resources" : "Shared workspace"}</p>
          <h2 id={`file-panel-title-${taskId ?? projectId}`}>{title}</h2>
        </div>
        {result?.canUpload && (
          <label className="file-upload-button secondary-button">
            <span>Upload file</span>
            <input
              accept={allowedFileTypes}
              aria-label={`Upload ${taskId ? "task attachment" : "project file"}`}
              disabled={uploadProgress !== null}
              onChange={(event) => void uploadSelectedFile(event)}
              type="file"
            />
          </label>
        )}
      </header>

      <p className="file-panel-hint">
        PDF, PNG, JPG, WebP, TXT, or CSV · Maximum 10 MB by default
      </p>

      {uploadProgress !== null && (
        <div className="file-upload-progress" aria-live="polite">
          <div className="file-upload-progress-label">
            <span>Uploading file…</span>
            <span>{uploadProgress}%</span>
          </div>
          <progress max={100} value={uploadProgress} />
        </div>
      )}
      {notice && <p className="file-panel-notice" role="status">{notice}</p>}
      {error && <p className="file-panel-error" role="alert">{error}</p>}

      {isLoading ? (
        <p className="file-panel-state" aria-live="polite">Loading files…</p>
      ) : loadError ? (
        <div className="file-panel-state" role="alert">
          <p>{loadError}</p>
          <button
            className="secondary-button"
            onClick={() => setRetry((value) => value + 1)}
            type="button"
          >
            Try again
          </button>
        </div>
      ) : result?.items.length ? (
        <>
          <ul className="file-list">
            {result.items.map((file) => (
              <li className="file-list-item" key={file.id}>
                <div className="file-type-mark" aria-hidden="true">
                  {file.mimeType === "application/pdf"
                    ? "PDF"
                    : file.mimeType.startsWith("image/")
                      ? "IMG"
                      : file.mimeType === "text/csv"
                        ? "CSV"
                        : "TXT"}
                </div>
                <div className="file-list-info">
                  <strong title={file.originalName}>{file.originalName}</strong>
                  <span>
                    {formatFileType(file.mimeType)} ·{" "}
                    {formatFileSize(file.sizeBytes)} ·{" "}
                    {file.scanStatus === "CLEAN" ? "Scanned" : "Not scanned"} ·{" "}
                    {file.uploaderName} ·{" "}
                    {formatFileDate(file.uploadedAt)}
                  </span>
                </div>
                <div className="file-list-actions">
                  {file.canPreview && (
                    <button
                      className="file-action-button"
                      disabled={previewLoadingId === file.id}
                      onClick={() => void showPreview(file)}
                      type="button"
                    >
                      {previewLoadingId === file.id ? "Loading…" : "Preview"}
                    </button>
                  )}
                  <button
                    className="file-action-button"
                    disabled={busyFileId === file.id}
                    onClick={() => void download(file)}
                    type="button"
                  >
                    Download
                  </button>
                  {file.canRemove && (
                    <button
                      className="file-action-button file-remove-button"
                      disabled={busyFileId === file.id}
                      onClick={() => void remove(file)}
                      type="button"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {result.hasMore && (
            <button
              className="secondary-button file-load-more"
              disabled={isLoadingMore}
              onClick={() => void loadMore()}
              type="button"
            >
              {isLoadingMore ? "Loading…" : "Load more"}
            </button>
          )}
        </>
      ) : (
        <div className="file-panel-empty">
          <span className="file-empty-icon" aria-hidden="true">↥</span>
          <strong>No files yet</strong>
          <p>
            {result?.canUpload
              ? `Upload a file to keep ${taskId ? "task attachments" : "project resources"} together.`
              : "Files shared with this project will appear here."}
          </p>
        </div>
      )}

      {preview && (
        <div className="file-preview-backdrop">
          <section
            aria-label={`Preview: ${preview.file.originalName}`}
            aria-modal="true"
            className="file-preview-dialog"
            role="dialog"
          >
            <header className="file-preview-header">
              <strong title={preview.file.originalName}>
                {preview.file.originalName}
              </strong>
              <button
                aria-label="Close preview"
                className="file-action-button"
                onClick={() => setPreview(null)}
                type="button"
              >
                Close
              </button>
            </header>
            <div className="file-preview-content">
              {preview.file.mimeType === "application/pdf" ? (
                <iframe
                  src={preview.url}
                  title={`PDF preview: ${preview.file.originalName}`}
                  sandbox="allow-same-origin"
                />
              ) : (
                <Image
                  alt={preview.file.originalName}
                  className="file-preview-image"
                  fill
                  sizes="(max-width: 700px) 100vw, 80vw"
                  src={preview.url}
                  unoptimized
                />
              )}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
