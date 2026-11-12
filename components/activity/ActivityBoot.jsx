'use client';

import { useEffect, useState } from 'react';
import Icon from '../Icon';
import LolLogo from '../LolLogo';
import { useApp } from '../Providers';

export const BOOT_STEPS = ['connect', 'login', 'room'];
// after this time in one step the screen says that it takes longer than usual
const SLOW_AFTER_MS = 8000;

const ERROR_ICONS = {
  network: 'radar',
  timeout: 'hourglass',
  discord_timeout: 'hourglass',
  discord_unavailable: 'radar',
  discord_denied: 'key',
  banned: 'lock',
  too_many_attempts: 'hourglass',
  server_full: 'users',
  activity_not_found: 'door',
  not_in_activity: 'door',
};

/** seconds until `until` (a timestamp), counted down once per second */
function useSecondsLeft(until) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, Math.ceil((until - Date.now()) / 1000)));
    tick();
    if (!(until > Date.now())) return undefined;
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [until]);
  return left;
}

function Steps({ step, retry }) {
  const { t } = useApp();
  const current = BOOT_STEPS.indexOf(step);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    const id = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(id);
  }, [step]);

  return (
    <>
      <h1 className="mm-title activity-boot-title" aria-live="polite">
        {t(`activity.step.${step}`)}
        <span className="mm-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </h1>
      <ol className="activity-steps" aria-label={t('activity.steps.label')}>
        {BOOT_STEPS.map((name, i) => {
          const state = i < current ? 'done' : i === current ? 'active' : 'todo';
          return (
            <li key={name} className={`is-${state}`} aria-current={state === 'active' ? 'step' : undefined}>
              <span className="activity-step-dot" aria-hidden="true">
                {state === 'done' ? <Icon name="check" size={14} strokeWidth={3.4} /> : i + 1}
              </span>
              <span>{t(`activity.steps.${name}`)}</span>
              {state === 'done' && <span className="sr-only">{t('activity.steps.done')}</span>}
            </li>
          );
        })}
      </ol>
      <p className="activity-boot-note" role="status">
        {retry ? t('activity.boot.retry', { n: retry.attempt, max: retry.retries }) : slow ? t('activity.boot.slow') : ' '}
      </p>
    </>
  );
}

function Failure({ code, retryAt, onRetry, onClose }) {
  const { t } = useApp();
  const wait = useSecondsLeft(retryAt);
  const key = `activity.err.${code}`;
  const text = t(key);
  return (
    <div className="activity-error card" role="alert">
      <div className="big-icon activity-error-icon" aria-hidden="true">
        <Icon name={ERROR_ICONS[code] || 'error'} size={44} />
      </div>
      <h1>{t('activity.err.title')}</h1>
      <p className="lead">{text === key ? t('activity.err.generic') : text}</p>
      <div className="activity-error-actions">
        {onRetry && (
          <button type="button" className="btn btn-yellow" onClick={onRetry} disabled={wait > 0}>
            <Icon name="repeat" /> {wait > 0 ? t('activity.retryIn', { n: wait }) : t('activity.retry')}
          </button>
        )}
        {onClose && (
          <button type="button" className="btn btn-white" onClick={onClose}>
            <Icon name="door" /> {t('activity.close')}
          </button>
        )}
      </div>
      <p className="activity-error-code muted small">{t('activity.err.code', { code })}</p>
    </div>
  );
}

/**
 * Start screen of the activity: the bouncing logo with the three steps, or the
 * reason why it could not start.
 *   step    'connect' | 'login' | 'room'
 *   retry   { attempt, retries } while a step is repeated automatically
 *   error   error code (a key of activity.err.*) or null
 */
export default function ActivityBoot({ step = 'connect', retry = null, error = null, retryAt = 0, onRetry, onClose }) {
  return (
    <div className={`activity-boot ${error ? 'has-error' : ''}`}>
      <div className="mm-visual" aria-hidden="true">
        <span className="mm-ring r1" />
        <span className="mm-ring r2" />
        <span className="mm-ring r3" />
        <LolLogo className="mm-logo" />
      </div>
      {error ? <Failure code={error} retryAt={retryAt} onRetry={onRetry} onClose={onClose} /> : <Steps step={step} retry={retry} />}
    </div>
  );
}
