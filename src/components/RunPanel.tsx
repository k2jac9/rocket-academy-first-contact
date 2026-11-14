import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  Bot,
  Check,
  ChevronDown,
  CloudUpload,
  Database,
  LoaderCircle,
  Play,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import type { MissionManifest } from '../domain/mission.ts';
import {
  createBaselinePlan,
  runMission,
  validatePlan,
  type MissionPlan,
  type MissionRun,
  type PlannerProvenance,
} from '../simulation/missionRun.ts';
import { missionApi, type RunSummary, type SavedRun, type ServiceStatus } from '../services/api.ts';

type Props = {
  mission: MissionManifest | null;
  body: string;
  run: MissionRun | null;
  onRun: (run: MissionRun | null) => void;
  onNotice: (message: string) => void;
  onConnection: () => void;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'The operation could not be completed.';
}

export function RunPanel({ mission, body, run, onRun, onNotice, onConnection }: Props) {
  const [objective, setObjective] = useState('Drive to the science goal, observe the final state, and stop.');
  const [planned, setPlanned] = useState<{
    key: string;
    plan: MissionPlan;
    planner: PlannerProvenance;
  } | null>(null);
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [serviceError, setServiceError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [saved, setSaved] = useState<SavedRun | null>(null);
  const [history, setHistory] = useState<RunSummary[]>([]);
  const [historyError, setHistoryError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const operation = useRef<AbortController | null>(null);
  const revision = useRef(0);
  const saveKey = useRef<string | null>(null);
  const missionKey = JSON.stringify(mission);
  const currentKey = useRef(missionKey);
  currentKey.current = missionKey;
  const currentRunId = useRef(run?.runId);
  currentRunId.current = run?.runId;
  const plan = planned?.key === missionKey ? planned.plan : null;
  const planner = planned?.key === missionKey ? planned.planner : null;

  useEffect(() => {
    revision.current += 1;
    operation.current?.abort();
    saveKey.current = null;
    setPlanned(null);
    setSaved(null);
    setError('');
    setBusy('');
    onRun(null);
  }, [missionKey, onRun]);

  useEffect(
    () => () => {
      revision.current += 1;
      operation.current?.abort();
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    missionApi
      .status(controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) {
          setStatus(next);
          setServiceError('');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setStatus(null);
          setServiceError('Local service unavailable. Local runs and MCAP downloads still work.');
        }
      });
    return () => controller.abort();
  }, [refresh]);

  useEffect(() => {
    const controller = new AbortController();
    setHistory([]);
    setHistoryError('');
    if (status?.atlas.connected) {
      missionApi
        .runs(body, controller.signal)
        .then((data) => {
          if (!controller.signal.aborted) setHistory(data.runs);
        })
        .catch((error) => {
          if (!controller.signal.aborted) setHistoryError(errorMessage(error));
        });
    }
    return () => controller.abort();
  }, [body, status?.atlas.connected, historyRefresh]);

  function begin(label: string) {
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    const id = ++revision.current;
    const key = missionKey;
    setBusy(label);
    setError('');
    return {
      controller,
      isCurrent: () => !controller.signal.aborted && revision.current === id && currentKey.current === key,
    };
  }

  function changeObjective(value: string) {
    revision.current += 1;
    operation.current?.abort();
    setObjective(value);
    setPlanned(null);
    setSaved(null);
    setBusy('');
    setError('');
    saveKey.current = null;
    onRun(null);
  }

  function baseline() {
    if (!mission) return;
    try {
      const next = createBaselinePlan(mission);
      setPlanned({
        key: missionKey,
        plan: next,
        planner: { kind: 'baseline', generatedAt: new Date().toISOString() },
      });
      setSaved(null);
      setError('');
      saveKey.current = null;
      onRun(null);
      onNotice('Baseline plan ready. This planner is deterministic; it does not use generative AI.');
    } catch (error) {
      setError(errorMessage(error));
    }
  }

  async function generate() {
    if (!mission) return;
    const task = begin('planning');
    setPlanned(null);
    setSaved(null);
    onRun(null);
    saveKey.current = null;
    try {
      const result = await missionApi.plan(mission, objective, task.controller.signal);
      const checked = validatePlan(result.plan, mission);
      if (!checked.valid) throw new Error(`The generated plan was rejected: ${checked.errors.join('; ')}`);
      if (result.planner.kind !== 'gemini')
        throw new Error('The service did not identify a Gemini-generated plan.');
      if (task.isCurrent()) {
        setPlanned({ key: missionKey, plan: checked.plan, planner: result.planner });
        onNotice('Gemini plan validated. Review its commands before running the episode.');
      }
    } catch (error) {
      if (task.isCurrent()) setError(errorMessage(error));
    } finally {
      if (task.isCurrent()) setBusy('');
    }
  }

  function executeLocally() {
    if (!mission || !plan || !planner) return;
    try {
      const result = runMission({
        mission,
        plan,
        planner,
        seed: 42,
        runId: crypto.randomUUID(),
        robotId: 'rover-1',
        startedAt: new Date().toISOString(),
      });
      onRun(result);
      setSaved(null);
      setError('');
      onNotice(
        `Recorded ${result.frames.length} robot states. The kinematic episode is ready to replay or export.`,
      );
    } catch (error) {
      setError(errorMessage(error));
    }
  }

  async function executeAndSave() {
    if (!mission || !plan || !planner) return;
    const task = begin('saving-run');
    saveKey.current ??= crypto.randomUUID();
    try {
      const result = await missionApi.runAndSave(
        mission,
        plan,
        planner,
        42,
        saveKey.current,
        task.controller.signal,
      );
      if (task.isCurrent()) {
        setSaved(result);
        onRun(result.run);
        setHistoryRefresh((value) => value + 1);
        onNotice('Run and MCAP recording saved to MongoDB Atlas.');
      }
    } catch (error) {
      if (task.isCurrent()) setError(errorMessage(error));
    } finally {
      if (task.isCurrent()) setBusy('');
    }
  }

  async function saveMission() {
    if (!mission) return;
    const task = begin('saving-mission');
    try {
      await missionApi.saveMission(mission, crypto.randomUUID(), task.controller.signal);
      if (task.isCurrent()) onNotice('Mission saved to MongoDB Atlas.');
    } catch (error) {
      if (task.isCurrent()) setError(errorMessage(error));
    } finally {
      if (task.isCurrent()) setBusy('');
    }
  }

  async function downloadMcap() {
    if (!run) return;
    const task = begin('exporting');
    const runId = run.runId;
    try {
      const { encodeRunMcap } = await import('../recording/mcap.ts');
      const bytes = await encodeRunMcap(run);
      if (!task.isCurrent() || currentRunId.current !== runId) return;
      const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: 'application/octet-stream' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `first-contact-${run.mission.mode}-${runId}.mcap`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      onNotice(`MCAP exported with ${run.frames.length} poses, commands, observations, and source metadata.`);
    } catch (error) {
      if (task.isCurrent()) setError(errorMessage(error));
    } finally {
      if (task.isCurrent()) setBusy('');
    }
  }

  const atlasLabel = !status
    ? 'Service offline'
    : !status.atlas.configured
      ? 'Not configured'
      : status.atlas.connected
        ? 'Connected'
        : 'Connection failed';
  return (
    <section className="run-panel" aria-label="Robot orchestration">
      <div className="section-heading">
        <span>03 / ROBOT ORCHESTRATION</span>
        <Bot size={16} />
      </div>
      <div className="service-badges">
        <button className={status?.atlas.connected ? 'connected' : ''} onClick={onConnection}>
          <Database size={12} />
          <span>Atlas · {atlasLabel}</span>
        </button>
        <button className={status?.planner.configured ? 'connected' : ''} onClick={onConnection}>
          <Sparkles size={12} />
          <span>Gemini · {status?.planner.configured ? 'Configured' : 'Not configured'}</span>
        </button>
        <button aria-label="Refresh service connections" onClick={() => setRefresh((value) => value + 1)}>
          <RefreshCw size={12} />
        </button>
      </div>
      {serviceError && <p className="field-hint">{serviceError}</p>}
      <label className="field-label" htmlFor="mission-objective">
        Robot objective
      </label>
      <textarea
        id="mission-objective"
        className="objective-input"
        rows={3}
        maxLength={2000}
        value={objective}
        onChange={(event) => changeObjective(event.target.value)}
      />
      <div className="planner-actions">
        <button className="secondary-button" disabled={!mission || Boolean(busy)} onClick={baseline}>
          <Bot size={14} /> Baseline plan
        </button>
        <button
          className="secondary-button ai-button"
          disabled={!mission || !objective.trim() || !status?.planner.configured || Boolean(busy)}
          onClick={generate}
        >
          {busy === 'planning' ? <LoaderCircle className="spin" size={14} /> : <Sparkles size={14} />} Gemini
          plan
        </button>
      </div>
      {!mission && <p className="field-hint">Choose a start and goal, or load a 20 m example on a globe.</p>}
      {plan && planner && (
        <div className="plan-preview">
          <div className="plan-preview-title">
            <Check size={13} />
            <strong>{planner.kind === 'gemini' ? 'Gemini plan' : 'Baseline plan'}</strong>
            <span>{plan.steps.length} commands</span>
          </div>
          <p>{plan.rationale}</p>
          <ol>
            {plan.steps.map((step, index) => (
              <li key={index}>
                <span>{step.action.replace('_', ' ')}</span>
                <small>
                  {step.action === 'drive_to'
                    ? `${step.speedMps} m/s`
                    : step.action === 'wait'
                      ? `${step.durationS} s`
                      : step.action === 'observe'
                        ? step.label
                        : 'Finish motion'}
                </small>
              </li>
            ))}
          </ol>
        </div>
      )}
      <div className="episode-actions">
        <button className="primary-button" disabled={!plan || Boolean(busy)} onClick={executeLocally}>
          <Play size={15} /> Run locally
        </button>
        <button
          className="secondary-button"
          disabled={!plan || !status?.atlas.connected || Boolean(busy)}
          onClick={executeAndSave}
        >
          {busy === 'saving-run' ? <LoaderCircle className="spin" size={14} /> : <CloudUpload size={14} />}{' '}
          Run & save to Atlas
        </button>
        <button
          className="text-button"
          disabled={!mission || !status?.atlas.connected || Boolean(busy)}
          onClick={saveMission}
        >
          Save mission to Atlas
        </button>
      </div>
      {error && (
        <p className="operation-error" role="alert">
          {error}
        </p>
      )}
      {run && (
        <div className="recording-card">
          <div className="recording-title">
            <RadioDot />
            <strong>EPISODE RECORDED</strong>
            <span>{saved?.run.runId === run.runId ? 'ATLAS' : 'LOCAL'}</span>
          </div>
          <dl>
            <div>
              <dt>Duration</dt>
              <dd>{run.durationS.toFixed(1)} s</dd>
            </div>
            <div>
              <dt>Robot states</dt>
              <dd>{run.frames.length}</dd>
            </div>
            <div>
              <dt>Goal</dt>
              <dd>{run.result.goalReached ? 'Reached' : 'Not reached'}</dd>
            </div>
            <div>
              <dt>Planner</dt>
              <dd>{run.planner.kind === 'gemini' ? 'Gemini' : 'Baseline'}</dd>
            </div>
          </dl>
          <button className="primary-button" disabled={Boolean(busy)} onClick={downloadMcap}>
            {busy === 'exporting' ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <ArrowDownToLine size={15} />
            )}{' '}
            Export MCAP
          </button>
          {saved?.run.runId === run.runId && (
            <p className="artifact-checksum">GridFS · SHA-256 {saved.artifact.sha256.slice(0, 12)}…</p>
          )}
        </div>
      )}
      <p className="fidelity-note">
        <strong>Kinematic prototype.</strong> Records actions, poses, and derived state observations. Contact
        physics, obstacles, camera/LiDAR sensors, and policy training are not implemented.
      </p>
      <details className="run-history">
        <summary>
          <Database size={13} /> Atlas run history <ChevronDown size={13} />
        </summary>
        {!status?.atlas.connected ? (
          <p>Connect Atlas to browse saved runs.</p>
        ) : history.length === 0 ? (
          <p>No saved runs for this body.</p>
        ) : (
          <ul>
            {history.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>{item.missionName}</strong>
                  <span>
                    {item.durationS.toFixed(1)} s · {item.planner.kind} ·{' '}
                    {item.result.goalReached ? 'goal reached' : 'goal not reached'}
                  </span>
                </div>
                <a href={item.downloadUrl} download aria-label={`Download ${item.missionName} MCAP`}>
                  <ArrowDownToLine size={15} />
                </a>
              </li>
            ))}
          </ul>
        )}
        {historyError && <p role="alert">{historyError}</p>}
      </details>
    </section>
  );
}

function RadioDot() {
  return <span className="status-dot" />;
}
