import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronRight,
  Download,
  Link,
  Plus,
  Search,
  SlidersHorizontal,
  Table2,
  X,
} from 'lucide-react';
import {
  CATALOG,
  CATEGORIES,
  CAPTURED_AT,
  COMPARE_KEY,
  categoryHref,
  categoryLabel,
  compareHref,
  comparisonCsv,
  comparisonRows,
  filterCatalog,
  formatPrice,
  parseCatalogRoute,
  robotHref,
  storedSelection,
  type CatalogRobot,
  type TechnicalSpec,
} from '../catalog/catalog';
import type { FleetRobotId } from '../robots/catalog';
import { RobotViewport } from './RobotViewport';
import '../catalog/catalog.css';

function SourceDate({ source }: { source: Pick<TechnicalSpec, 'sourceUrl' | 'checkedAt'> }) {
  return (
    <a
      className="catalog-source-date"
      href={source.sourceUrl}
      target="_blank"
      rel="noreferrer"
      aria-label={`Source checked by Omblet on ${source.checkedAt}`}
    >
      {source.checkedAt} <ArrowUpRight size={12} />
    </a>
  );
}
function Portrait({ robot, card = false }: { robot: CatalogRobot; card?: boolean }) {
  const css = Object.fromEntries(
    (robot.imageStyle ?? '')
      .split(';')
      .map((rule) => rule.split(':'))
      .filter((rule) => rule.length === 2),
  );
  return (
    <img
      src={robot.image}
      alt={`Editorial portrait of ${robot.manufacturer} ${robot.name}`}
      loading="lazy"
      decoding="async"
      style={
        card
          ? { width: css.width ?? '100%', top: css.top ?? '0%', height: robot.imageStyle ? 'auto' : '100%' }
          : undefined
      }
    />
  );
}
function CompareButton({
  robot,
  selected,
  full,
  onToggle,
}: {
  robot: CatalogRobot;
  selected: boolean;
  full: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <button
      className={`catalog-button ${selected ? 'is-selected' : ''}`}
      aria-pressed={selected}
      disabled={full && !selected}
      aria-label={`${selected ? 'Remove' : 'Add'} ${robot.manufacturer} ${robot.name} ${selected ? 'from' : 'to'} comparison`}
      onClick={() => onToggle(robot.id)}
    >
      {selected ? <Check size={15} /> : <BarChart3 size={15} />} {selected ? 'Added to compare' : 'Compare'}
    </button>
  );
}

