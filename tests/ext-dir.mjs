// The extension under test. The only line to change if the folder is renamed.
// EXT_DIR=dist/safari (relative to the repo) runs the same tests against the Safari build.
import { fileURLToPath } from 'url';
import path from 'path';
const repo = fileURLToPath(new URL('../', import.meta.url));
export const EXT_DIR = process.env.EXT_DIR
  ? path.resolve(repo, process.env.EXT_DIR) + '/'
  : fileURLToPath(new URL('../extension/', import.meta.url));
