import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Copy,
  FileVideo,
  ImagePlus,
  RefreshCw,
  Save,
  ShieldCheck,
} from 'lucide-react';
import { GENIE_ADAPTER } from '../scenarios/contracts';
import { SITE_LOCATIONS } from '../domain/surfaceSites';
import type {
  ExplorationArtifact,
  ExplorationInput,
  ExplorationRecord,
  ScenarioInput,
  ScenarioRecord,
} from '../scenarios/contracts';
import '../scenarios/studio.css';
import '../catalog/catalog.css';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init),
    body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? 'The request could not be completed.');
  return body as T;
}
const initial: ExplorationInput = {
  title: 'Cooperative supply route',
  body: 'moon',
  objective: 'A scout identifies a route and a carrier delivers supplies around a blocked passage.',
  prompt:
    'Explore a lunar logistics site with a scout rover and a carrier rover. Low-angle sunlight, a rocky route and an occluded obstacle. Follow the carrier from a ground-level camera. Investigate possible routes and recovery ideas.',
  model: 'unknown',
  modelRevision: null,
  settingsNotes: '',
  referenceImageSha256: null,
  recordingSha256: null,
};
const worldName = (body: string) => (body === 'moon' ? 'Moon' : body === 'mars' ? 'Mars' : 'Earth');
function downloadJson(name: string, value: unknown) {
  const href = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
export default function ScenarioStudio({ onOpenLab }: { onOpenLab: (scenario: ScenarioRecord) => void }) {
  const [draft, setDraft] = useState<ExplorationInput>(initial);
  const [reference, setReference] = useState<File | null>(null),
    [recording, setRecording] = useState<File | null>(null);
  const [records, setRecords] = useState<ExplorationRecord[]>([]),
    [scenarios, setScenarios] = useState<ScenarioRecord[]>([]);
  const [selected, setSelected] = useState<ExplorationRecord | null>(null);
  const [scenario, setScenario] = useState<Omit<ScenarioInput, 'explorationId'>>({
    title: 'Cooperative supply route',
    body: 'moon',
    robotModels: ['jackal', 'husky'],
    durationS: 12,
    speedMps: 0.35,
    seed: 1,
  });
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  const [atlas, setAtlas] = useState(false),
    [gemini, setGemini] = useState(false);
  const retry = useRef<{ payload: string; id: string } | null>(null);
  const scenarioRetry = useRef<{ payload: string; id: string } | null>(null);
  const refresh = async () => {
    const status = await api<{ atlas: { connected: boolean }; planner: { configured: boolean } }>(
      '/api/status',
    );
    setAtlas(status.atlas.connected);
    setGemini(status.planner.configured);
    const [a, b] = await Promise.all([
      api<{ explorations: ExplorationRecord[] }>('/api/explorations'),
      api<{ scenarios: ScenarioRecord[] }>('/api/scenarios'),
    ]);
    setRecords(a.explorations);
    setScenarios(b.scenarios);
  };
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, []);
  function edit<K extends keyof ExplorationInput>(key: K, value: ExplorationInput[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }
  async function upload(file: File | null): Promise<ExplorationArtifact | null> {
    if (!file) return null;
    if (file.size > (file.type.startsWith('image/') ? 8 : 32) * 1024 * 1024)
      throw new Error('Choose a reference image up to 8 MiB or a recording up to 32 MiB.');
    const url = URL.createObjectURL(file);
    try {
      if (file.type.startsWith('image/')) {
        const image = new Image();
        image.src = url;
        await image.decode();
      } else if (file.type.startsWith('video/')) {
        await new Promise<void>((resolve, reject) => {
          const video = document.createElement('video');
          const finish = (error?: Error) => {
            clearTimeout(timer);
            video.onloadedmetadata = null;
            video.onerror = null;
            video.removeAttribute('src');
            video.load();
            error ? reject(error) : resolve();
          };
          const timer = setTimeout(
            () =>
              finish(new Error('The recording preview timed out. Choose a browser-playable MP4 or WebM.')),
            10000,
          );
          video.onloadedmetadata = () =>
            finish(
              video.videoWidth > 0 && video.videoHeight > 0
                ? undefined
                : new Error('The recording has no video track.'),
            );
          video.onerror = () =>
            finish(new Error('This recording cannot be decoded. Choose a browser-playable MP4 or WebM.'));
          video.preload = 'metadata';
          video.src = url;
        });
      } else throw new Error('Choose a supported image or video.');
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'The selected file cannot be previewed.');
    } finally {
      URL.revokeObjectURL(url);
    }
    return api('/api/explorations/artifacts', {
      method: 'POST',
      headers: { 'content-type': file.type || 'application/octet-stream' },
      body: file,
    });
  }
  function useRecord(record: ExplorationRecord) {
    setSelected(record);
    setScenario((prev) => ({ ...prev, title: record.input.title, body: record.input.body }));
  }
  async function save() {
    setBusy(true);
    setError('');
    setMessage('Uploading selected evidence and saving its provenance…');
    try {
      const image = await upload(reference),
        video = await upload(recording);
      const payload = JSON.stringify({
        ...draft,
        referenceImageSha256: image?.sha256 ?? null,
        recordingSha256: video?.sha256 ?? null,
      });
      if (retry.current?.payload !== payload) retry.current = { payload, id: crypto.randomUUID() };
      const saved = await api<ExplorationRecord>('/api/explorations', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': retry.current!.id },
        body: payload,
      });
      useRecord(saved);
      setMessage(
        saved.evidenceKind === 'imported_recording'
          ? 'Recording and provenance saved. Eligible for exploration and review.'
          : 'Exploration brief saved. Add a recording in a new exploration when one is available.',
      );
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.');
      setMessage('');
    } finally {
      setBusy(false);
    }
  }
  async function compile() {
    if (!selected) return;
    setBusy(true);
    setError('');
    setMessage('Freezing scenario settings…');
    try {
      const payload = JSON.stringify({ ...scenario, explorationId: selected.id });
      if (scenarioRetry.current?.payload !== payload)
        scenarioRetry.current = { payload, id: crypto.randomUUID() };
      const saved = await api<ScenarioRecord>('/api/scenarios', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': scenarioRetry.current!.id },
        body: payload,
      });
      setScenarios((prev) => [saved, ...prev.filter((s) => s.id !== saved.id)].slice(0, 20));
      setMessage(
        saved.execution.runnable
          ? 'Scenario frozen. Open it in Robot lab and capture a Dingo Gap patch to run.'
          : 'Scenario saved for design review. Its environment is not yet supported by the physics worker.',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Scenario failed.');
      setMessage('');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="scenario-studio" id="scenario-studio" tabIndex={-1}>
      <header className="studio-heading">
        <div className="eyebrow">SCENARIO STUDIO / WORLD MODEL EXPLORATION</div>
        <h1>
          Explore possibilities.
          <br />
          Keep the evidence.
        </h1>
        <p>
          Sketch a mission in Google Genie. Bring the idea and its provenance into a physical robot
          experiment.
        </p>
      </header>
      <div className="studio-services" aria-label="Integration status">
        <span>
          <b>Gemini</b>
          {gemini ? 'Planner configured' : 'Planner not configured'}
        </span>
        <span>
          <b>Google Genie</b>Manual exploration · API unverified
        </span>
        <span>
          <b>MuJoCo</b>Dingo Gap pilot
        </span>
        <span>
          <b>Atlas</b>
          {atlas ? 'Connected' : 'Not connected'}
        </span>
      </div>
      <section className="studio-bridge">
        <div>
          <span className="eyebrow">01 / EXPLORE IN GENIE</span>
          <h2>Start with a world. Find a mission.</h2>
          <p>
            Use your Project Genie account to explore. Import a downloaded video below; this app does not
            generate Genie worlds or send robot actions to Google.
          </p>
        </div>
        <a
          className="catalog-button catalog-primary"
          href={GENIE_ADAPTER.productUrl}
          target="_blank"
          rel="noreferrer"
        >
          Open Project Genie <ArrowUpRight size={16} />
        </a>
      </section>
      <div className="studio-columns">
        <form
          className="studio-panel studio-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="eyebrow">02 / CAPTURE THE EXPLORATION</div>
          <h2>A prompt, with provenance.</h2>
          <fieldset disabled={busy}>
            <label>
              Exploration title
              <input
                required
                maxLength={120}
                value={draft.title}
                onChange={(e) => edit('title', e.target.value)}
              />
            </label>
            <div className="studio-fields">
              <label>
                Exploration world
                <select
                  value={draft.body}
                  onChange={(e) => edit('body', e.target.value as ExplorationInput['body'])}
                >
                  <option value="moon">Moon</option>
                  <option value="mars">Mars</option>
                  <option value="earth">Earth</option>
                </select>
              </label>
              <label>
                Reported Genie model
                <select
                  value={draft.model}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      model: e.target.value as ExplorationInput['model'],
                      modelRevision: null,
                    }))
                  }
                >
                  <option value="unknown">Not exposed / unknown</option>
                  <option value="genie-3">Genie 3</option>
                  <option value="genie-4">Genie 4</option>
                </select>
              </label>
            </div>
            <label>
              Mission intent
              <textarea
                required
                rows={3}
                maxLength={2000}
                value={draft.objective}
                onChange={(e) => edit('objective', e.target.value)}
              />
            </label>
            <label>
              World prompt
              <textarea
                required
                rows={5}
                maxLength={8000}
                value={draft.prompt}
                onChange={(e) => edit('prompt', e.target.value)}
              />
            </label>
            <button
              className="catalog-button"
              type="button"
              onClick={() =>
                void navigator.clipboard
                  .writeText(draft.prompt)
                  .then(() => setMessage('World prompt copied.'))
                  .catch(() => setError('Select and copy the prompt text manually.'))
              }
            >
              <Copy size={14} /> Copy prompt
            </button>
            <div className="studio-upload">
              <label>
                <ImagePlus size={18} /> Reference image{' '}
                <small>Optional · PNG, JPEG or WebP · up to 8 MiB</small>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => setReference(e.target.files?.[0] ?? null)}
                />
              </label>
              <p>Visual conditioning only. An image does not preserve measured terrain geometry.</p>
            </div>
            <div className="studio-upload">
              <label>
                <FileVideo size={18} /> Genie exploration recording{' '}
                <small>Optional · MP4 or WebM · up to 32 MiB</small>
                <input
                  type="file"
                  accept="video/mp4,video/webm"
                  onChange={(e) => setRecording(e.target.files?.[0] ?? null)}
                />
              </label>
              <p>
                Without a recording, this saves a prompt brief. Uploaded bytes receive a server-computed
                SHA-256 hash.
              </p>
            </div>
            <details>
              <summary>Model and generation details</summary>
              <label>
                Exact model revision, if exposed
                <input
                  disabled={draft.model === 'unknown'}
                  maxLength={120}
                  value={draft.modelRevision ?? ''}
                  onChange={(e) => edit('modelRevision', e.target.value || null)}
                  placeholder="Leave blank when unknown"
                />
              </label>
              <label>
                Generation settings and limitations
                <textarea
                  rows={3}
                  maxLength={2000}
                  value={draft.settingsNotes}
                  onChange={(e) => edit('settingsNotes', e.target.value)}
                  placeholder="Record settings actually exposed by Project Genie."
                />
              </label>
            </details>
            <button className="catalog-button catalog-primary" type="submit">
              <Save size={15} />
              {busy ? 'Saving…' : 'Save exploration to Atlas'}
            </button>
          </fieldset>
        </form>
        <div className="studio-side">
          <section className="studio-panel studio-evidence">
            <div className="eyebrow">EVIDENCE BEFORE ELIGIBILITY</div>
            <h2>Different origins. Clear boundaries.</h2>
            <p>
              Genie records support exploration and review. Control learning, imitation, perception
              supervision and evaluation require separate validation.
            </p>
            <ul>
              {GENIE_ADAPTER.capabilities.map((c) => (
                <li key={c.id}>
                  <span>{c.label}</span>
                  <small>Unverified</small>
                </li>
              ))}
            </ul>
            <a href={GENIE_ADAPTER.documentationUrl} target="_blank" rel="noreferrer">
              Google model and access information <ArrowUpRight size={13} />
            </a>
            <p className="muted">
              Genie 3 and Genie 4 are recorded separately. An existing Gemini key does not establish Genie
              access. Isaac Sim and Cosmos remain planned adapters.
            </p>
          </section>
          <section className="studio-panel">
            <div className="studio-section-head">
              <div>
                <div className="eyebrow">ATLAS / LATEST 20</div>
                <h2>Exploration library</h2>
              </div>
              <button
                className="icon-button"
                aria-label="Refresh explorations"
                disabled={busy}
                onClick={() => void refresh().catch((e) => setError(e.message))}
              >
                <RefreshCw size={16} />
              </button>
            </div>
            {!records.length && <p>Saved briefs and imported experiences will appear here.</p>}
            <div className="studio-records">
              {records.map((r) => (
                <button
                  key={r.id}
                  className={selected?.id === r.id ? 'selected' : ''}
                  onClick={() => useRecord(r)}
                >
                  <strong>{r.input.title}</strong>
                  <span>
                    {worldName(r.input.body)} ·{' '}
                    {r.input.model === 'unknown' ? 'Model unknown' : r.input.model} ·{' '}
                    {r.evidenceKind === 'exploration_brief' ? 'Prompt brief' : 'Imported video'}
                  </span>
                  <small>{new Date(r.createdAt).toLocaleDateString()}</small>
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
      <div className="studio-notifications" aria-live="polite">
        {message && <p role="status">{message}</p>}
        {error && (
          <p className="operation-error" role="alert">
            {error}
          </p>
        )}
      </div>
      {selected && (
        <section className="studio-panel studio-selected">
          <div className="studio-section-head">
            <div>
              <div className="eyebrow">SELECTED EXPLORATION</div>
              <h2>{selected.input.title}</h2>
            </div>
            <button
              className="catalog-button"
              onClick={() => downloadJson(`exploration-${selected.id}.json`, selected)}
            >
              Export provenance
            </button>
          </div>
          <p>{selected.input.objective}</p>
          <div className="studio-artifacts">
            {selected.artifacts.map((a) => (
              <figure key={a.sha256}>
                {a.mediaType.startsWith('video/') ? (
                  <video controls preload="metadata" src={a.downloadUrl} />
                ) : (
                  <img src={a.downloadUrl} alt="Visual reference supplied for the exploration" />
                )}
                <figcaption>
                  {a.mediaType} · {(a.bytes / 1024 / 1024).toFixed(2)} MiB{' '}
                  <a href={a.downloadUrl} download>
                    Download original
                  </a>
                  <code>{a.sha256}</code>
                </figcaption>
              </figure>
            ))}
          </div>
          <details>
            <summary>Provenance and known limits</summary>
            <p>
              Source: generative_world_model · Identity: operator reported · Revision:{' '}
              {selected.input.modelRevision ?? 'unknown'}
            </p>
            <p>{selected.input.settingsNotes || 'No generation settings reported.'}</p>
            <ul>
              {selected.knownLimits.map((limit) => (
                <li key={limit}>{limit}</li>
              ))}
            </ul>
            <p>{selected.eligibility.reason}</p>
          </details>
          <form
            className="studio-scenario"
            onSubmit={(event) => {
              event.preventDefault();
              void compile();
            }}
          >
            <div className="eyebrow">03 / REBUILD AS A PHYSICAL EXPERIMENT</div>
            <h2>Freeze a scenario version.</h2>
            <p>
              The current worker runs a bounded two-rover traverse on measured Earth, Moon or Mars terrain.
              Your mission intent remains attached as a design idea; it is not yet an executable cooperative
              policy.
            </p>
            <fieldset disabled={busy}>
              <label>
                Scenario title
                <input
                  required
                  maxLength={120}
                  value={scenario.title}
                  onChange={(e) => setScenario((p) => ({ ...p, title: e.target.value }))}
                />
              </label>
              <div className="studio-fields">
                <label>
                  Evaluation world
                  <select
                    value={scenario.body}
                    onChange={(e) =>
                      setScenario((p) => ({ ...p, body: e.target.value as ScenarioInput['body'] }))
                    }
                  >
                    <option value="moon">Moon · Apollo 17 pilot</option>
                    <option value="mars">Mars · Dingo Gap pilot</option>
                    <option value="earth">Earth · Amboy Crater pilot</option>
                  </select>
                </label>
                <label>
                  Duration
                  <select
                    value={scenario.durationS}
                    onChange={(e) => setScenario((p) => ({ ...p, durationS: Number(e.target.value) }))}
                  >
                    <option value={5}>5 seconds</option>
                    <option value={12}>12 seconds</option>
                    <option value={20}>20 seconds</option>
                  </select>
                </label>
              </div>
              {selected.input.body !== scenario.body && (
                <p className="studio-adaptation">
                  This explicitly adapts the {worldName(selected.input.body)} idea to{' '}
                  {worldName(scenario.body)}. Both worlds remain in the provenance.
                </p>
              )}
              <div className="studio-fields">
                {scenario.robotModels.map((model, index) => (
                  <label key={index}>
                    Robot {index + 1}
                    <select
                      value={model}
                      onChange={(e) =>
                        setScenario((p) => {
                          const models = [...p.robotModels] as ScenarioInput['robotModels'];
                          models[index] = e.target.value as ScenarioInput['robotModels'][number];
                          return { ...p, robotModels: models };
                        })
                      }
                    >
                      <option value="jackal">Clearpath Jackal</option>
                      <option value="husky">Clearpath Husky</option>
                    </select>
                  </label>
                ))}
              </div>
              <div className="studio-fields">
                <label>
                  Speed
                  <select
                    value={scenario.speedMps}
                    onChange={(e) => setScenario((p) => ({ ...p, speedMps: Number(e.target.value) }))}
                  >
                    <option value={0.2}>0.2 m/s</option>
                    <option value={0.35}>0.35 m/s</option>
                    <option value={0.5}>0.5 m/s</option>
                  </select>
                </label>
                <label>
                  Seed
                  <input
                    type="number"
                    min={0}
                    max={4294967295}
                    step={1}
                    required
                    value={scenario.seed}
                    onChange={(e) => setScenario((p) => ({ ...p, seed: Number(e.target.value) }))}
                  />
                </label>
              </div>
              <button className="catalog-button catalog-primary">
                <ShieldCheck size={16} /> Freeze scenario
              </button>
            </fieldset>
          </form>
        </section>
      )}
      <section className="studio-panel studio-scenarios">
        <div className="eyebrow">IMMUTABLE SETTINGS / LATEST 20</div>
        <h2>Scenario versions</h2>
        {!scenarios.length && <p>Select a saved exploration to build your first scenario.</p>}
        <div className="studio-version-grid">
          {scenarios.map((s) => (
            <article key={s.id}>
              <div className="eyebrow">
                {worldName(s.input.body)} / {s.execution.runnable ? 'REFERENCE TRAVERSE' : 'DESIGN ONLY'}
              </div>
              <h3>{s.input.title}</h3>
              <p>
                {s.input.robotModels.join(' + ')} · {s.input.durationS} s · {s.input.speedMps} m/s
              </p>
              <p>
                {s.execution.blockers.join(' ') ||
                  `Capture a measured ${SITE_LOCATIONS[s.execution.terrain].label} patch in Robot lab to execute.`}
              </p>
              <code>{s.sha256}</code>
              <div className="studio-actions">
                <button className="catalog-button" onClick={() => downloadJson(`scenario-${s.id}.json`, s)}>
                  Export specification
                </button>
                <button
                  className="catalog-button catalog-primary"
                  disabled={!s.execution.runnable}
                  onClick={() => onOpenLab(s)}
                >
                  Open in Robot lab <ArrowRight size={14} />
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
