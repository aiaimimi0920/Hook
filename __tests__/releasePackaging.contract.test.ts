import { describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

describe("Hook release packaging contract", () => {
  test("canonical release script keeps Hook payload under release/Hook/<VersionId>", () => {
    const repoRoot = path.resolve(__dirname, "..", "..");
    const scriptPath = path.join(repoRoot, "scripts", "build-release-exes.ps1");
    const raw = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
        "-Apps",
        "Hook",
        "-VersionId",
        "hook-plan-contract",
        "-DryRun",
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
      },
    );

    const plan = JSON.parse(raw) as {
      releaseRoot: string;
      apps: Array<{
        app: string;
        destination: string;
        payloadVariants?: Array<{
          name: string;
          destination: string;
          exes: Array<{ destinationRelativePath: string }>;
          supportFiles: Array<{ destinationRelativePath: string }>;
          zip: boolean;
        }>;
      }>;
    };

    expect(plan.releaseRoot.replace(/\\/g, "/")).toMatch(/\/release$/);
    expect(plan.apps).toHaveLength(1);
    expect(plan.apps[0]?.app).toBe("Hook");
    expect(plan.apps[0]?.destination.replace(/\\/g, "/")).toMatch(
      /\/release\/Hook\/hook-plan-contract$/,
    );
    expect(plan.apps[0]?.payloadVariants?.map((item) => item.name)).toEqual(["minimal", "full"]);
    expect(
      plan.apps[0]?.payloadVariants?.[0]?.destination.replace(/\\/g, "/"),
    ).toMatch(/\/release\/Hook\/hook-plan-contract\/minimal$/);
    expect(
      plan.apps[0]?.payloadVariants?.[1]?.destination.replace(/\\/g, "/"),
    ).toMatch(/\/release\/Hook\/hook-plan-contract\/full$/);
    expect(
      plan.apps[0]?.payloadVariants?.[0]?.exes.some(
        (item) => item.destinationRelativePath === "hook.exe",
      ),
    ).toBe(true);
    expect(plan.apps[0]?.payloadVariants?.[0]?.supportFiles).toEqual([]);
    expect(
      plan.apps[0]?.payloadVariants?.[1]?.exes.some(
        (item) => item.destinationRelativePath === "hook.exe",
      ),
    ).toBe(true);
    expect(
      plan.apps[0]?.payloadVariants?.[1]?.supportFiles.some(
        (item) => item.destinationRelativePath === "start-hook.bat",
      ),
    ).toBe(true);
    expect(
      plan.apps[0]?.payloadVariants?.[1]?.supportFiles.some(
        (item) => item.destinationRelativePath === "start-hook.vbs",
      ),
    ).toBe(true);
  }, 20000);

  test("build-hook-release.bat delegates to the canonical package script", () => {
    const repoRoot = path.resolve(__dirname, "..", "..");
    const batchPath = path.join(repoRoot, "Hook", "build-hook-release.bat");
    const script = fs.readFileSync(batchPath, "utf8");

    expect(script).toMatch(/package-hook-release\.ps1/i);
    expect(script).not.toMatch(/npm run tauri build -- --no-bundle/i);
    expect(script).not.toMatch(/src-tauri\\target\\release\\hook\.exe/i);
  });

  test("start-hook.bat delegates to the hidden launcher instead of doing PowerShell polling itself", () => {
    const repoRoot = path.resolve(__dirname, "..", "..");
    const batchPath = path.join(repoRoot, "Hook", "start-hook.bat");
    const script = fs.readFileSync(batchPath, "utf8");

    expect(script).toMatch(/start-hook\.vbs/i);
    expect(script).not.toMatch(/powershell/i);
  });
});
