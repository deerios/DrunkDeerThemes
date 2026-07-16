// Rebuilds index.json from the theme files.
//
// The submission workflow does this itself, so this is for the times a theme file is changed by
// hand — a removal, a rename — and the catalogue has to catch up.
//
//   node tools/build-index.mjs

import { INDEX_FILE, writeIndex } from './lib/catalogue.mjs';

const text = await writeIndex();
console.log(`Wrote ${INDEX_FILE} (${JSON.parse(text).themes.length} themes).`);
