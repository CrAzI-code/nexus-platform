"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/dashboard/icons";
import { useOrganizationWorkspace } from "@/components/dashboard/organization-shell";
import {
  fetchFileContent,
  formatFileDate,
  formatFileSize,
  formatFileType,
  listOrganizationFiles,
  removeProjectFile,
  type OrganizationFile,
  type OrganizationFileFilters,
} from "@/lib/files";
import { organizationDashboardPath } from "@/lib/routes";

type FileTypeFilter = NonNullable<OrganizationFileFilters["type"]> | "all";
type ScanStatusFilter =
  NonNullable<OrganizationFileFilters["scanStatus"]> | "all";
type SortOption = NonNullable<OrganizationFileFilters["sort"]>;

function getScanStatusLabel(status: OrganizationFile["scanStatus"]): string {
  return status === "CLEAN" ? "Scanned clean" : "Not scanned — unverified";
}

function saveDownload(file: OrganizationFile, blob: Blob) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = file.originalName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
}

export default function OrganizationFilesView({
  organizationId,
}: {
  organizationId: string;
}) {
  const { getToken } = useAuth();
  const workspace = useOrganizationWorkspace();
  const [files, setFiles] = useState<OrganizationFile[]>([]);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [type, setType] = useState<FileTypeFilter>("all");
  const [scanStatus, setScanStatus] = useState<ScanStatusFilter>("all");
  const [sort, setSort] = useState<SortOption>("recent");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [busyFileId, setBusyFileId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setAppliedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let active = true;

    async function loadFiles() {
      setLoading(true);
      setError(null);
      try {
        const token = await getToken();
        if (!token) throw new Error("Your session expired. Sign in again.");
        const filters: OrganizationFileFilters = {
          page,
          ...(appliedSearch ? { search: appliedSearch } : {}),
          ...(type !== "all" ? { type } : {}),
          ...(scanStatus !== "all" ? { scanStatus } : {}),
          sort,
        };
        const result = await listOrganizationFiles(
          token,
          organizationId,
          filters,
        );
        if (!active) return;
        setFiles((current) =>
          page === 1 ? result.items : [...current, ...result.items],
        );
        setHasMore(result.hasMore);
      } catch (requestError) {
        if (!active) return;
        setError(
          requestError instanceof Error
            ? requestError.message
            : "We couldn’t load organization files.",
        );
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadFiles();
    return () => {
      active = false;
    };
  }, [
    appliedSearch,
    getToken,
    organizationId,
    page,
    retry,
    scanStatus,
    sort,
    type,
  ]);

  function changeFilter(change: () => void) {
    change();
    setPage(1);
    setNotice(null);
    setActionError(null);
  }

  async function download(file: OrganizationFile) {
    setBusyFileId(file.id);
    setActionError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Your session expired. Sign in again.");
      const blob = await fetchFileContent(
        token,
        organizationId,
        file.projectId,
        file,
      );
      saveDownload(file, blob);
    } catch (requestError) {
      setActionError(
        requestError instanceof Error
          ? requestError.message
          : "We couldn’t download this file.",
      );
    } finally {
      setBusyFileId(null);
    }
  }

  async function remove(file: OrganizationFile) {
    if (
      !window.confirm(`Remove “${file.originalName}” from this organization?`)
    ) {
      return;
    }
    setBusyFileId(file.id);
    setActionError(null);
    setNotice(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Your session expired. Sign in again.");
      await removeProjectFile(token, organizationId, file.projectId, file.id);
      setFiles((current) => current.filter((item) => item.id !== file.id));
      setNotice(`${file.originalName} was removed.`);
    } catch (requestError) {
      setActionError(
        requestError instanceof Error
          ? requestError.message
          : "We couldn’t remove this file.",
      );
    } finally {
      setBusyFileId(null);
    }
  }

  return (
    <main className="team-page-shell audit-page-shell organization-files-page">
      <nav className="audit-breadcrumbs" aria-label="Breadcrumb">
        <Link href={organizationDashboardPath(organizationId)}>Home</Link>
        <Icon name="chevron-right" width={13} height={13} />
        <span>{workspace?.name ?? "Organization"}</span>
        <Icon name="chevron-right" width={13} height={13} />
        <span aria-current="page">Files</span>
      </nav>

      <header className="audit-page-header">
        <div>
          <span className="audit-page-kicker">
            <Icon name="file" width={14} height={14} />
            {workspace?.name ?? "Current organization"}
          </span>
          <h1>Files</h1>
          <p>
            Find and manage files from projects you’re authorized to access.
            Downloads and removals are checked by the API.
          </p>
        </div>
      </header>

      <aside className="files-security-note" role="note">
        <Icon name="info" width={17} height={17} />
        <p>
          Files being scanned remain in private quarantine and are not listed or
          downloadable until scanning finishes. “Not scanned” files are
          unverified and should not be treated as safe.
        </p>
      </aside>

      <section
        className="file-panel files-library-panel"
        aria-label="Organization files"
      >
        <div className="files-filter-grid">
          <label className="files-search">
            <span>Search files</span>
            <span className="files-search-input">
              <Icon name="search" width={16} height={16} />
              <input
                type="search"
                value={search}
                onChange={(event) =>
                  changeFilter(() => {
                    setSearch(event.currentTarget.value);
                  })
                }
                placeholder="Search by file name"
              />
            </span>
          </label>
          <label>
            <span>File type</span>
            <select
              value={type}
              onChange={(event) =>
                changeFilter(() =>
                  setType(event.currentTarget.value as FileTypeFilter),
                )
              }
            >
              <option value="all">All types</option>
              <option value="images">Images</option>
              <option value="documents">Documents</option>
              <option value="text">Text files</option>
            </select>
          </label>
          <label>
            <span>Scan status</span>
            <select
              value={scanStatus}
              onChange={(event) =>
                changeFilter(() =>
                  setScanStatus(event.currentTarget.value as ScanStatusFilter),
                )
              }
            >
              <option value="all">All scan states</option>
              <option value="CLEAN">Scanned clean</option>
              <option value="UNSCANNED">Not scanned</option>
            </select>
          </label>
          <label>
            <span>Sort by</span>
            <select
              value={sort}
              onChange={(event) =>
                changeFilter(() =>
                  setSort(event.currentTarget.value as SortOption),
                )
              }
            >
              <option value="recent">Newest first</option>
              <option value="name">Name</option>
              <option value="size">Largest first</option>
            </select>
          </label>
        </div>

        {notice && (
          <p className="file-panel-notice" role="status">
            {notice}
          </p>
        )}
        {actionError && (
          <p className="file-panel-error" role="alert">
            {actionError}
          </p>
        )}
        {error && (
          <div className="files-load-error" role="alert">
            <p>{error}</p>
            <button
              className="secondary-button"
              onClick={() => setRetry((value) => value + 1)}
              type="button"
            >
              Try again
            </button>
          </div>
        )}
        {loading && files.length === 0 && (
          <p className="file-panel-state" role="status">
            Loading files…
          </p>
        )}
        {!loading && !error && files.length === 0 && (
          <div className="files-empty-state">
            <span className="file-empty-icon" aria-hidden="true">
              <Icon name="file" width={19} height={19} />
            </span>
            <h2>
              {search || type !== "all" || scanStatus !== "all"
                ? "No matching files"
                : "No files yet"}
            </h2>
            <p>
              {search || type !== "all" || scanStatus !== "all"
                ? "Try changing or clearing your filters."
                : "Files uploaded to projects you can access will appear here."}
            </p>
          </div>
        )}
        {files.length > 0 && (
          <ul className="files-library-list">
            {files.map((file) => (
              <li className="files-library-item" key={file.id}>
                <span className="file-type-mark" aria-hidden="true">
                  {file.mimeType === "application/pdf"
                    ? "PDF"
                    : file.mimeType.startsWith("image/")
                      ? "IMG"
                      : "FILE"}
                </span>
                <div className="files-library-info">
                  <strong title={file.originalName}>{file.originalName}</strong>
                  <span>
                    {formatFileType(file.mimeType)} ·{" "}
                    {formatFileSize(file.sizeBytes)}
                    {" · "}
                    {formatFileDate(file.uploadedAt)}
                  </span>
                  <span>
                    Uploaded by {file.uploaderName} · {file.projectName}
                    {file.taskTitle ? ` · ${file.taskTitle}` : ""}
                  </span>
                </div>
                <span
                  className={`files-scan-status${file.scanStatus === "CLEAN" ? " is-clean" : " is-unscanned"}`}
                  title={
                    file.scanStatus === "CLEAN"
                      ? "The configured scanner reported this file clean."
                      : "This file has not been scanned."
                  }
                >
                  {getScanStatusLabel(file.scanStatus)}
                </span>
                <div className="file-list-actions">
                  <button
                    className="file-action-button"
                    disabled={busyFileId === file.id}
                    onClick={() => void download(file)}
                    type="button"
                  >
                    {busyFileId === file.id ? "Working…" : "Download"}
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
        )}
        {hasMore && (
          <button
            className="secondary-button file-load-more"
            disabled={loading}
            onClick={() => setPage((value) => value + 1)}
            type="button"
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        )}
      </section>
    </main>
  );
}
