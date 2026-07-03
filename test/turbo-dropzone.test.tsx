import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatBytes, TurboDropzone } from "../src/react/turbo-dropzone";
import type { UploadContext, UploadFn } from "../src/react/use-image-turbo";
import { createMockImageFile } from "./fixtures";

afterEach(cleanup);

function dropFile(element: HTMLElement, file: File) {
  fireEvent.drop(element, { dataTransfer: { files: [file], dropEffect: "" } });
}

function getRoot(): HTMLElement {
  return document.querySelector(".it-dropzone") as HTMLElement;
}

describe("formatBytes", () => {
  it("formats byte counts at sensible precision", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(221_184)).toBe("216 KB");
    expect(formatBytes(10_000_000)).toBe("9.5 MB");
  });
});

describe("TurboDropzone", () => {
  it("renders the idle state: icon, label, description, hidden input", () => {
    render(<TurboDropzone label="Add a photo" description="PNG or JPG up to 20MB" />);

    expect(screen.getByText("Add a photo")).toBeTruthy();
    expect(screen.getByText("PNG or JPG up to 20MB")).toBeTruthy();

    const root = getRoot();
    expect(root.dataset.status).toBe("idle");
    expect(root.querySelector("svg.it-icon")).toBeTruthy();

    const input = root.querySelector("input") as HTMLInputElement;
    expect(input.type).toBe("file");
    expect(input.style.display).toBe("none");
  });

  it("shows the optimistic preview and stats line through a compression run", async () => {
    const file = createMockImageFile({
      name: "holiday.jpg",
      width: 4000,
      height: 3000,
      bytes: 10_000_000,
    });
    render(<TurboDropzone maxWidth={1920} />);
    const root = getRoot();

    dropFile(root, file);

    // optimistic preview before compression settles
    const preview = root.querySelector("img.it-preview") as HTMLImageElement;
    expect(preview.src).toMatch(/^blob:mock\//);
    expect(root.dataset.status).toBe("compressing");
    // indeterminate progress while compressing
    expect(root.querySelector(".it-progress")?.getAttribute("data-indeterminate")).toBe("true");

    await waitFor(() => expect(root.dataset.status).toBe("success"));
    // 10,000,000 B → 221,184 B under the mock encoder
    expect(screen.getByText("9.5 MB → 216 KB (98% smaller)")).toBeTruthy();
    expect(root.querySelector(".it-progress")).toBeNull();
  });

  it("animates determinate progress during the upload phase", async () => {
    let context: UploadContext | undefined;
    const upload: UploadFn = vi.fn((_file, ctx) => {
      context = ctx;
      return new Promise(() => {}); // never settles — we drive progress manually
    });
    const file = createMockImageFile({ bytes: 5_000_000 });

    render(<TurboDropzone upload={upload} />);
    const root = getRoot();
    dropFile(root, file);

    await waitFor(() => expect(root.dataset.status).toBe("uploading"));
    const progressbar = () => root.querySelector('[role="progressbar"]') as HTMLElement;
    expect(progressbar().getAttribute("aria-valuenow")).toBe("30");

    act(() => context!.onProgress(0.5));

    expect(progressbar().getAttribute("aria-valuenow")).toBe("65");
    const bar = root.querySelector(".it-progress-bar") as HTMLElement;
    expect(bar.style.width).toBe("65%");
  });

  it("shows a muted error line with retry hint for invalid files", async () => {
    render(<TurboDropzone />);
    const root = getRoot();
    const pdf = new File([new Uint8Array(100)], "doc.pdf", { type: "application/pdf" });

    dropFile(root, pdf);

    await waitFor(() => expect(root.dataset.status).toBe("error"));
    expect(root.querySelector(".it-error")?.textContent).toContain("not an accepted file type");
    expect(screen.getByText("Click or drop a file to try again")).toBeTruthy();
    expect(root.querySelector("img.it-preview")).toBeNull();
  });

  it("reset button clears the zone without reopening the file picker", async () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    const file = createMockImageFile();
    render(<TurboDropzone label="Drop it" />);
    const root = getRoot();

    dropFile(root, file);
    await waitFor(() => expect(root.dataset.status).toBe("success"));

    fireEvent.click(screen.getByLabelText("Remove image"));

    expect(root.dataset.status).toBe("idle");
    expect(screen.getByText("Drop it")).toBeTruthy();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
    expect(clickSpy).not.toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it("marks drag-over state via the data attribute", () => {
    render(<TurboDropzone />);
    const root = getRoot();

    fireEvent.dragEnter(root, { dataTransfer: { files: [] } });
    expect(root.dataset.dragActive).toBe("true");

    fireEvent.dragLeave(root, { dataTransfer: { files: [] } });
    expect(root.dataset.dragActive).toBeUndefined();
  });

  it("hides the stats line when showStats is false", async () => {
    const file = createMockImageFile({ bytes: 10_000_000, width: 4000, height: 3000 });
    render(<TurboDropzone showStats={false} />);
    const root = getRoot();

    dropFile(root, file);
    await waitFor(() => expect(root.dataset.status).toBe("success"));

    expect(root.querySelector(".it-stats")).toBeNull();
    // the remove button is still there
    expect(screen.getByLabelText("Remove image")).toBeTruthy();
  });

  it("merges a custom className onto the root", () => {
    render(<TurboDropzone className="my-zone" />);
    const root = getRoot();
    expect(root.classList.contains("it-dropzone")).toBe(true);
    expect(root.classList.contains("my-zone")).toBe(true);
  });

  it("announces status changes politely for screen readers", async () => {
    const file = createMockImageFile();
    render(<TurboDropzone />);
    const root = getRoot();
    const live = root.querySelector('[aria-live="polite"]') as HTMLElement;

    dropFile(root, file);
    expect(live.textContent).toBe("Compressing image…");

    await waitFor(() => expect(live.textContent).toBe("Image ready."));
  });
});
