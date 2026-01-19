import { resolve } from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import { createJsonArrayStream } from '../streaming/json-stream.js';
import { extractSchema, formatSchemaYaml } from '../analyzer/schema-extractor.js';
import { getValueAtPath, getValuesAtPath } from '../query/path-query.js';
import { logger } from '../utils/logger.js';

export type ReportName = 'player-kpis' | 'retention' | 'progression' | 'schema-summary';

export interface ReportOptions {
  format?: 'text' | 'json';
}

export interface ReportResult {
  report: ReportName;
  data: Record<string, unknown>;
  formatted: string;
}

interface FileInfo {
  name: string;
  path: string;
  sizeMB: number;
}

async function findJsonFiles(directory: string): Promise<FileInfo[]> {
  const absoluteDir = resolve(directory);
  const entries = await readdir(absoluteDir);
  const files: FileInfo[] = [];

  for (const entry of entries) {
    if (entry.endsWith('.json')) {
      const filePath = resolve(absoluteDir, entry);
      const fileStat = await stat(filePath);
      if (fileStat.isFile()) {
        files.push({
          name: entry,
          path: filePath,
          sizeMB: fileStat.size / (1024 * 1024),
        });
      }
    }
  }

  return files;
}

async function runPlayerKpisReport(directory: string): Promise<ReportResult> {
  const files = await findJsonFiles(directory);
  const liveFile = files.find(f => f.name === 'live.json');
  const charsFile = files.find(f => f.name === 'chars.json');

  const data: Record<string, unknown> = {
    totalPlayers: 0,
    totalCharacters: 0,
    charactersPerPlayer: { min: 0, max: 0, avg: 0 },
    classDistribution: {} as Record<string, number>,
  };

  const playerCharCounts: number[] = [];
  const classCount: Record<string, number> = {};

  if (liveFile) {
    logger.debug(`Processing live.json for player stats`);
    const stream = createJsonArrayStream<unknown>(liveFile.path, { pickPath: 'entities' });

    for await (const { value } of stream) {
      const entityId = getValueAtPath(value, 'entityId') as string | undefined;
      if (entityId?.startsWith('Player:')) {
        (data.totalPlayers as number)++;

        const playerName = getValueAtPath(value, 'payload.playerName') as string | undefined;
        const charIds = getValuesAtPath(value, 'payload.characterRoster.characterIds[*]');
        const characterCount = charIds.length;
        playerCharCounts.push(characterCount);
      }
    }
  }

  if (charsFile) {
    logger.debug(`Processing chars.json for character stats`);
    const stream = createJsonArrayStream<unknown>(charsFile.path, { pickPath: 'entities' });

    for await (const { value } of stream) {
      const entityId = getValueAtPath(value, 'entityId') as string | undefined;
      if (entityId?.startsWith('PlayerCharacter:')) {
        (data.totalCharacters as number)++;

        const charClass = getValueAtPath(value, 'payload.character.characterClassId') as string | undefined;
        if (charClass) {
          classCount[charClass] = (classCount[charClass] || 0) + 1;
        }
      }
    }
  }

  if (playerCharCounts.length > 0) {
    const min = Math.min(...playerCharCounts);
    const max = Math.max(...playerCharCounts);
    const sum = playerCharCounts.reduce((a, b) => a + b, 0);
    const avg = sum / playerCharCounts.length;
    data.charactersPerPlayer = { min, max, avg: parseFloat(avg.toFixed(2)) };
  }

  data.classDistribution = classCount;

  const formatted = formatPlayerKpis(data);

  return { report: 'player-kpis', data, formatted };
}

