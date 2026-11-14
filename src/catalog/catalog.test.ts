import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import {
  CATALOG,
  CATEGORIES,
  comparisonCsv,
  comparisonRows,
  filterCatalog,
  parseCatalogRoute,
  validSelection,
  type CatalogFilters,
  type CatalogRobot,
} from './catalog';

const filters: CatalogFilters = {
  category: '',
  query: '',
  manufacturer: '',
  availability: '',
  maxPrice: '',
  support: '',
  sort: 'maker',
};
describe('sourced robot catalog', () => {
  it('contains five unique robots per source classification, with dated technical sources', () => {
    expect(CATALOG).toHaveLength(30);
    expect(new Set(CATALOG.map((r) => r.id)).size).toBe(30);
    expect(CATEGORIES).toHaveLength(6);
    for (const category of CATEGORIES)
      expect(CATALOG.filter((r) => r.category === category.id)).toHaveLength(5);
    for (const robot of CATALOG) {
      expect(robot.specifications.length).toBeGreaterThanOrEqual(10);
      expect(robot.catalogUrl).toBe(`https://omblet.com/robots/${robot.id}`);
      expect(new Set(robot.specifications.map((s) => `${s.section}|${s.label}`)).size).toBe(
        robot.specifications.length,
      );
      if (robot.priceUsd !== null) expect(Number.isFinite(robot.priceUsd)).toBe(true);
      for (const spec of robot.specifications) {
        expect(spec.sourceUrl).toMatch(/^https:\/\//);
        expect(spec.checkedAt).toMatch(/^2026-\d\d-\d\d$/);
        expect(spec.value.length).toBeGreaterThan(0);
      }
    }
  });
  it('excludes household robots and arms from discovery and stale comparison links', () => {
    const removed = ['irobot-roomba-combo-10-max', 'franka-research-3'];
    expect(CATEGORIES.map((c) => c.id)).not.toContain('household');
    expect(CATEGORIES.map((c) => c.id)).not.toContain('arm');
    expect(CATALOG.some((r) => ['household', 'arm'].includes(r.category))).toBe(false);
    expect(filterCatalog(CATALOG, { ...filters, query: 'roomba' })).toEqual([]);
    expect(filterCatalog(CATALOG, { ...filters, query: 'franka' })).toEqual([]);
    expect(validSelection([...removed, 'unitree-g1'])).toEqual(['unitree-g1']);
    expect(parseCatalogRoute(`#/catalog/compare?robots=${removed.join(',')},unitree-g1`)).toEqual({
      page: 'compare',
      ids: ['unitree-g1'],
    });
    for (const category of ['household', 'arm'])
      expect(parseCatalogRoute(`#/catalog/${category}`)).toEqual({ page: 'discover', category: '' });
  });
  it('ships every portrait, maker mark and font with an integrity manifest', () => {
    const assets = JSON.parse(readFileSync(resolve('public/catalog/asset-manifest.json'), 'utf8')) as {
      path: string;
      sha256: string;
      bytes: number;
    }[];
    expect(assets).toHaveLength(196);
    for (const asset of assets) {
      const file = readFileSync(resolve(asset.path));
      expect(file.byteLength).toBe(asset.bytes);
      expect(createHash('sha256').update(file).digest('hex')).toBe(asset.sha256);
    }
    for (const robot of CATALOG) {
      expect(existsSync(resolve(`public${robot.image}`))).toBe(true);
      expect(existsSync(resolve(`public${robot.logo}`))).toBe(true);
      expect(robot.gallery).toHaveLength(3);
      for (const entry of robot.gallery) {
        expect(existsSync(resolve(`public${entry.image}`))).toBe(true);
        expect(entry.alt.length).toBeGreaterThan(10);
      }
    }
  });
  it('does not substitute the older Husky model for A300 or enable Go2 walking', () => {
    expect(CATALOG.find((r) => r.id === 'clearpath-husky-a300')?.assetId).toBeNull();
    expect(CATALOG.find((r) => r.id === 'clearpath-husky-a300')?.simulationModelId).toBeNull();
    expect(CATALOG.find((r) => r.id === 'unitree-go2')?.simulationModelId).toBeNull();
    expect(CATALOG.find((r) => r.id === 'clearpath-jackal')?.simulationModelId).toBe('jackal');
  });
  it('combines classification, search and price filters without treating unknown prices as free', () => {
    expect(
      filterCatalog(CATALOG, { ...filters, category: 'humanoid', query: 'unitree g1' }).map((r) => r.id),
    ).toEqual(['unitree-g1']);
    const capped = filterCatalog(CATALOG, { ...filters, maxPrice: '2000' });
    expect(capped.length).toBeGreaterThan(0);
    expect(capped.every((r) => r.priceUsd !== null && r.priceUsd <= 2000)).toBe(true);
    expect(filterCatalog(CATALOG, { ...filters, maxPrice: '-1' })).toEqual([]);
    expect(filterCatalog(CATALOG, { ...filters, support: 'physics' }).map((r) => r.id)).toEqual([
      'clearpath-jackal',
    ]);
    expect(filterCatalog(CATALOG, { ...filters, sort: 'price' }).at(-1)?.priceUsd).toBeNull();
  });
  it('sanitizes bookmarks and saved selections to at most four unique supported IDs', () => {
    expect(validSelection(['unitree-g1', 'unitree-g1', 'missing', null, 'unitree-go2'])).toEqual([
      'unitree-g1',
      'unitree-go2',
    ]);
    expect(validSelection(CATALOG.map((r) => r.id))).toHaveLength(4);
    expect(parseCatalogRoute('#/catalog/compare?robots=unitree-g1,missing,unitree-go2')).toEqual({
      page: 'compare',
      ids: ['unitree-g1', 'unitree-go2'],
    });
    expect(parseCatalogRoute('#/catalog/robots/missing')).toEqual({ page: 'detail', id: 'missing' });
    expect(parseCatalogRoute('#/catalog/not-a-category')).toEqual({ page: 'discover', category: '' });
  });
});
describe('technical comparison semantics', () => {
  const make = (specs: { section: string; label: string; value: string }[]) =>
    ({
      ...CATALOG[0],
      specifications: specs.map((s) => ({
        ...s,
        sourceUrl: 'https://example.com/specification',
        checkedAt: '2026-11-14',
      })),
    }) as CatalogRobot;
  it('keeps measurements with different conditions separate and missing cells null', () => {
    const robots = [
      make([{ section: 'Physical', label: 'Mass', value: '30 kg' }]),
      make([{ section: 'Physical', label: 'Mass with battery', value: '35 kg' }]),
    ];
    const rows = comparisonRows(robots);
    expect(rows).toHaveLength(2);
    expect(rows[0].cells[1]).toBeNull();
    expect(rows[1].cells[0]).toBeNull();
  });
  it('filters equal technical values but retains numeric differences and missing evidence', () => {
    const robots = [
      make([
        { section: 'Power', label: 'Runtime', value: '2 hours' },
        { section: 'Physical', label: 'Mass', value: '30 kg' },
      ]),
      make([
        { section: 'Power', label: 'Runtime', value: ' 2  hours ' },
        { section: 'Physical', label: 'Mass', value: '35 kg' },
      ]),
    ];
    expect(comparisonRows(robots, true).map((r) => r.label)).toEqual(['Mass']);
    expect(comparisonRows([robots[0]], true)).toHaveLength(2);
  });
  it('exports values with provenance and escapes spreadsheet formulas and quoted text', () => {
    const csv = comparisonCsv([
      make([
        { section: 'Test', label: 'Payload', value: '=HYPERLINK("bad")' },
        { section: 'Test', label: 'Notes', value: '1, 2\n"quoted"' },
      ]),
    ]);
    expect(csv).toContain('source');
    expect(csv).toContain('https://example.com/specification');
    expect(csv).toContain('2026-11-14');
    expect(csv).toContain('"\'=HYPERLINK(""bad"")"');
    expect(csv).toContain('"1, 2\n""quoted"""');
  });
});
