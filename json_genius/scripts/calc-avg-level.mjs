import { createJsonArrayStream } from '../dist/streaming/json-stream.js';
import { getValuesAtPath } from '../dist/query/path-query.js';

const stream = createJsonArrayStream('../data/LiveTest/chars.json', { pickPath: 'entities' });

let totalChars = 0;
let totalMaxLevel = 0;
const levelDist = {};

for await (const { value } of stream) {
  const entityId = value.entityId;
  if (!entityId || !entityId.startsWith('PlayerCharacter:')) continue;

  totalChars++;

  // Get all itemLevels from the character using recursive descent
  const allItemLevels = [];

  function findItemLevels(obj) {
    if (!obj || typeof obj !== 'object') return;
    if (obj.itemLevel !== undefined && typeof obj.itemLevel === 'number') {
      allItemLevels.push(obj.itemLevel);
    }
    for (const key of Object.keys(obj)) {
      findItemLevels(obj[key]);
    }
  }

  findItemLevels(value.payload);

  if (allItemLevels.length > 0) {
    const maxLevel = Math.max(...allItemLevels);
    totalMaxLevel += maxLevel;
    levelDist[maxLevel] = (levelDist[maxLevel] || 0) + 1;
  }
}

console.log('Total Characters:', totalChars);
console.log('Avg Max Item Level (≈ Character Level):', (totalMaxLevel / totalChars).toFixed(1));
console.log('');
console.log('Level Distribution:');
const sorted = Object.entries(levelDist).sort((a, b) => Number(a[0]) - Number(b[0]));
for (const [level, count] of sorted) {
  console.log(`  Level ${level}: ${count} characters`);
}