function formatPlayerKpis(data: Record<string, unknown>): string {
  const lines: string[] = [
    '# Player KPIs Report',
    '',
    `Total Players: ${data.totalPlayers}`,
    `Total Characters: ${data.totalCharacters}`,
    '',
    '## Characters Per Player',
  ];

  const charsPerPlayer = data.charactersPerPlayer as { min: number; max: number; avg: number };
  lines.push(`  Min: ${charsPerPlayer.min}`);
  lines.push(`  Max: ${charsPerPlayer.max}`);
  lines.push(`  Avg: ${charsPerPlayer.avg}`);

  const classDistribution = data.classDistribution as Record<string, number>;
  if (Object.keys(classDistribution).length > 0) {
    lines.push('');
    lines.push('## Character Class Distribution');
    const sorted = Object.entries(classDistribution).sort((a, b) => b[1] - a[1]);
    for (const [className, count] of sorted) {
      lines.push(`  ${className}: ${count}`);
    }
  }

  return lines.join('\n');
}

async function runRetentionReport(directory: string): Promise<ReportResult> {
  const files = await findJsonFiles(directory);
  const liveFile = files.find(f => f.name === 'live.json');

  const data: Record<string, unknown> = {
    totalPlayers: 0,
    d1Retention: { count: 0, rate: 0 },
    d3Retention: { count: 0, rate: 0 },
    d7Retention: { count: 0, rate: 0 },
    newPlayers: 0,
    returningPlayers: 0,
  };

  if (liveFile) {
    logger.debug(`Processing live.json for retention stats`);
    const stream = createJsonArrayStream<unknown>(liveFile.path, { pickPath: 'entities' });

    const now = Date.now();
    const day1 = 24 * 60 * 60 * 1000;
    const day3 = 3 * day1;
    const day7 = 7 * day1;

    let totalPlayers = 0;
    let d1Count = 0;
    let d3Count = 0;
    let d7Count = 0;
    let newPlayers = 0;
    let returningPlayers = 0;

    for await (const { value } of stream) {
      const entityId = getValueAtPath(value, 'entityId') as string | undefined;
      if (!entityId?.startsWith('Player:')) continue;

      totalPlayers++;

      const deviceHistory = getValuesAtPath(value, 'payload.deviceHistory[*]');
      const loginEvents = getValuesAtPath(value, 'payload.loginHistory[*]');

      const timestamps: number[] = [];

      for (const dh of deviceHistory) {
        if (typeof dh === 'object' && dh !== null) {
          const firstLogin = getValueAtPath(dh, 'firstLogin') as string | number | undefined;
          const lastLogin = getValueAtPath(dh, 'lastLogin') as string | number | undefined;

          if (firstLogin) {
            const ts = typeof firstLogin === 'string' ? new Date(firstLogin).getTime() : firstLogin;
            if (!isNaN(ts)) timestamps.push(ts);
          }
          if (lastLogin) {
            const ts = typeof lastLogin === 'string' ? new Date(lastLogin).getTime() : lastLogin;
            if (!isNaN(ts)) timestamps.push(ts);
          }
        }
      }

      for (const le of loginEvents) {
        if (typeof le === 'object' && le !== null) {
          const timestamp = getValueAtPath(le, 'timestamp') as string | number | undefined;
          if (timestamp) {
            const ts = typeof timestamp === 'string' ? new Date(timestamp).getTime() : timestamp;
            if (!isNaN(ts)) timestamps.push(ts);
          }
        }
      }

      if (timestamps.length === 0) {
        newPlayers++;
        continue;
      }

      const firstTs = Math.min(...timestamps);
      const lastTs = Math.max(...timestamps);
      const daysSinceFirst = (lastTs - firstTs) / day1;

      if (daysSinceFirst < 1) {
        newPlayers++;
      } else {
        returningPlayers++;
      }

      if (daysSinceFirst >= 1) d1Count++;
      if (daysSinceFirst >= 3) d3Count++;
      if (daysSinceFirst >= 7) d7Count++;
    }

    data.totalPlayers = totalPlayers;
    data.d1Retention = {
      count: d1Count,
      rate: totalPlayers > 0 ? parseFloat(((d1Count / totalPlayers) * 100).toFixed(1)) : 0,
    };
    data.d3Retention = {
      count: d3Count,
      rate: totalPlayers > 0 ? parseFloat(((d3Count / totalPlayers) * 100).toFixed(1)) : 0,
    };
    data.d7Retention = {
      count: d7Count,
      rate: totalPlayers > 0 ? parseFloat(((d7Count / totalPlayers) * 100).toFixed(1)) : 0,
    };
    data.newPlayers = newPlayers;
    data.returningPlayers = returningPlayers;
  }

  const formatted = formatRetention(data);

  return { report: 'retention', data, formatted };
}

