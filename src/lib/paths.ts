import os from "node:os";
import path from "node:path";

const APP_NAME = "OpenChieng";

/**
 * Directory holding the database and other local state. Defaults to the
 * platform's per-user app-data location; override with DATA_DIR.
 */
export function dataDir(env: Record<string, string | undefined> = process.env, platform = process.platform): string {
  if (env.DATA_DIR) return path.resolve(env.DATA_DIR);
  const home = os.homedir();
  switch (platform) {
    case "darwin":
      return path.join(home, "Library", "Application Support", APP_NAME);
    case "win32":
      return path.join(env.APPDATA ?? path.join(home, "AppData", "Roaming"), APP_NAME);
    default:
      return path.join(env.XDG_DATA_HOME ?? path.join(home, ".local", "share"), APP_NAME.toLowerCase());
  }
}
