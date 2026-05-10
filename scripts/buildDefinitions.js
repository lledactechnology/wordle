// Build wordDefinitions.json from targetWords.json using the Free Dictionary API.
// Run: node scripts/buildDefinitions.js
// Resumes: words already in wordDefinitions.json are skipped.

const fs = require('fs');
const path = require('path');

const TARGET_WORDS_PATH = path.join(__dirname, '..', 'targetWords.json');
const DEFINITIONS_PATH = path.join(__dirname, '..', 'wordDefinitions.json');
const DELAY_MS = 350; // rate limit: ~3 requests/sec

const targetWords = JSON.parse(fs.readFileSync(TARGET_WORDS_PATH, 'utf8'));

let definitions = {};
if (fs.existsSync(DEFINITIONS_PATH)) {
  definitions = JSON.parse(fs.readFileSync(DEFINITIONS_PATH, 'utf8'));
}

const pending = targetWords.filter(w => !(w in definitions));

console.log(`${definitions.length ? Object.keys(definitions).length + ' already defined, ' : ''}${pending.length} words to fetch`);

let index = 0;

function fetchNext() {
  if (index >= pending.length) {
    // Write final file
    fs.writeFileSync(DEFINITIONS_PATH, JSON.stringify(definitions, null, 2));
    console.log(`\nDone. Written ${Object.keys(definitions).length} entries to wordDefinitions.json`);
    const missing = Object.entries(definitions).filter(([, v]) => !v.found);
    if (missing.length) {
      console.log(`Missing definitions: ${missing.map(([w]) => w).join(', ')}`);
    }
    return;
  }

  const word = pending[index];
  const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${word}`;

  fetch(url)
    .then(res => {
      if (!res.ok) {
        definitions[word] = { found: false, partOfSpeech: null, definition: null };
        return;
      }
      return res.json().then(data => {
        const meaning = data[0]?.meanings?.[0];
        const def = meaning?.definitions?.[0]?.definition || null;
        const pos = meaning?.partOfSpeech || null;
        definitions[word] = {
          found: true,
          partOfSpeech: pos,
          definition: def || null,
        };
        if (!def) {
          definitions[word].found = false;
        }
      });
    })
    .catch(() => {
      definitions[word] = { found: false, partOfSpeech: null, definition: null };
    })
    .finally(() => {
      index++;
      process.stdout.write(`\r${index}/${pending.length} ${word}`);
      setTimeout(fetchNext, DELAY_MS);
    });
}

fetchNext();
