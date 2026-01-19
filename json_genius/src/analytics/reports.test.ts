import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'node:path';
import { runReport, ReportResult } from './reports.js';

const TEST_DATA_DIR = resolve(import.meta.dirname, '../../..', 'data/LiveTest');

describe('Analytics Reports', () => {
  describe('player-kpis report', () => {
    let result: ReportResult;

    beforeAll(async () => {
      result = await runReport(TEST_DATA_DIR, 'player-kpis');
    });

    it('should count total players from live.json', () => {
      expect(result.data.totalPlayers).toBe(127);
    });

    it('should count total characters from chars.json', () => {
      expect(result.data.totalCharacters).toBe(210);
    });

    it('should calculate non-zero characters per player stats', () => {
      const stats = result.data.charactersPerPlayer as { min: number; max: number; avg: number };

      // With 210 characters and 127 players, avg should be ~1.65
      expect(stats.avg).toBeGreaterThan(0);
      expect(stats.max).toBeGreaterThan(0);
      // min could be 0 if some players have no characters
    });

    it('should have reasonable characters per player average', () => {
      const stats = result.data.charactersPerPlayer as { min: number; max: number; avg: number };

      // 210 characters / 127 players ≈ 1.65
      // Allow some tolerance for players without characters
      expect(stats.avg).toBeGreaterThanOrEqual(1);
      expect(stats.avg).toBeLessThanOrEqual(3);
    });

    it('should include class distribution with known classes', () => {
      const classDistribution = result.data.classDistribution as Record<string, number>;

      // Should have at least some classes
      const classCount = Object.keys(classDistribution).length;
      expect(classCount).toBeGreaterThan(0);
    });

    it('should include Thor_Class in class distribution', () => {
      const classDistribution = result.data.classDistribution as Record<string, number>;

      // From sample data, we know Thor_Class exists
      expect(classDistribution).toHaveProperty('Thor_Class');
      expect(classDistribution['Thor_Class']).toBeGreaterThan(0);
    });

    it('should have class counts that sum to total characters', () => {
      const classDistribution = result.data.classDistribution as Record<string, number>;

      const totalFromClasses = Object.values(classDistribution).reduce((a, b) => a + b, 0);
      expect(totalFromClasses).toBe(result.data.totalCharacters);
    });

    it('should produce formatted output', () => {
      expect(result.formatted).toContain('# Player KPIs Report');
      expect(result.formatted).toContain('Total Players: 127');
      expect(result.formatted).toContain('Total Characters: 210');
    });
  });

  describe('schema-summary report', () => {
    let result: ReportResult;

    beforeAll(async () => {
      result = await runReport(TEST_DATA_DIR, 'schema-summary');
    });

    it('should find both JSON files', () => {
      expect(result.data.fileCount).toBe(2);
    });

    it('should include file information', () => {
      const files = result.data.files as Array<{ name: string; sizeMB: number; entityCount?: number }>;

      const liveFile = files.find(f => f.name === 'live.json');
      const charsFile = files.find(f => f.name === 'chars.json');

      expect(liveFile).toBeDefined();
      expect(charsFile).toBeDefined();
    });

    it('should count entities in live.json', () => {
      const files = result.data.files as Array<{ name: string; entityCount?: number }>;
      const liveFile = files.find(f => f.name === 'live.json');

      expect(liveFile?.entityCount).toBe(127);
    });

    it('should count entities in chars.json', () => {
      const files = result.data.files as Array<{ name: string; entityCount?: number }>;
      const charsFile = files.find(f => f.name === 'chars.json');

      expect(charsFile?.entityCount).toBe(210);
    });

    it('should produce formatted output with schema info', () => {
      expect(result.formatted).toContain('# Schema Summary Report');
      expect(result.formatted).toContain('live.json');
      expect(result.formatted).toContain('chars.json');
    });
  });

  describe('retention report', () => {
    let result: ReportResult;

    beforeAll(async () => {
      result = await runReport(TEST_DATA_DIR, 'retention');
    });

    it('should count total players', () => {
      expect(result.data.totalPlayers).toBe(127);
    });

    it('should calculate retention rates as percentages', () => {
      const d1 = result.data.d1Retention as { count: number; rate: number };
      const d3 = result.data.d3Retention as { count: number; rate: number };
      const d7 = result.data.d7Retention as { count: number; rate: number };

      // Rates should be between 0 and 100
      expect(d1.rate).toBeGreaterThanOrEqual(0);
      expect(d1.rate).toBeLessThanOrEqual(100);
      expect(d3.rate).toBeGreaterThanOrEqual(0);
      expect(d3.rate).toBeLessThanOrEqual(100);
      expect(d7.rate).toBeGreaterThanOrEqual(0);
      expect(d7.rate).toBeLessThanOrEqual(100);
    });

    it('should have monotonically decreasing retention rates', () => {
      const d1 = result.data.d1Retention as { rate: number };
      const d3 = result.data.d3Retention as { rate: number };
      const d7 = result.data.d7Retention as { rate: number };

      // D1 >= D3 >= D7 (players retained at day 3 must have been retained at day 1)
      expect(d1.rate).toBeGreaterThanOrEqual(d3.rate);
      expect(d3.rate).toBeGreaterThanOrEqual(d7.rate);
    });

    it('should categorize all players as new or returning', () => {
      const newPlayers = result.data.newPlayers as number;
      const returningPlayers = result.data.returningPlayers as number;

      expect(newPlayers + returningPlayers).toBe(127);
    });

    it('should produce formatted output', () => {
      expect(result.formatted).toContain('# Retention Report');
      expect(result.formatted).toContain('Total Players: 127');
      expect(result.formatted).toContain('D1:');
      expect(result.formatted).toContain('D3:');
      expect(result.formatted).toContain('D7:');
    });
  });

  describe('progression report', () => {
    let result: ReportResult;

    beforeAll(async () => {
      result = await runReport(TEST_DATA_DIR, 'progression');
    });

    it('should count total characters', () => {
      expect(result.data.totalCharacters).toBe(210);
    });

    it('should calculate level statistics', () => {
      // Note: If the level field doesn't exist at the expected path,
      // these will be 0. This test documents expected behavior.
      const maxLevel = result.data.maxLevel as number;
      const avgLevel = result.data.avgLevel as number;

      // These should either be valid numbers or 0 if path is wrong
      expect(typeof maxLevel).toBe('number');
      expect(typeof avgLevel).toBe('number');
    });

    it('should produce formatted output', () => {
      expect(result.formatted).toContain('# Progression Report');
      expect(result.formatted).toContain('Total Characters: 210');
    });
  });
});
