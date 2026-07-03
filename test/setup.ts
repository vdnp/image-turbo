import { beforeEach } from "vitest";
import { installCanvasMocks, resetMockState } from "./canvas-mock";
import { resetFeatureDetectionCache } from "../src/core/feature-detect";

installCanvasMocks();

beforeEach(() => {
  resetMockState();
  resetFeatureDetectionCache();
});
