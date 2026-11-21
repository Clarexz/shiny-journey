import { defineProject } from "vitest/config";
import { baseTestOptions } from "@ravyn/config/vitest";

export default defineProject({ test: { name: "core", ...baseTestOptions } });
