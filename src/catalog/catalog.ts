import snapshot from './robots.json';
import type { RobotAssetId, FleetRobotId } from '../robots/catalog';

export interface TechnicalSpec {
  section: string;
  label: string;
  value: string;
  sourceUrl: string;
  checkedAt: string;
}
export interface CatalogRobot {
  id: string;
  name: string;
  manufacturer: string;
  category: string;
  purpose: string;
  availability: string;
  priceUsd: number | null;
  priceNote: string;
  sourceUrl: string;
  catalogUrl: string;
  checkedAt: string;
  capturedAt: string;
  image: string;
  gallery: { image: string; alt: string }[];
  logo: string;
  imageStyle: string | null;
  color: string;
  specifications: TechnicalSpec[];
  assetId: RobotAssetId | null;
  simulationModelId: FleetRobotId | null;
}
export const CATALOG = snapshot.robots as CatalogRobot[];
export const CATEGORIES = snapshot.categories;
export const CAPTURED_AT = snapshot.capturedAt;
export const COMPARE_KEY = 'first-contact.catalog-comparison.v1';
export const categoryLabel = (id: string) =>
  CATEGORIES.find((category) => category.id === id)?.label ?? 'All robots';
export const formatPrice = (value: number | null) =>
  value === null ? 'Price unknown' : `$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
export const robotHref = (id: string) => `#/catalog/robots/${encodeURIComponent(id)}`;
export const categoryHref = (id = '') => `#/catalog${id ? '/' + id : ''}`;
export const compareHref = (ids: string[]) =>
  `#/catalog/compare?robots=${ids.map(encodeURIComponent).join(',')}`;
export function validSelection(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter((id): id is string => typeof id === 'string' && CATALOG.some((r) => r.id === id)),
    ),
  ].slice(0, 4);
}
export function storedSelection() {
  try {
    return validSelection(JSON.parse(localStorage.getItem(COMPARE_KEY) ?? '[]'));
  } catch {
    return [];
  }
}
export function parseCatalogRoute(hash: string) {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/');
  if (parts[1] === 'compare') {
    const params = new URLSearchParams(query);
    return {
      page: 'compare' as const,
      ids: params.has('robots') ? validSelection(params.get('robots')!.split(',')) : null,
    };
  }
  if (parts[1] === 'robots') return { page: 'detail' as const, id: parts[2] ?? '' };
  return { page: 'discover' as const, category: CATEGORIES.some((c) => c.id === parts[1]) ? parts[1] : '' };
}
export interface CatalogFilters {
  category: string;
  query: string;
  manufacturer: string;
  availability: string;
  maxPrice: string;
  support: string;
  sort: string;
}
export function filterCatalog(robots: CatalogRobot[], filters: CatalogFilters) {
  const words = filters.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const price = filters.maxPrice.trim() === '' ? null : Number(filters.maxPrice);
  return robots
    .filter((r) => {
      const haystack =
        `${r.name} ${r.manufacturer} ${r.purpose} ${categoryLabel(r.category)}`.toLocaleLowerCase();
      return (
        (!filters.category || r.category === filters.category) &&
        words.every((word) => haystack.includes(word)) &&
        (!filters.manufacturer || r.manufacturer === filters.manufacturer) &&
        (!filters.availability || r.availability === filters.availability) &&
        (price === null ||
          (Number.isFinite(price) && price >= 0 && r.priceUsd !== null && r.priceUsd <= price)) &&
        (!filters.support || (filters.support === '3d' ? !!r.assetId : !!r.simulationModelId))
      );
    })
    .sort((a, b) =>
      filters.sort === 'price'
        ? (a.priceUsd ?? Infinity) - (b.priceUsd ?? Infinity) || a.manufacturer.localeCompare(b.manufacturer)
        : filters.sort === 'name'
          ? a.name.localeCompare(b.name)
          : a.manufacturer.localeCompare(b.manufacturer) || a.name.localeCompare(b.name),
    );
}

const SECTION_ORDER = [
  'Purchase',
  'Physical',
  'Configuration',
  'Actuation',
  'Mobility',
  'Manipulation',
  'Performance',
  'Sensors',
  'Power',
  'Compute',
  'Development',
  'Connectivity',
  'Interaction',
  'Protection',
  'Environment',
];
export interface ComparisonRow {
  key: string;
  section: string;
  label: string;
  cells: (TechnicalSpec | null)[];
}
export function comparisonRows(robots: CatalogRobot[], differencesOnly = false): ComparisonRow[] {
  // Keep measurement conditions and section names. Mass != mass with battery; runtime != standby time.
  const attributes = new Map<string, { section: string; label: string }>();
  for (const robot of robots)
    for (const spec of robot.specifications) attributes.set(`${spec.section}\u0000${spec.label}`, spec);
  const sectionIndex = (s: string) => (SECTION_ORDER.indexOf(s) < 0 ? 100 : SECTION_ORDER.indexOf(s));
  return [...attributes]
    .map(([key, spec]) => ({
      key,
      section: spec.section,
      label: spec.label,
      cells: robots.map((r) => r.specifications.find((s) => `${s.section}\u0000${s.label}` === key) ?? null),
    }))
    .filter(
      (row) =>
        !differencesOnly ||
        robots.length < 2 ||
        new Set(row.cells.map((c) => c?.value.replace(/\s+/g, ' ').trim() ?? null)).size > 1,
    )
    .sort(
      (a, b) =>
        sectionIndex(a.section) - sectionIndex(b.section) ||
        a.section.localeCompare(b.section) ||
        a.label.localeCompare(b.label),
    );
}
const csvCell = (value: string) =>
  `"${(/^[=+\-@\t\r]/.test(value) ? "'" + value : value).replaceAll('"', '""')}"`;
export function comparisonCsv(robots: CatalogRobot[], differencesOnly = false) {
  const rows = [
    [
      'Section',
      'Attribute',
      ...robots.flatMap((r) => [`${r.manufacturer} ${r.name}`, `${r.name} source`, `${r.name} checked`]),
    ],
    ['Catalog', 'Omblet record', ...robots.flatMap((r) => [r.catalogUrl, r.catalogUrl, r.capturedAt])],
    [
      'Catalog',
      'Listed price (USD)',
      ...robots.flatMap((r) => [
        r.priceUsd === null ? 'Not reported' : String(r.priceUsd),
        r.sourceUrl,
        r.checkedAt,
      ]),
    ],
    ['Catalog', 'Price conditions', ...robots.flatMap((r) => [r.priceNote, r.sourceUrl, r.checkedAt])],
    ['Catalog', 'Availability', ...robots.flatMap((r) => [r.availability, r.catalogUrl, r.checkedAt])],
    ...comparisonRows(robots, differencesOnly).map((row) => [
      row.section,
      row.label,
      ...row.cells.flatMap((c) => (c ? [c.value, c.sourceUrl, c.checkedAt] : ['Not reported', '', ''])),
    ]),
  ];
  return '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}
