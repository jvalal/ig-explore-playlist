// The extension under test. The only line to change if the folder is renamed.
import { fileURLToPath } from 'url';
export const EXT_DIR = fileURLToPath(new URL('../extension/', import.meta.url));
