import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const APP_NAME = "OpenQian";
export const DB_FILE = "openqian.db";

// The project was called OpenChieng before its first release; data stored under
// that name is adopted once (see adoptLegacyData).
const LEGACY_APP_NAME = "OpenChieng";
const LEGACY_DB_FILE = "openchieng.db";

function appDataDir(name: string, env: Record<string, string | undefined>, platform: string): string {
  const home = os.homedir();
  switch (platform) {
    case "darwin":
      return path.join(home, "Library", "Application Support", name);
    case "win32":
      return path.join(env.APPDATA ?? path.join(home, "AppData", "Roaming"), name);
    default:
      return path.join(env.XDG_DATA_HOME ?? path.join(home, ".local", "share"), name.toLowerCase());
  }
}

/**
 * Directory holding the database and other local state. Defaults to the
 * platform's per-user app-data location; override with DATA_DIR.
 */
export function dataDir(env: Record<string, string | undefined> = process.env, platform = process.platform): string {
  return env.DATA_DIR ? path.resolve(env.DATA_DIR) : appDataDir(APP_NAME, env, platform);
}

/** Where a pre-rename install kept its data. */
export function legacyDataDir(env: Record<string, string | undefined> = process.env, platform = process.platform): string {
  return env.DATA_DIR ? path.resolve(env.DATA_DIR) : appDataDir(LEGACY_APP_NAME, env, platform);
}

/**
 * Moves a database from the pre-rename location/file name into `dir` if `dir`
 * doesn't have one yet, so upgrading keeps the user's data. Runs before the
 * database is opened; the WAL and shared-memory files move with it.
 */
export function adoptLegacyData(dir: string, legacyDir: string): boolean {
  if (fs.existsSync(path.join(dir, DB_FILE))) return false;
  const source = [dir, legacyDir].find((d) => fs.existsSync(path.join(d, LEGACY_DB_FILE)));
  if (!source) return false;
  fs.mkdirSync(dir, { recursive: true });
  for (const suffix of ["", "-wal", "-shm"]) {
    const from = path.join(source, LEGACY_DB_FILE + suffix);
    if (fs.existsSync(from)) fs.renameSync(from, path.join(dir, DB_FILE + suffix));
  }
  if (source !== dir) {
    try {
      fs.rmdirSync(source); // only succeeds if nothing else was left behind
    } catch {}
  }
  return true;
}