export default function CatalogPage({ onOpenLab }: { onOpenLab: (model?: FleetRobotId) => void }) {
  const [route, setRoute] = useState(() => parseCatalogRoute(location.hash));
  const [selected, setSelected] = useState<string[]>(() => {
    const initial = parseCatalogRoute(location.hash);
    return initial.page === 'compare' && initial.ids !== null ? initial.ids : storedSelection();
  });
  const [query, setQuery] = useState(''),
    [search, setSearch] = useState('');
  const [manufacturer, setManufacturer] = useState(''),
    [availability, setAvailability] = useState('');
  const [maxPrice, setMaxPrice] = useState(''),
    [support, setSupport] = useState(''),
    [sort, setSort] = useState('maker');
  const [filtersOpen, setFiltersOpen] = useState(false),
    [limit, setLimit] = useState(12);
  const [differences, setDifferences] = useState(false),
    [notice, setNotice] = useState('');
  const [detailTab, setDetailTab] = useState<'specs' | '3d'>('specs');
  const [addOpen, setAddOpen] = useState(false),
    [addQuery, setAddQuery] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const pickerOpener = useRef<HTMLElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const update = () => {
      const next = parseCatalogRoute(location.hash);
      setRoute(next);
      setDetailTab('specs');
      setNotice('');
      setLimit(12);
      if (next.page === 'compare' && next.ids !== null) setSelected(next.ids);
      window.scrollTo({ top: 0, behavior: 'instant' });
      requestAnimationFrame(() => heading.current?.focus({ preventScroll: true }));
    };
    addEventListener('hashchange', update);
    return () => removeEventListener('hashchange', update);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(COMPARE_KEY, JSON.stringify(selected));
    } catch {
      /* In-memory comparison remains available. */
    }
  }, [selected]);
  useEffect(() => {
    setLimit(12);
  }, [query, manufacturer, availability, maxPrice, support, sort]);
  useEffect(() => {
    if (addOpen) {
      pickerOpener.current = document.activeElement as HTMLElement | null;
      dialog.current?.showModal();
    } else if (dialog.current?.open) {
      dialog.current.close();
      pickerOpener.current?.focus();
    }
  }, [addOpen]);
  const compared = selected.map((id) => CATALOG.find((r) => r.id === id)!).filter(Boolean);
  const category = route.page === 'discover' ? route.category : '';
  const shown = useMemo(
    () => filterCatalog(CATALOG, { category, query, manufacturer, availability, maxPrice, support, sort }),
    [category, query, manufacturer, availability, maxPrice, support, sort],
  );
  const rows = useMemo(() => comparisonRows(compared, differences), [selected, differences]);
  function changeSelection(next: string[]) {
    setSelected(next);
    if (route.page === 'compare') history.replaceState(null, '', compareHref(next));
  }
  function toggle(id: string) {
    if (selected.includes(id)) changeSelection(selected.filter((s) => s !== id));
    else if (selected.length < 4) changeSelection([...selected, id]);
    else setNotice('Your comparison has four robots. Remove one to add another.');
  }
  function resetFilters() {
    setQuery('');
    setSearch('');
    setManufacturer('');
    setAvailability('');
    setMaxPrice('');
    setSupport('');
    setSort('maker');
  }
  function exportCsv() {
    const url = URL.createObjectURL(
      new Blob([comparisonCsv(compared, differences)], { type: 'text/csv;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'first-contact-robot-comparison.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function copyLink() {
    const link = new URL(compareHref(selected), location.href).href;
    try {
      await navigator.clipboard.writeText(link);
      setNotice('Comparison link copied.');
    } catch {
      setNotice(`Copy this comparison address: ${link}`);
    }
  }
  const activeFilters = [manufacturer, availability, maxPrice, support].filter(Boolean).length;
  const robot = route.page === 'detail' ? CATALOG.find((r) => r.id === route.id) : null;
  const full = selected.length === 4;
  const compareButton = (r: CatalogRobot) => (
    <CompareButton robot={r} selected={selected.includes(r.id)} full={full} onToggle={toggle} />
  );
  const renderSpecs = (r: CatalogRobot) => {
    const specifications = comparisonRows([r]);
    return (
      <div className="catalog-spec-table-wrap">
        <table className="catalog-spec-table">
          <caption className="sr-only">
            {r.manufacturer} {r.name} technical specifications
          </caption>
          <thead>
            <tr>
              <th scope="col">Attribute</th>
              <th scope="col">Reported value</th>
              <th scope="col">Source checked</th>
            </tr>
          </thead>
          <tbody>
            {specifications.map((row, index) => (
              <Fragment key={row.key}>
                {(index === 0 || specifications[index - 1].section !== row.section) && (
                  <tr className="catalog-section-row">
                    <th colSpan={3} scope="colgroup">
                      {row.section}
                    </th>
                  </tr>
                )}
                <tr>
                  <th scope="row">{row.label}</th>
                  <td>{row.cells[0]!.value}</td>
                  <td>
                    <SourceDate source={row.cells[0]!} />
                  </td>
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    );
  };
  return (
    <main className={`catalog-page catalog-${route.page}`} id="robot-catalog" tabIndex={-1}>
      <div className="catalog-local-nav">
        <a href={categoryHref()}>Discover robots</a>
        <a href={compareHref(selected)}>
          <BarChart3 size={15} /> Compare{selected.length > 0 && <span>({selected.length})</span>}
        </a>
      </div>
      {route.page === 'discover' && (
        <>
          <section className="catalog-hero" aria-labelledby="catalog-heading">
            <div className="catalog-count">
              <span>{category ? 5 : CATALOG.length}</span>{' '}
              {category ? categoryLabel(category) : `Robots · ${CATEGORIES.length} categories`}
            </div>
            <h1 id="catalog-heading" ref={heading} tabIndex={-1}>
              A world of robots.
              <br />
              Yours to explore.
            </h1>
            <p>
              Explore real robots, compare their specifications, and find the right platform for your next
              experiment.
            </p>
            <form
              className="catalog-search"
              onSubmit={(e) => {
                e.preventDefault();
                setQuery(search);
              }}
            >
              <label className="sr-only" htmlFor="catalog-search-input">
                Search robots, makers or purposes
              </label>
              <input
                id="catalog-search-input"
                type="search"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  if (!e.target.value) setQuery('');
                }}
                placeholder="Search robots, makers or purposes"
              />
              <button type="submit">Search</button>
            </form>
          </section>
          <div className="catalog-filter-bar">
            <nav className="catalog-category-links" aria-label="Robot classifications">
              <a href={categoryHref()} aria-current={!category ? 'page' : undefined}>
                All robots
              </a>
              {CATEGORIES.map((c) => (
                <a key={c.id} href={categoryHref(c.id)} aria-current={category === c.id ? 'page' : undefined}>
                  {c.label}
                </a>
              ))}
              <button
                aria-expanded={filtersOpen}
                aria-controls="catalog-filter-panel"
                onClick={() => setFiltersOpen(!filtersOpen)}
              >
                <SlidersHorizontal size={13} /> More filters{activeFilters > 0 ? ` (${activeFilters})` : ''}
              </button>
            </nav>
            <div className="catalog-filter-count">
              <button
                onClick={() => {
                  resetFilters();
                  location.hash = categoryHref();
                }}
              >
                Clear filters
              </button>
              <span role="status">{shown.length} robots</span>
            </div>
          </div>
          {filtersOpen && (
            <div className="catalog-filter-panel" id="catalog-filter-panel">
              <label>
                Manufacturer
                <select
                  aria-label="Manufacturer"
                  value={manufacturer}
                  onChange={(e) => setManufacturer(e.target.value)}
                >
                  <option value="">All makers</option>
                  {[...new Set(CATALOG.map((r) => r.manufacturer))].sort().map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </label>
              <label>
                Availability
                <select
                  aria-label="Availability"
                  value={availability}
                  onChange={(e) => setAvailability(e.target.value)}
                >
                  <option value="">Any availability</option>
                  {[...new Set(CATALOG.map((r) => r.availability))].sort().map((a) => (
                    <option key={a} value={a}>
                      {a.replaceAll('-', ' ')}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Max. starting price (USD)
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(e.target.value)}
                  placeholder="No limit"
                />
              </label>
              <label>
                In this app
                <select aria-label="In this app" value={support} onChange={(e) => setSupport(e.target.value)}>
                  <option value="">All catalog entries</option>
                  <option value="3d">3D inspection available</option>
                  <option value="physics">Episode model available</option>
                </select>
              </label>
              <label>
                Sort by
                <select aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value)}>
                  <option value="maker">Manufacturer</option>
                  <option value="name">Robot name</option>
                  <option value="price">Starting price · low to high</option>
                </select>
              </label>
              <p>A price cap excludes unknown prices. Availability is from the dated source record.</p>
            </div>
          )}
          {query && (
            <div className="catalog-query">
              Results for “{query}”{' '}
              <button
                aria-label="Clear search"
                onClick={() => {
                  setSearch('');
                  setQuery('');
                }}
              >
                <X size={14} />
              </button>
            </div>
          )}
          <div className="catalog-grid">
            {shown.slice(0, limit).map((item) => (
              <article
                className="catalog-card"
                key={item.id}
                style={{ '--robot-paper': item.color } as React.CSSProperties}
              >
                <a className="catalog-card-link" href={robotHref(item.id)}>
                  <div className="catalog-maker">
                    <span>
                      <img src={item.logo} alt="" width={28} height={28} />
                      {item.manufacturer}
                    </span>
                    <i>
                      <ArrowUpRight size={20} />
                    </i>
                  </div>
                  <div className="catalog-card-art">
                    <Portrait robot={item} card />
                  </div>
                </a>
                <div className="catalog-card-copy">
                  <a href={robotHref(item.id)}>
                    <span className="catalog-form">{item.category.replaceAll('-', ' ')}</span>
                    <div className="catalog-card-title">
                      <h2>{item.name}</h2>
                      <span>
                        {item.priceUsd !== null ? 'From ' : ''}
                        {formatPrice(item.priceUsd)}
                        {item.priceUsd !== null ? ' USD' : ''}
                      </span>
                    </div>
                  </a>
                  <p>{item.purpose}. Explore the technical specifications and configuration details.</p>
                  <div className="catalog-card-actions">
                    {compareButton(item)}
                    {item.assetId && (
                      <span className="catalog-support-badge">
                        {item.simulationModelId ? 'Episode model' : '3D inspection'}
                      </span>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
          {shown.length === 0 && (
            <div className="catalog-empty">
              <Search size={30} />
              <h2>No robots match these filters.</h2>
              <p>Try a different category, maker or search term.</p>
              <button
                className="catalog-button"
                onClick={() => {
                  resetFilters();
                  location.hash = categoryHref();
                }}
              >
                Reset filters
              </button>
            </div>
          )}
          {shown.length > limit && (
            <div className="catalog-load-more">
              <span>
                {Math.min(limit, shown.length)} of {shown.length} robots loaded
              </span>
              <button className="catalog-button" onClick={() => setLimit((n) => n + 12)}>
                Load more robots
              </button>
            </div>
          )}
          <p className="catalog-provenance">
            Five selected models per classification from{' '}
            <a href="https://omblet.com/" target="_blank" rel="noreferrer">
              Omblet
            </a>{' '}
            · Snapshot {CAPTURED_AT}. Editorial product portraits are not to scale. Catalog inclusion does not
            mean a simulation model is available.
          </p>
        </>
      )}
      {route.page === 'detail' &&
        (robot ? (
          <>
            <nav className="catalog-breadcrumb" aria-label="Breadcrumb">
              <a href={categoryHref()}>All robots</a>
              <ChevronRight size={13} />
              <a href={categoryHref(robot.category)}>{categoryLabel(robot.category)}</a>
              <ChevronRight size={13} />
              <span>{robot.name}</span>
            </nav>
            <div className="catalog-gallery">
              <div className="catalog-gallery-main">
                <Portrait robot={robot} />
              </div>
              {robot.gallery.map((entry) => (
                <div key={entry.image}>
                  <img src={entry.image} alt={entry.alt} loading="lazy" decoding="async" />
                </div>
              ))}
            </div>
            <p className="catalog-portrait-credit">Editorial product portraits from Omblet · not to scale</p>
            <div className="catalog-detail-summary">
              <section>
                <div className="catalog-detail-maker">
                  <img src={robot.logo} alt="" width={28} height={28} />
                  {robot.manufacturer}
                </div>
                <h1 ref={heading} tabIndex={-1}>
                  {robot.name}
                </h1>
                <p>
                  {robot.purpose}. Specifications below retain the source’s hardware variants and operating
                  conditions.
                </p>
                <dl>
                  <div>
                    <dt>Form</dt>
                    <dd>{categoryLabel(robot.category)}</dd>
                  </div>
                  <div>
                    <dt>Purpose</dt>
                    <dd>{robot.purpose}</dd>
                  </div>
                  <div>
                    <dt>In this app</dt>
                    <dd>
                      {robot.simulationModelId
                        ? 'Experimental episode model'
                        : robot.assetId
                          ? '3D inspection only'
                          : 'Catalog and comparison'}
                    </dd>
                  </div>
                </dl>
              </section>
              <aside>
                <span className="catalog-mono">Listed price · USD</span>
                <strong>{formatPrice(robot.priceUsd)}</strong>
                <p>{robot.priceNote || 'No price supplied in the captured catalog record.'}</p>
                <div className="catalog-detail-availability">
                  Availability <span>{robot.availability.replaceAll('-', ' ')}</span>
                </div>
                <div className="catalog-detail-actions">
                  {compareButton(robot)}
                  {robot.simulationModelId && (
                    <button
                      className="catalog-button catalog-primary"
                      onClick={() => onOpenLab(robot.simulationModelId!)}
                    >
                      Use in robot lab
                    </button>
                  )}
                </div>
                <div className="catalog-detail-sources">
                  <a href={robot.catalogUrl} target="_blank" rel="noreferrer">
                    Omblet record <ArrowUpRight size={12} />
                  </a>
                  <a href={robot.sourceUrl} target="_blank" rel="noreferrer">
                    Manufacturer <ArrowUpRight size={12} />
                  </a>
                  <span>Checked {robot.checkedAt}</span>
                </div>
              </aside>
            </div>
            {robot.id === 'clearpath-husky-a300' && (
              <p className="catalog-model-note">
                The existing Husky simulation uses an earlier source description. It is not an A300 model;
                A300 physics is not available.
              </p>
            )}
            <div className="catalog-detail-tabs" role="tablist" aria-label="Robot details">
              <button role="tab" aria-selected={detailTab === 'specs'} onClick={() => setDetailTab('specs')}>
                <Table2 size={15} /> Specifications
              </button>
              {robot.assetId && (
                <button role="tab" aria-selected={detailTab === '3d'} onClick={() => setDetailTab('3d')}>
                  3D model
                </button>
              )}
            </div>
            {detailTab === '3d' && robot.assetId ? (
              <section className="catalog-model-preview" role="tabpanel">
                <RobotViewport id={robot.assetId} />
                <p>
                  This licensed source-description model is separate from the editorial portrait and published
                  hardware specifications.{' '}
                  {robot.assetId === 'unitree-go2'
                    ? 'Go2 is shown in a standing pose; a walking controller is not integrated.'
                    : 'Experimental control and virtual sensors have not been calibrated against physical hardware.'}
                </p>
                <a href={`/robots/${robot.assetId}/manifest.json`} target="_blank" rel="noreferrer">
                  Model provenance and license
                </a>
              </section>
            ) : (
              <section role="tabpanel">
                <div className="catalog-section-heading">
                  <h2>
                    <Table2 size={17} /> Technical specifications
                  </h2>
                  <p>
                    Manufacturer-reported values as recorded by Omblet. Source dates and configuration notes
                    are preserved.
                  </p>
                </div>
                {renderSpecs(robot)}
              </section>
            )}
          </>
        ) : (
          <div className="catalog-empty">
            <h1 ref={heading} tabIndex={-1}>
              Robot not found
            </h1>
            <a className="catalog-button" href={categoryHref()}>
              Browse the catalog
            </a>
          </div>
        ))}
      {route.page === 'compare' && (
        <>
          <nav className="catalog-breadcrumb" aria-label="Breadcrumb">
            <a href={categoryHref()}>All robots</a>
            <ChevronRight size={13} />
            <span>Compare</span>
          </nav>
          <div className="catalog-compare-heading">
            <div>
              <h1 ref={heading} tabIndex={-1}>
                Find your fit.
              </h1>
              <p>Robots, side by side. Compare specifications, configurations and purchase details.</p>
            </div>
            <div>
              <button className="catalog-button catalog-quiet" onClick={() => void copyLink()}>
                <Link size={15} /> Copy link
              </button>
              <button
                className="catalog-button catalog-quiet"
                onClick={exportCsv}
                disabled={!compared.length}
              >
                <Download size={15} /> Export CSV
              </button>
            </div>
          </div>
          <div className="catalog-selection-bar">
            <span className="catalog-mono">{selected.length} of 4 robots selected</span>
            <div>
              <button
                className="catalog-button catalog-quiet"
                onClick={() => changeSelection([])}
                disabled={!selected.length}
              >
                Clear all
              </button>
              <button className="catalog-button" onClick={() => setAddOpen(true)} disabled={full}>
                <Plus size={16} /> Add a robot
              </button>
            </div>
          </div>
          {compared.length > 0 ? (
            <>
              <div className="catalog-comparison-options">
                <div className="catalog-section-heading">
                  <h2>
                    <Table2 size={17} /> Specifications
                  </h2>
                  <p>Original labels and measurement conditions stay with each value.</p>
                </div>
                <label>
                  <input
                    type="checkbox"
                    checked={differences}
                    disabled={compared.length < 2}
                    onChange={(e) => setDifferences(e.target.checked)}
                  />{' '}
                  Show differences only
                </label>
              </div>
              <div className="catalog-table-meta">
                <span>
                  {rows.length} specifications · {compared.length} robots
                </span>
                <span>Scroll to explore · Sources linked by date</span>
              </div>
              <div
                className="catalog-comparison-scroll"
                role="region"
                aria-label="Robot technical comparison, scroll horizontally for more robots"
                tabIndex={0}
              >
                <table className="catalog-comparison-table" style={{ minWidth: 180 + compared.length * 290 }}>
                  <caption className="sr-only">
                    Technical comparison. Missing values are not reported in this snapshot, not zero.
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">
                        <span className="catalog-mono">
                          Compare
                          <br />
                          the details
                        </span>
                      </th>
                      {compared.map((r) => (
                        <th scope="col" key={r.id}>
                          <button
                            className="catalog-remove"
                            aria-label={`Remove ${r.name} from comparison`}
                            onClick={() => toggle(r.id)}
                          >
                            <X size={14} />
                          </button>
                          <a href={robotHref(r.id)}>
                            <Portrait robot={r} />
                            <span>{r.manufacturer}</span>
                            <strong>{r.name}</strong>
                          </a>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th scope="row">
                        Listed price
                        <br />
                        <small>USD</small>
                      </th>
                      {compared.map((r) => (
                        <td key={r.id}>
                          <strong className="catalog-price">{formatPrice(r.priceUsd)}</strong>
                          <p>{r.priceNote || 'Not reported'}</p>
                          <SourceDate source={r} />
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <th scope="row">Availability</th>
                      {compared.map((r) => (
                        <td key={r.id}>{r.availability.replaceAll('-', ' ')}</td>
                      ))}
                    </tr>
                    <tr>
                      <th scope="row">Form & purpose</th>
                      {compared.map((r) => (
                        <td key={r.id}>
                          {categoryLabel(r.category)}
                          <p className="catalog-cell-purpose">{r.purpose}</p>
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <th scope="row">Simulation support</th>
                      {compared.map((r) => (
                        <td key={r.id}>
                          {r.simulationModelId
                            ? 'Experimental episode model'
                            : r.assetId
                              ? '3D inspection only'
                              : 'Catalog only'}
                        </td>
                      ))}
                    </tr>
                    {rows.map((row, index) => (
                      <Fragment key={row.key}>
                        {(index === 0 || rows[index - 1].section !== row.section) && (
                          <tr className="catalog-section-row">
                            <th scope="colgroup" colSpan={compared.length + 1}>
                              {row.section}
                            </th>
                          </tr>
                        )}
                        <tr>
                          <th scope="row">{row.label}</th>
                          {row.cells.map((cell, i) => (
                            <td key={compared[i].id}>
                              {cell ? (
                                <>
                                  <div className="catalog-spec-value">{cell.value}</div>
                                  <SourceDate source={cell} />
                                </>
                              ) : (
                                <span className="catalog-missing">Not reported</span>
                              )}
                            </td>
                          ))}
                        </tr>
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="catalog-provenance">
                “Not reported” means this snapshot has no value under that exact attribute. Related
                measurements with different conditions remain separate. These are sourced claims, not
                independent performance benchmarks.
              </p>
            </>
          ) : (
            <div className="catalog-empty">
              <BarChart3 size={36} />
              <h2>Build your comparison.</h2>
              <p>Add up to four robots from any classification.</p>
              <button className="catalog-button catalog-primary" onClick={() => setAddOpen(true)}>
                <Plus size={16} /> Choose robots
              </button>
            </div>
          )}
        </>
      )}
      {notice && (
        <p className="catalog-notice" role="status">
          {notice}
          <button aria-label="Dismiss catalog notification" onClick={() => setNotice('')}>
            <X size={14} />
          </button>
        </p>
      )}
      <footer className="catalog-footer">
        <div>
          <strong>FIRST CONTACT / ROBOT CATALOG</strong>
          <p>
            {CATALOG.length} selected robots. {CATEGORIES.length} classifications. Specifications with
            sources.
          </p>
        </div>
        <div>
          <a href="https://omblet.com/" target="_blank" rel="noreferrer">
            Catalog & portraits: Omblet <ArrowUpRight size={12} />
          </a>
          <a href="/catalog/asset-manifest.json" target="_blank" rel="noreferrer">
            Snapshot and asset attribution
          </a>
          <span>Captured {CAPTURED_AT} · Manufacturer marks belong to their owners.</span>
        </div>
      </footer>
      {selected.length > 0 && route.page !== 'compare' && (
        <aside className="catalog-compare-tray" aria-label="Selected robots">
          <div className="catalog-tray-top">
            <span>
              Your comparison <b>{selected.length} / 4</b>
              {full && <small> · Remove one to swap</small>}
            </span>
            <div>
              <button className="catalog-button catalog-quiet" onClick={() => changeSelection([])}>
                Clear
              </button>
              <a
                className={`catalog-button catalog-primary ${selected.length < 2 ? 'catalog-disabled' : ''}`}
                href={selected.length >= 2 ? compareHref(selected) : undefined}
                aria-disabled={selected.length < 2}
              >
                <BarChart3 size={16} /> Compare {selected.length} robots
              </a>
            </div>
          </div>
          <div className="catalog-tray-items">
            {compared.map((r) => (
              <div key={r.id}>
                <img src={r.image} alt="" />
                <span>
                  {r.manufacturer} {r.name}
                </span>
                <button aria-label={`Remove ${r.name} from shortlist`} onClick={() => toggle(r.id)}>
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        </aside>
      )}
      <dialog
        className="catalog-add-dialog"
        ref={dialog}
        onCancel={(event) => {
          event.preventDefault();
          setAddOpen(false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            setAddOpen(false);
          }
        }}
        onClick={(e) => {
          if (e.target === dialog.current) setAddOpen(false);
        }}
        aria-labelledby="catalog-add-title"
      >
        <div className="catalog-dialog-heading">
          <h2 id="catalog-add-title">Add a robot</h2>
          <button aria-label="Close robot picker" onClick={() => setAddOpen(false)}>
            <X size={20} />
          </button>
        </div>
        <label className="catalog-picker-search">
          <Search size={16} />
          <input
            type="search"
            autoFocus
            placeholder={`Search all ${CATALOG.length} robots…`}
            value={addQuery}
            onChange={(e) => setAddQuery(e.target.value)}
            aria-label="Find a robot to compare"
          />
        </label>
        <p>{selected.length} of 4 selected</p>
        <div className="catalog-picker-list">
          {!CATALOG.some((r) =>
            `${r.name} ${r.manufacturer} ${categoryLabel(r.category)}`
              .toLowerCase()
              .includes(addQuery.toLowerCase()),
          ) && <p>No robots match this search.</p>}
          {CATALOG.filter((r) =>
            `${r.name} ${r.manufacturer} ${categoryLabel(r.category)}`
              .toLowerCase()
              .includes(addQuery.toLowerCase()),
          ).map((r) => (
            <button
              key={r.id}
              disabled={full && !selected.includes(r.id)}
              onClick={() => toggle(r.id)}
              aria-pressed={selected.includes(r.id)}
            >
              <img src={r.image} alt="" />
              <span>
                <strong>
                  {r.manufacturer} {r.name}
                </strong>
                <small>{categoryLabel(r.category)}</small>
              </span>
              {selected.includes(r.id) ? <Check size={17} /> : <Plus size={17} />}
            </button>
          ))}
        </div>
        <button className="catalog-button catalog-primary" onClick={() => setAddOpen(false)}>
          View comparison
        </button>
      </dialog>
    </main>
  );
}
