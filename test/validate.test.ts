import { describe, expect, it } from "vitest";
import { acceptToInputAttr, DEFAULT_ACCEPT, validateFile } from "../src/react/validate";

function makeFile(name: string, type: string, bytes = 1000): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

describe("validateFile", () => {
  it("accepts a valid image with no constraints", () => {
    expect(validateFile(makeFile("a.jpg", "image/jpeg"))).toBeNull();
  });

  it("rejects files over maxSize with file-too-large", () => {
    const error = validateFile(makeFile("big.jpg", "image/jpeg", 5000), undefined, 4000);
    expect(error).toMatchObject({ name: "ImageTurboError", code: "file-too-large" });
  });

  it("matches wildcard mime patterns", () => {
    expect(validateFile(makeFile("a.png", "image/png"), DEFAULT_ACCEPT)).toBeNull();
    expect(validateFile(makeFile("a.pdf", "application/pdf"), DEFAULT_ACCEPT)).toMatchObject({
      code: "invalid-type",
    });
  });

  it("matches exact mime types", () => {
    const accept = { "image/webp": [] };
    expect(validateFile(makeFile("a.webp", "image/webp"), accept)).toBeNull();
    expect(validateFile(makeFile("a.png", "image/png"), accept)).toMatchObject({
      code: "invalid-type",
    });
  });

  it("falls back to case-insensitive extension matching when the mime is missing", () => {
    const accept = { "image/heic": [".heic"] };
    expect(validateFile(makeFile("IMG_0001.HEIC", ""), accept)).toBeNull();
    expect(validateFile(makeFile("doc.txt", ""), accept)).toMatchObject({ code: "invalid-type" });
  });

  it("checks size before type so the more actionable error wins", () => {
    const error = validateFile(makeFile("big.pdf", "application/pdf", 5000), DEFAULT_ACCEPT, 4000);
    expect(error).toMatchObject({ code: "file-too-large" });
  });
});

describe("acceptToInputAttr", () => {
  it("defaults to image/*", () => {
    expect(acceptToInputAttr()).toBe("image/*");
  });

  it("flattens mime keys and extensions", () => {
    expect(acceptToInputAttr({ "image/*": [".png", ".jpg"], "image/heic": [".heic"] })).toBe(
      "image/*,.png,.jpg,image/heic,.heic",
    );
  });
});