function formatRetention(data: Record<string, unknown>): string {
  const lines: string[] = [
    '# Retention Report',
    '',
    `Total Players: ${data.totalPlayers}`,
    '',
    '## Retention Rates',
  ];

  const d1 = data.d1Retention as { count: number; rate: number };
  const d3 = data.d3Retention as { count: number; rate: number };
  const d7 = data.d7Retention as { count: number; rate: number };

  lines.push(`  D1: ${d1.rate}% (${d1.count} players)`);
  lines.push(`  D3: ${d3.rate}% (${d3.count} players)`);
  lines.push(`  D7: ${d7.rate}% (${d7.count} players)`);

  lines.push('');
  lines.push('## Player Status');
  lines.push(`  New Players: ${data.newPlayers}`);
  lines.push(`  Returning Players: ${data.returningPlayers}`);

  return lines.join('\n');
}

async function runProgressionReport(directory: string): Promise<ReportResult> {
  const files = await findJsonFiles(directory);
  const charsFile = files.find(f => f.name === 'chars.json');

  const data: Record<string, unknown> = {
    totalCharacters: 0,
    levelDistribution: {} as Record<string, number>,
    maxLevelCharacters: 0,
    maxLevel: 0,
    avgLevel: 0,
    equipmentStats: {
      avgEquippedItems: 0,
      totalEquippedItems: 0,
    },
  };

  const levels: number[] = [];
  const levelCount: Record<number, number> = {};
  let totalEquipped = 0;
  let charCount = 0;

  if (charsFile) {
    logger.debug(`Processing chars.json for progression stats`);
    const stream = createJsonArrayStream<unknown>(charsFile.path, { pickPath: 'entities' });

    for await (const { value } of stream) {
      const entityId = getValueAtPath(value, 'entityId') as string | undefined;
      if (!entityId?.startsWith('PlayerCharacter:')) continue;

      charCount++;

      const level = getValueAtPath(value, 'payload.level') as number | undefined;
      if (typeof level === 'number') {
        levels.push(level);
        levelCount[level] = (levelCount[level] || 0) + 1;
      }

      const equippedItems = getValuesAtPath(value, 'payload.equippedItems[*]');
      const equipment = getValuesAtPath(value, 'payload.equipment[*]');
      const gear = getValuesAtPath(value, 'payload.gear[*]');

      const equipped = equippedItems.length + equipment.length + gear.length;
      totalEquipped += equipped;
    }
  }

  data.totalCharacters = charCount;

  if (levels.length > 0) {
    const maxLevel = Math.max(...levels);
    const avgLevel = levels.reduce((a, b) => a + b, 0) / levels.length;

    data.maxLevel = maxLevel;
    data.avgLevel = parseFloat(avgLevel.toFixed(2));
    data.maxLevelCharacters = levels.filter(l => l === maxLevel).length;

    const sortedLevelDist: Record<string, number> = {};
    const sortedLevels = Object.keys(levelCount).map(Number).sort((a, b) => a - b);
    for (const lvl of sortedLevels) {
      sortedLevelDist[`Level ${lvl}`] = levelCount[lvl];
    }
    data.levelDistribution = sortedLevelDist;
  }

  if (charCount > 0) {
    data.equipmentStats = {
      avgEquippedItems: parseFloat((totalEquipped / charCount).toFixed(2)),
      totalEquippedItems: totalEquipped,
    };
  }

  const formatted = formatProgression(data);

  return { report: 'progression', data, formatted };
}

