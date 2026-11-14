import { useState } from 'react';
import { ArrowUpRight, Check, Search } from 'lucide-react';
import { ROBOT_CATALOG, type FleetRobotId, type RobotAssetId } from '../robots/catalog';
import { RobotViewport } from './RobotViewport';

export function RobotCatalog({
  onSelect,
  disabled,
}: {
  onSelect: (id: FleetRobotId, slot: number) => void;
  disabled: boolean;
}) {
  const [selected, setSelected] = useState<RobotAssetId>('husky');
  const [filter, setFilter] = useState('All robots');
  const [query, setQuery] = useState('');
  const [assignment, setAssignment] = useState('');
  const robot = ROBOT_CATALOG.find((r) => r.id === selected)!;
  const shown = ROBOT_CATALOG.filter(
    (r) =>
      (filter === 'All robots' || r.category === filter) &&
      `${r.name} ${r.manufacturer}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <section className="robot-library" aria-labelledby="robot-library-title">
      <div className="robot-library-heading">
        <div>
          <div className="eyebrow">SIMULATION MODELS</div>
          <h3 id="robot-library-title">Models available in this lab.</h3>
        </div>
        <a href="#/catalog">Browse full catalog ↗</a>
      </div>
      <div className="robot-library-toolbar">
        <div className="robot-filters" aria-label="Robot categories">
          {['All robots', 'Wheeled', 'Quadruped'].map((label) => (
            <button key={label} aria-pressed={filter === label} onClick={() => setFilter(label)}>
              {label}
            </button>
          ))}
        </div>
        <label className="robot-search">
          <Search size={16} />
          <input
            type="search"
            placeholder="Find a robot…"
            aria-label="Search robot library"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      <div className="robot-library-content">
        <div className="robot-product-list">
          {shown.length === 0 && <p className="muted">No robots match your search.</p>}
          {shown.map((item) => (
            <button
              className={`robot-product ${selected === item.id ? 'selected' : ''}`}
              aria-pressed={selected === item.id}
              key={item.id}
              onClick={() => setSelected(item.id)}
            >
              <div className="robot-product-image" style={{ background: item.color }}>
                <img src={`/robots/${item.id}/preview.webp`} alt="" loading="lazy" />
                <span>{item.category}</span>
                {selected === item.id && (
                  <i>
                    <Check size={16} />
                  </i>
                )}
              </div>
              <div className="robot-product-name">
                <div>
                  <small>{item.manufacturer}</small>
                  <strong>{item.name}</strong>
                </div>
                <ArrowUpRight size={20} />
              </div>
              <span className="robot-product-status">
                <i className={item.simulation ? 'ready' : ''} />
                {item.simulation ? 'Episode ready' : '3D inspection'}
              </span>
            </button>
          ))}
        </div>
        <div className="robot-inspector">
          <RobotViewport id={selected} />
          <div className="robot-inspector-info">
            <div className="robot-inspector-title">
              <div>
                <span>
                  {robot.manufacturer} / {robot.category}
                </span>
                <h4>{robot.name}</h4>
              </div>
              <span className="robot-source-badge">Source geometry</span>
            </div>
            <p className="robot-tagline">{robot.tagline}</p>
            <p>{robot.description}</p>
            <div className="robot-specs">
              <span>{robot.detail}</span>
              <span>{robot.dimensions}</span>
              <a href={robot.source} target="_blank" rel="noreferrer">
                Model source <ArrowUpRight size={12} />
              </a>
              <a href={`/robots/${selected}/LICENSE`} target="_blank" rel="noreferrer">
                BSD-3-Clause
              </a>
            </div>
            {robot.simulation ? (
              <div className="robot-deploy-actions">
                {[0, 1].map((slot) => (
                  <button
                    disabled={disabled}
                    key={slot}
                    className={slot === 0 ? 'primary-button' : 'secondary-button'}
                    onClick={() => {
                      onSelect(robot.id as FleetRobotId, slot);
                      setAssignment(
                        `${robot.name} selected as robot ${slot + 1}. Your fleet is ready below.`,
                      );
                    }}
                  >
                    Use as robot {slot + 1}
                  </button>
                ))}
              </div>
            ) : (
              <p className="robot-inspection-note">
                Inspection only · Legged locomotion is not yet connected to episode generation.
              </p>
            )}
            <p className="robot-assignment" role="status">
              {assignment}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
