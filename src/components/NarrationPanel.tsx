import { useEffect, useId, useRef, useState } from 'react';
import { Download, RefreshCw, Volume2 } from 'lucide-react';

type Status = { configured: boolean; model: string; defaultVoiceId: string; maxCharacters: number };
type Voice = { id: string; name: string; category: string };
type Props = { initialText: string; title: string; active: boolean; fileName: string };
async function responseError(response: Response): Promise<Error> {
  const body = await response.json().catch(() => null);
  return new Error(body?.error?.message ?? 'The narration service could not complete the request.');
}

export function NarrationPanel({ initialText, title, active, fileName }: Props) {
  const id = useId();
  const [text, setText] = useState(initialText);
  const [status, setStatus] = useState<Status | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voiceId, setVoiceId] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const operation = useRef<AbortController | null>(null);
  const operationKind = useRef('');

  function clearAudio() {
    audio.current?.pause();
    setAudioUrl(null);
    setNotice('');
  }
  async function refresh() {
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    operationKind.current = 'status';
    setBusy('Checking connection…');
    setError('');
    try {
      const response = await fetch('/api/speech/status', {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
      });
      if (!response.ok) throw await responseError(response);
      const next: Status = await response.json();
      if (!controller.signal.aborted) {
        setStatus(next);
        if (!next.configured) setVoices([]);
      }
    } catch (e) {
      if (!controller.signal.aborted) {
        setStatus(null);
        setError(e instanceof Error ? e.message : 'The local narration service is unavailable.');
      }
    } finally {
      if (!controller.signal.aborted) setBusy('');
    }
  }
  useEffect(() => {
    if (active) void refresh();
    else {
      operation.current?.abort();
      audio.current?.pause();
      setBusy('');
    }
    return () => {
      operation.current?.abort();
      audio.current?.pause();
    };
  }, [active]);
  useEffect(() => {
    if (operationKind.current === 'generation') {
      operation.current?.abort();
      setBusy('');
    }
    setText(initialText);
    clearAudio();
    setError('');
  }, [initialText]);
  useEffect(
    () => () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    },
    [audioUrl],
  );

  async function loadVoices() {
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    operationKind.current = 'voices';
    setBusy('Loading voices…');
    setError('');
    try {
      const response = await fetch('/api/speech/voices', {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
      });
      if (!response.ok) throw await responseError(response);
      const result: { voices: Voice[]; hasMore: boolean } = await response.json();
      if (controller.signal.aborted) return;
      setVoices(result.voices);
      setHasMore(result.hasMore);
      const selected =
        result.voices.find((v) => v.id === voiceId) ??
        result.voices.find((v) => v.id === status?.defaultVoiceId) ??
        result.voices.find((v) => v.id === 'JBFqnCBsd6RMkjVDRZzb') ??
        result.voices[0];
      setVoiceId(selected?.id ?? '');
      if (!selected)
        setError('No voices were returned. Check Voices read access and available voices in ElevenLabs.');
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Could not load voices.');
    } finally {
      if (!controller.signal.aborted) setBusy('');
    }
  }
  async function generate() {
    if (!status?.configured || !voiceId || busy) return;
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    operationKind.current = 'generation';
    clearAudio();
    setError('');
    setBusy('Generating narration…');
    try {
      const response = await fetch('/api/speech', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: text.trim(), voiceId }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(50_000)]),
      });
      if (!response.ok) throw await responseError(response);
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      if (blob.type.split(';')[0] !== 'audio/mpeg' || !blob.size)
        throw new Error('The narration response did not contain MP3 audio.');
      setAudioUrl(URL.createObjectURL(blob));
      setNotice(
        response.headers.get('x-narration-cache') === 'hit'
          ? 'Narration ready. Reused the recent audio without a new generation request.'
          : 'Narration ready. Press play to listen.',
      );
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : 'Narration could not be generated.');
    } finally {
      if (!controller.signal.aborted) setBusy('');
    }
  }
  const limit = status?.maxCharacters ?? 1200;
  return (
    <section id="mission-audio" tabIndex={-1} className="narration-panel" aria-labelledby={`${id}-title`}>
      <div className="narration-heading">
        <div>
          <div className="eyebrow">MISSION AUDIO / ELEVENLABS</div>
          <h3 id={`${id}-title`}>
            <Volume2 size={19} aria-hidden="true" /> {title}
          </h3>
        </div>
        <button
          className="secondary-button compact"
          onClick={() => void refresh()}
          disabled={Boolean(busy)}
          aria-label="Refresh ElevenLabs connection"
        >
          <RefreshCw size={15} /> Refresh
        </button>
      </div>
      <p className="muted">
        Choose a voice for your briefing or recorded episode. Listen here or download the MP3.
      </p>
      {status && !status.configured && (
        <p className="narration-setup">
          Connect ElevenLabs on the local server: add <code>ELEVENLABS_API_KEY</code> to{' '}
          <code>.env.local</code>, restart the API, then refresh. Enable Text to Speech and Voices read
          access.
        </p>
      )}
      <div className="narration-voice-row">
        <div className="narration-voice-field">
          <label htmlFor={`${id}-voice`}>Narrator</label>
          <select
            id={`${id}-voice`}
            value={voiceId}
            disabled={!voices.length || Boolean(busy)}
            onChange={(event) => {
              clearAudio();
              setVoiceId(event.target.value);
            }}
          >
            {!voices.length && <option value="">Load available voices</option>}
            {voices.map((voice) => (
              <option key={voice.id} value={voice.id}>
                {voice.name}
              </option>
            ))}
          </select>
        </div>
        <button
          className="secondary-button"
          onClick={() => void loadVoices()}
          disabled={!status?.configured || Boolean(busy)}
        >
          {voices.length ? 'Refresh voices' : 'Load voices'}
        </button>
      </div>
      {hasMore && <p className="muted">Showing the first 100 available voices.</p>}
      <div className="narration-script">
        <label htmlFor={`${id}-script`}>Narration script</label>
        <textarea
          id={`${id}-script`}
          rows={4}
          maxLength={limit}
          value={text}
          disabled={Boolean(busy)}
          onChange={(event) => {
            clearAudio();
            setText(event.target.value);
          }}
        />
      </div>
      <div className="narration-actions">
        <button
          className="primary-button"
          onClick={() => void generate()}
          disabled={
            !status?.configured || !voiceId || !text.trim() || text.trim().length > limit || Boolean(busy)
          }
        >
          <Volume2 size={16} /> {busy === 'Generating narration…' ? busy : 'Generate narration'}
        </button>
        <span className="muted">
          {text.length} / {limit} characters
        </span>
        <button
          className="text-button"
          disabled={Boolean(busy)}
          onClick={() => {
            clearAudio();
            setText(initialText);
          }}
        >
          Reset script
        </button>
      </div>
      <p className="narration-note">
        Generating sends this script to ElevenLabs and uses your account credits. Replay and downloads reuse
        the generated audio.
      </p>
      {(busy || notice) && <p role="status">{busy || notice}</p>}
      {error && (
        <p className="operation-error" role="alert">
          {error}
        </p>
      )}
      {audioUrl && (
        <div className="narration-player">
          <audio
            ref={audio}
            controls
            preload="metadata"
            src={audioUrl}
            aria-label={`${title} audio`}
            onError={() => setError('The browser could not play this audio. Download the MP3 to inspect it.')}
          />
          <a className="secondary-button" href={audioUrl} download={`${fileName}.mp3`}>
            <Download size={15} /> Download MP3
          </a>
          <p className="muted">Presentation audio; independent of the simulation timeline.</p>
        </div>
      )}
    </section>
  );
}
