export type FileAttachment = {
  id: string;
  projectId: string;
  taskId: string | null;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  uploaderName: string;
  canPreview: boolean;
  canRemove: boolean;
};

export type FileAttachmentPage = {
  items: FileAttachment[];
  page: number;
  pageSize: number;
  hasMore: boolean;
  canUpload: boolean;
};

export type UploadProgress = (percentage: number) => void;

const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const pageSize = 25;

export class FileApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "FileApiError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFileAttachment(value: unknown): value is FileAttachment {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.projectId === "string" &&
    (typeof value.taskId === "string" || value.taskId === null) &&
    typeof value.originalName === "string" &&
    typeof value.mimeType === "string" &&
    typeof value.sizeBytes === "number" &&
    Number.isSafeInteger(value.sizeBytes) &&
    value.sizeBytes > 0 &&
    typeof value.uploadedAt === "string" &&
    typeof value.uploaderName === "string" &&
    typeof value.canPreview === "boolean" &&
    typeof value.canRemove === "boolean"
  );
}

function isFilePage(value: unknown): value is FileAttachmentPage {
  return (
    isRecord(value) &&
    Array.isArray(value.items) &&
    value.items.every(isFileAttachment) &&
    typeof value.page === "number" &&
    typeof value.pageSize === "number" &&
    typeof value.hasMore === "boolean" &&
    typeof value.canUpload === "boolean"
  );
}

function errorMessage(status: number): string {
  if (status === 400) {
    return "The file request was invalid. Check the file type and try again.";
  }
  if (status === 401) return "Your session expired. Sign in again.";
  if (status === 403) {
    return "You don’t have permission to access or change files in this project.";
  }
  if (status === 404) return "This file or project is no longer available.";
  if (status === 409) return "The project or task can no longer accept file changes.";
  if (status === 413) return "This file is larger than the upload limit.";
  return "We couldn’t complete the file request. Please try again.";
}

function projectFilesPath(
  organizationId: string,
  projectId: string,
): string {
  return `/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/files`;
}

function listPath(
  organizationId: string,
  projectId: string,
  taskId: string | undefined,
  page: number,
): string {
  const path = taskId
    ? `${projectFilesPath(organizationId, projectId).replace(/\/files$/u, "")}/tasks/${encodeURIComponent(taskId)}/attachments`
    : projectFilesPath(organizationId, projectId);
  return `${path}?page=${page}&pageSize=${pageSize}`;
}

async function fetchApi(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`${apiBaseUrl}${path}`, init);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error("NEXUS couldn’t reach the API. Check your connection.");
    }
    throw error;
  }
}

async function readFilePage(response: Response): Promise<FileAttachmentPage> {
  if (!response.ok) throw new FileApiError(errorMessage(response.status), response.status);
  const payload: unknown = await response.json();
  if (!isFilePage(payload)) {
    throw new Error("The server returned an unexpected file list.");
  }
  return payload;
}

export async function listProjectFiles(
  token: string,
  organizationId: string,
  projectId: string,
  page = 1,
): Promise<FileAttachmentPage> {
  return readFilePage(
    await fetchApi(listPath(organizationId, projectId, undefined, page), {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    }),
  );
}

export async function listTaskAttachments(
  token: string,
  organizationId: string,
  projectId: string,
  taskId: string,
  page = 1,
): Promise<FileAttachmentPage> {
  return readFilePage(
    await fetchApi(listPath(organizationId, projectId, taskId, page), {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    }),
  );
}

export function uploadProjectFile(
  token: string,
  organizationId: string,
  projectId: string,
  file: File,
  onProgress: UploadProgress,
): Promise<FileAttachment> {
  return uploadFile(
    token,
    projectFilesPath(organizationId, projectId),
    file,
    onProgress,
  );
}

export function uploadTaskAttachment(
  token: string,
  organizationId: string,
  projectId: string,
  taskId: string,
  file: File,
  onProgress: UploadProgress,
): Promise<FileAttachment> {
  const path = `${projectFilesPath(organizationId, projectId).replace(/\/files$/u, "")}/tasks/${encodeURIComponent(taskId)}/attachments`;
  return uploadFile(token, path, file, onProgress);
}

export async function removeProjectFile(
  token: string,
  organizationId: string,
  projectId: string,
  fileId: string,
): Promise<void> {
  const response = await fetchApi(
    `${projectFilesPath(organizationId, projectId)}/${encodeURIComponent(fileId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!response.ok) {
    throw new FileApiError(errorMessage(response.status), response.status);
  }
}

export async function fetchFileContent(
  token: string,
  organizationId: string,
  projectId: string,
  file: FileAttachment,
  inline = false,
): Promise<Blob> {
  const response = await fetchApi(
    `${projectFilesPath(organizationId, projectId)}/${encodeURIComponent(file.id)}/content?disposition=${inline ? "inline" : "attachment"}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw new FileApiError(errorMessage(response.status), response.status);
  }
  const blob = await response.blob();
  if (blob.type !== file.mimeType || blob.size !== file.sizeBytes) {
    throw new Error("The downloaded file did not match its saved metadata.");
  }
  return blob;
}

function uploadFile(
  token: string,
  path: string,
  file: File,
  onProgress: UploadProgress,
): Promise<FileAttachment> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `${apiBaseUrl}${path}`);
    request.setRequestHeader("Authorization", `Bearer ${token}`);
    request.timeout = 120_000;
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
      }
    };
    request.onerror = () => reject(new Error("Upload failed. Check your connection."));
    request.ontimeout = () => reject(new Error("Upload timed out. Please try again."));
    request.onload = () => {
      if (request.status < 200 || request.status >= 300) {
        reject(new FileApiError(errorMessage(request.status), request.status));
        return;
      }

      try {
        const payload: unknown = JSON.parse(request.responseText);
        if (!isFileAttachment(payload)) {
          throw new Error("The server returned unexpected file metadata.");
        }
        resolve(payload);
      } catch (error) {
        reject(
          error instanceof Error
            ? error
            : new Error("The server returned unexpected file metadata."),
        );
      }
    };

    const body = new FormData();
    body.append("file", file);
    request.send(body);
  });
}

export function formatFileSize(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) return "Unknown size";
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = sizeBytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1,
  }).format(value)} ${units[unitIndex]}`;
}

export function formatFileType(mimeType: string): string {
  switch (mimeType) {
    case "application/pdf":
      return "PDF";
    case "image/png":
      return "PNG image";
    case "image/jpeg":
      return "JPEG image";
    case "image/webp":
      return "WebP image";
    case "text/plain":
      return "Text file";
    case "text/csv":
      return "CSV";
    default:
      return "File";
  }
}

export function formatFileDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unknown date";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
