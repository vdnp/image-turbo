import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { useImageTurbo, type UploadContext, type UploadFn } from "../src/react/use-image-turbo";
import { createMockImageFile } from "./fixtures";

afterEach(cleanup);

function makeDropEvent(...files: File[]) {
  return {
    preventDefault: vi.fn(),
    defaultPrevented: false,
    dataTransfer: { files, dropEffect: "" },
  } as unknown as React.DragEvent<HTMLElement>;
}

function makeDragEvent() {
  return makeDropEvent();
}

/** An upload that never settles until told to, exposing its context for assertions. */
function deferredUpload<T = unknown>() {
  let context: UploadContext | undefined;
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const upload: UploadFn<T> = vi.fn((_file, ctx) => {
    context = ctx;
    return new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
  });
  return {
    upload,
    get context() {
      return context;
    },
    resolve: (value: T) => resolve(value),
    reject: (error: unknown) => reject(error),
  };
}

describe("useImageTurbo", () => {
  it("starts idle with accessible root props and a hidden single-file input", () => {
    const { result } = renderHook(() => useImageTurbo());

    expect(result.current.status).toBe("idle");
    expect(result.current.previewUrl).toBeNull();

    const root = result.current.getRootProps();
    expect(root.role).toBe("button");
    expect(root.tabIndex).toBe(0);

    const input = result.current.getInputProps();
    expect(input).toMatchObject({
      type: "file",
      accept: "image/*",
      multiple: false,
      tabIndex: -1,
    });
    expect(input.style).toMatchObject({ display: "none" });
  });

  it("shows an optimistic preview synchronously, then compresses to success", async () => {
    const onDrop = vi.fn();
    const onCompressed = vi.fn();
    const onSuccess = vi.fn();
    const file = createMockImageFile({ name: "pic.jpg", width: 4000, height: 3000, bytes: 10_000_000 });

    const { result } = renderHook(() =>
      useImageTurbo({ maxWidth: 1920, onDrop, onCompressed, onSuccess }),
    );

    act(() => {
      result.current.getRootProps().onDrop!(makeDropEvent(file));
    });

    // preview must exist before compression finishes — the optimistic UI contract
    expect(result.current.status).toBe("compressing");
    expect(result.current.isCompressing).toBe(true);
    expect(result.current.previewUrl).toMatch(/^blob:mock\//);
    expect(result.current.originalFile).toBe(file);
    expect(onDrop).toHaveBeenCalledWith(file);

    await waitFor(() => expect(result.current.status).toBe("success"));

    expect(result.current.file?.type).toBe("image/webp");
    expect(result.current.file?.name).toBe("pic.webp");
    expect(result.current.progress).toBe(100);
    expect(result.current.stats?.width).toBe(1920);
    expect(onCompressed).toHaveBeenCalledWith(result.current.file, result.current.stats);
    expect(onSuccess).toHaveBeenCalledWith(undefined, result.current.file);
  });

  it("revokes the previous preview URL when a new file is dropped", async () => {
    const { result } = renderHook(() => useImageTurbo());
    const first = createMockImageFile({ name: "one.jpg" });
    const second = createMockImageFile({ name: "two.jpg" });

    act(() => {
      result.current.getRootProps().onDrop!(makeDropEvent(first));
    });
    const firstUrl = result.current.previewUrl;
    await waitFor(() => expect(result.current.status).toBe("success"));

    act(() => {
      result.current.getRootProps().onDrop!(makeDropEvent(second));
    });

    expect(URL.revokeObjectURL).toHaveBeenCalledWith(firstUrl);
    expect(result.current.previewUrl).not.toBe(firstUrl);
    await waitFor(() => expect(result.current.status).toBe("success"));
  });

  it("runs the full upload flow: weighted progress, result, callbacks", async () => {
    const deferred = deferredUpload<{ key: string }>();
    const onSuccess = vi.fn();
    const file = createMockImageFile({ bytes: 5_000_000, width: 2000, height: 2000 });

    const { result } = renderHook(() => useImageTurbo({ upload: deferred.upload, onSuccess }));

    act(() => {
      result.current.getRootProps().onDrop!(makeDropEvent(file));
    });
    await waitFor(() => expect(result.current.status).toBe("uploading"));

    // the upload fn receives the compressed file, not the original
    const uploadedFile = (deferred.upload as unknown as Mock).mock.calls[0]?.[0] as File;
    expect(uploadedFile.type).toBe("image/webp");
    expect(result.current.progress).toBe(30); // compression phase complete

    act(() => deferred.context!.onProgress(0.5));
    expect(result.current.progress).toBe(65); // 30 + 0.5 * 70

    await act(async () => deferred.resolve({ key: "uploads/abc" }));
    await waitFor(() => expect(result.current.status).toBe("success"));

    expect(result.current.progress).toBe(100);
    expect(result.current.result).toEqual({ key: "uploads/abc" });
    expect(onSuccess).toHaveBeenCalledWith({ key: "uploads/abc" }, uploadedFile);
  });

  it("surfaces upload failures as upload-failed errors", async () => {
    const deferred = deferredUpload();
    const onError = vi.fn();
    const file = createMockImageFile();

    const { result } = renderHook(() => useImageTurbo({ upload: deferred.upload, onError }));

    act(() => {
      result.current.getRootProps().onDrop!(makeDropEvent(file));
    });
    await waitFor(() => expect(result.current.status).toBe("uploading"));

    await act(async () => deferred.reject(new Error("503 from bucket")));
    await waitFor(() => expect(result.current.status).toBe("error"));

    expect(result.current.error).toMatchObject({ code: "upload-failed", message: "503 from bucket" });
    expect(onError).toHaveBeenCalledWith(result.current.error);
    // preview kept for retry UIs
    expect(result.current.previewUrl).toMatch(/^blob:mock\//);
  });

  it("rejects oversized files before compression and clears stale previews", async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useImageTurbo({ maxSize: 1_000_000, onError }));

    const good = createMockImageFile({ bytes: 500_000 });
    act(() => {
      result.current.getRootProps().onDrop!(makeDropEvent(good));
    });
    const goodUrl = result.current.previewUrl;
    await waitFor(() => expect(result.current.status).toBe("success"));

    const decodeCallsBefore = (globalThis.createImageBitmap as unknown as Mock).mock.calls.length;
    const huge = createMockImageFile({ bytes: 2_000_000 });
    act(() => {
      result.current.getRootProps().onDrop!(makeDropEvent(huge));
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error?.code).toBe("file-too-large");
    expect(result.current.previewUrl).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(goodUrl);
    expect(onError).toHaveBeenCalledTimes(1);
    // the invalid file was never decoded
    expect((globalThis.createImageBitmap as unknown as Mock).mock.calls.length).toBe(decodeCallsBefore);
  });

  it("rejects non-image files with invalid-type by default", () => {
    const { result } = renderHook(() => useImageTurbo());
    const pdf = new File([new Uint8Array(100)], "doc.pdf", { type: "application/pdf" });

    act(() => {
      result.current.getRootProps().onDrop!(makeDropEvent(pdf));
    });

    expect(result.current.error?.code).toBe("invalid-type");
  });

  it("abort() cancels the upload signal but keeps the compressed file", async () => {
    const deferred = deferredUpload();
    const file = createMockImageFile();

    const { result } = renderHook(() => useImageTurbo({ upload: deferred.upload }));

    act(() => {
      result.current.getRootProps().onDrop!(makeDropEvent(file));
    });
    await waitFor(() => expect(result.current.status).toBe("uploading"));

    act(() => result.current.abort());

    expect(deferred.context?.signal.aborted).toBe(true);
    expect(result.current.status).toBe("idle");
    expect(result.current.file?.type).toBe("image/webp");
    expect(result.current.previewUrl).toMatch(/^blob:mock\//);
    expect(result.current.error).toBeNull();
  });

  it("a new drop aborts the previous in-flight upload", async () => {
    const deferred = deferredUpload();
    const file = createMockImageFile({ name: "one.jpg" });
    const replacement = createMockImageFile({ name: "two.jpg" });

    const { result } = renderHook(() => useImageTurbo({ upload: deferred.upload }));

    act(() => {
      result.current.getRootProps().onDrop!(makeDropEvent(file));
    });
    await waitFor(() => expect(result.current.status).toBe("uploading"));
    const firstSignal = deferred.context!.signal;

    act(() => {
      result.current.getRootProps().onDrop!(makeDropEvent(replacement));
    });

    expect(firstSignal.aborted).toBe(true);
    expect(result.current.status).toBe("compressing");
    expect(result.current.originalFile?.name).toBe("two.jpg");
    await waitFor(() => expect(result.current.status).toBe("uploading"));
  });

  it("reset() aborts, revokes the preview and returns to a clean idle", async () => {
    const deferred = deferredUpload();
    const file = createMockImageFile();
    const { result } = renderHook(() => useImageTurbo({ upload: deferred.upload }));

    act(() => {
      result.current.getRootProps().onDrop!(makeDropEvent(file));
    });
    await waitFor(() => expect(result.current.status).toBe("uploading"));
    const url = result.current.previewUrl;

    act(() => result.current.reset());

    expect(result.current).toMatchObject({
      status: "idle",
      previewUrl: null,
      file: null,
      originalFile: null,
      error: null,
      progress: 0,
    });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
    expect(deferred.context?.signal.aborted).toBe(true);
  });

  it("tracks drag depth so child enter/leave events do not flicker isDragActive", () => {
    const { result } = renderHook(() => useImageTurbo());

    act(() => {
      result.current.getRootProps().onDragEnter!(makeDragEvent());
      result.current.getRootProps().onDragEnter!(makeDragEvent()); // entered a child
    });
    expect(result.current.isDragActive).toBe(true);

    act(() => {
      result.current.getRootProps().onDragLeave!(makeDragEvent()); // left the child
    });
    expect(result.current.isDragActive).toBe(true);

    act(() => {
      result.current.getRootProps().onDragLeave!(makeDragEvent());
    });
    expect(result.current.isDragActive).toBe(false);
  });

  it("accepts files from the input's onChange and clears the value for re-selection", async () => {
    const file = createMockImageFile();
    const { result } = renderHook(() => useImageTurbo());

    const target = { files: [file], value: "C:\\fakepath\\photo.jpg" };
    act(() => {
      result.current.getInputProps().onChange!({
        preventDefault: vi.fn(),
        defaultPrevented: false,
        target,
      } as unknown as React.ChangeEvent<HTMLInputElement>);
    });

    expect(target.value).toBe("");
    await waitFor(() => expect(result.current.status).toBe("success"));
  });

  it("ignores drops and picker opens while disabled", () => {
    const { result } = renderHook(() => useImageTurbo({ disabled: true }));
    const file = createMockImageFile();

    expect(result.current.getRootProps().tabIndex).toBe(-1);

    act(() => {
      result.current.getRootProps().onDragEnter!(makeDragEvent());
      result.current.getRootProps().onDrop!(makeDropEvent(file));
    });

    expect(result.current.isDragActive).toBe(false);
    expect(result.current.status).toBe("idle");
    expect(globalThis.createImageBitmap).not.toHaveBeenCalled();
  });

  it("cleans up on unmount: aborts in-flight work and revokes the preview URL", async () => {
    const deferred = deferredUpload();
    const file = createMockImageFile();
    const { result, unmount } = renderHook(() => useImageTurbo({ upload: deferred.upload }));

    act(() => {
      result.current.getRootProps().onDrop!(makeDropEvent(file));
    });
    await waitFor(() => expect(result.current.status).toBe("uploading"));
    const url = result.current.previewUrl;

    unmount();

    expect(deferred.context?.signal.aborted).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
  });

  it("survives React Strict Mode double-mounting without leaking or double-revoking", async () => {
    const file = createMockImageFile();
    const { result, unmount } = renderHook(() => useImageTurbo(), { wrapper: StrictMode });

    // pipeline still works after the mount -> unmount -> mount cycle
    act(() => {
      result.current.getRootProps().onDrop!(makeDropEvent(file));
    });
    await waitFor(() => expect(result.current.status).toBe("success"));
    const url = result.current.previewUrl;

    unmount();

    const revokeCalls = (URL.revokeObjectURL as unknown as Mock).mock.calls;
    expect(revokeCalls.filter((call) => call[0] === url)).toHaveLength(1);
    expect(revokeCalls.filter((call) => call[0] == null)).toHaveLength(0);
  });

  it("wires click and keyboard activation to the hidden input in the DOM", () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});

    function Dropzone() {
      const { getRootProps, getInputProps } = useImageTurbo();
      return (
        <div data-testid="root" {...getRootProps()}>
          <input data-testid="input" {...getInputProps()} />
        </div>
      );
    }
    render(<Dropzone />);
    const root = screen.getByTestId("root");

    fireEvent.click(root);
    expect(clickSpy).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(root, { key: "Enter" });
    fireEvent.keyDown(root, { key: " " });
    expect(clickSpy).toHaveBeenCalledTimes(3);

    // a click on the input itself must not bubble to the root and re-open the picker
    fireEvent.click(screen.getByTestId("input"));
    expect(clickSpy).toHaveBeenCalledTimes(3);

    clickSpy.mockRestore();
  });
});