function formatProgression(data: Record<string, unknown>): string {
  const lines: string[] = [
    '# Progression Report',
    '',
    `Total Characters: ${data.totalCharacters}`,
    '',
    '## Level Stats',
    `  Max Level: ${data.maxLevel}`,
    `  Avg Level: ${data.avgLevel}`,
    `  Characters at Max Level: ${data.maxLevelCharacters}`,
  ];

  const levelDist = data.levelDistribution as Record<string, number>;
  if (Object.keys(levelDist).length > 0) {
    lines.push('');
    lines.push('## Level Distribution');
    for (const [level, count] of Object.entries(levelDist)) {
      lines.push(`  ${level}: ${count}`);
    }
  }

  const equipStats = data.equipmentStats as { avgEquippedItems: number; totalEquippedItems: number };
  if (equipStats.totalEquippedItems > 0) {
    lines.push('');
    lines.push('## Equipment Stats');
    lines.push(`  Avg Equipped Items: ${equipStats.avgEquippedItems}`);
    lines.push(`  Total Equipped Items: ${equipStats.totalEquippedItems}`);
  }

  return lines.join('\n');
}

async function runSchemaSummaryReport(directory: string): Promise<ReportResult> {
  const files = await findJsonFiles(directory);

  const data: Record<string, unknown> = {
    directory,
    fileCount: files.length,
    files: [] as unknown[],
  };

  const fileInfos: unknown[] = [];

  for (const file of files) {
    logger.debug(`Extracting schema from ${file.name}`);

    try {
      const schema = await extractSchema(file.path, { maxDepth: 3, maxSamples: 2 });

      const stream = createJsonArrayStream<unknown>(file.path, { pickPath: 'entities' });
      let entityCount = 0;
      for await (const _ of stream) {
        entityCount++;
      }

      fileInfos.push({
        name: file.name,
        sizeMB: parseFloat(file.sizeMB.toFixed(2)),
        entityCount,
        schemaYaml: formatSchemaYaml(schema),
      });
    } catch (err) {
      fileInfos.push({
        name: file.name,
        sizeMB: parseFloat(file.sizeMB.toFixed(2)),
        error: String(err),
      });
    }
  }

  data.files = fileInfos;

  const formatted = formatSchemaSummary(data);

  return { report: 'schema-summary', data, formatted };
}

function formatSchemaSummary(data: Record<string, unknown>): string {
  const lines: string[] = [
    '# Schema Summary Report',
    '',
    `Directory: ${data.directory}`,
    `Files: ${data.fileCount}`,
    '',
  ];

  const files = data.files as Array<{
    name: string;
    sizeMB: number;
    entityCount?: number;
    schemaYaml?: string;
    error?: string;
  }>;

  for (const file of files) {
    lines.push(`## ${file.name}`);
    lines.push(`Size: ${file.sizeMB} MB`);

    if (file.error) {
      lines.push(`Error: ${file.error}`);
    } else {
      lines.push(`Entities: ${file.entityCount ?? 'N/A'}`);
      if (file.schemaYaml) {
        lines.push('');
        lines.push('Schema:');
        lines.push(file.schemaYaml.split('\n').map(l => '  ' + l).join('\n'));
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

export async function runReport(
  directory: string,
  reportName: ReportName,
  options: ReportOptions = {}
): Promise<ReportResult> {
  const { format = 'text' } = options;

  logger.debug(`Running report: ${reportName} on directory: ${directory}`);

  let result: ReportResult;

  switch (reportName) {
    case 'player-kpis':
      result = await runPlayerKpisReport(directory);
      break;
    case 'retention':
      result = await runRetentionReport(directory);
      break;
    case 'progression':
      result = await runProgressionReport(directory);
      break;
    case 'schema-summary':
      result = await runSchemaSummaryReport(directory);
      break;
    default:
      throw new Error(`Unknown report: ${reportName}`);
  }

  if (format === 'json') {
    result.formatted = JSON.stringify(result.data, null, 2);
  }

  return result;
}

export function formatReportResult(result: ReportResult, format: 'text' | 'json' = 'text'): string {
  if (format === 'json') {
    return JSON.stringify(result.data, null, 2);
  }
  return result.formatted;
}

export const AVAILABLE_REPORTS: ReportName[] = ['player-kpis', 'retention', 'progression', 'schema-summary'];
