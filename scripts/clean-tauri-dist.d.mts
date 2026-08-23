/**
 * Type surface for the plain-JS build helper `clean-tauri-dist.mjs`, so the
 * contract test can import it under `tsc --noEmit -p tsconfig.test.json`
 * without `allowJs`.
 */
export declare const cleanTauriDist: (publicDir?: string) => {
  removedFiles: string[];
  removedDirectories: string[];
};
