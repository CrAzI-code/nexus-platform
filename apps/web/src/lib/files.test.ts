import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatFileDate,
  formatFileSize,
  formatFileType,
  listOrganizationFiles,
} from "./files";

describe("organization file API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests only metadata with validated filters and no-store authorization", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              id: "file-id",
              projectId: "project-id",
              taskId: null,
              originalName: "budget.pdf",
              mimeType: "application/pdf",
              sizeBytes: 1200,
              scanStatus: "CLEAN",
              uploadedAt: "2026-03-01T10:00:00.000Z",
              uploaderName: "Alex",
              canPreview: true,
              canRemove: false,
              projectName: "Planning",
              taskTitle: null,
            },
          ],
          page: 1,
          pageSize: 25,
          hasMore: false,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      listOrganizationFiles("session-token", "org/123", {
        page: 1,
        search: "budget",
        type: "documents",
        scanStatus: "CLEAN",
        sort: "name",
      }),
    ).resolves.toMatchObject({
      items: [{ originalName: "budget.pdf", projectName: "Planning" }],
      hasMore: false,
    });

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(
      "/organizations/org%2F123/files?page=1&pageSize=25&search=budget&type=documents&scanStatus=CLEAN&sort=name",
    );
    expect(options).toMatchObject({
      cache: "no-store",
      headers: { Authorization: "Bearer session-token" },
    });
    expect(url).not.toContain("storageKey");
  });

  it("rejects unexpected file-list metadata instead of accepting storage identifiers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            items: [{ id: "file-id", storageKey: "private-object-key" }],
            page: 1,
            pageSize: 25,
            hasMore: false,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(
      listOrganizationFiles("session-token", "org-id", { page: 1 }),
    ).rejects.toThrow("unexpected organization file list");
  });
});

describe("file presentation helpers", () => {
  it("formats file sizes using readable units", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1024)).toMatch(/1(\.0)? KB/u);
    expect(formatFileSize(1_048_576)).toMatch(/1(\.0)? MB/u);
    expect(formatFileSize(Number.NaN)).toBe("Unknown size");
  });

  it("formats valid upload times and handles invalid timestamps", () => {
    expect(formatFileDate("2026-11-02T18:00:00.000Z")).not.toBe("Unknown date");
    expect(formatFileDate("not-a-date")).toBe("Unknown date");
  });

  it("uses readable labels for supported file types", () => {
    expect(formatFileType("application/pdf")).toBe("PDF");
    expect(formatFileType("image/webp")).toBe("WebP image");
    expect(formatFileType("text/csv")).toBe("CSV");
    expect(formatFileType("application/unknown")).toBe("File");
  });
});
