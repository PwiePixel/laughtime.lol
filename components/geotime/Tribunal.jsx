'use client';

/**
 * Tribunal am Rundenende: Das gegnerische Team stimmt über die unsicheren
 * Funde ab. Gespeichert ist kein Bild – nur Position und Blickrichtung. Wer
 * nachsehen will, öffnet die Stelle bei Mapillary.
 */
import { useState } from 'react';

const mapillaryLink = (item) =>
  item.imageId
    ? `https://www.mapillary.com/app/?pKey=${encodeURIComponent(item.imageId)}&focus=photo`
    : `https://www.mapillary.com/app/?lat=${item.lat}&lng=${item.lng}&z=17`;

export default function Tribunal({ items, myTeam, onVote, endsIn, t }) {
  const [voted, setVoted] = useState({});
  const mine = items.filter((i) => i.team !== myTeam);

  return (
    <section className="geo-tribunal">
      <h2 >{t('tri.title')}</h2>
      <p className="muted">
        {mine.length ? t('tri.vote') : t('tri.wait')}
        {Number.isFinite(endsIn) && ` · noch ${endsIn}s`}
      </p>
      <ul className="geo-vote-list">
        {items.map((item) => {
          const own = item.team === myTeam;
          const choice = voted[item.id];
          return (
            <li key={item.id} className={`card geo-vote ${own ? 'own' : ''}`}>
              <div>
                <strong>{item.term}</strong>
                <p style={{ margin: '2px 0 0', color: 'var(--muted)' }}>
                  {t('tri.by', { name: item.by, team: item.team.toUpperCase() })}
                  {own ? ` ${t('tri.own')}` : ''}
                </p>
              </div>
              <a className="btn btn-small btn-ghost" href={mapillaryLink(item)} target="_blank" rel="noreferrer noopener">
                {t('tri.look')}
              </a>
              {!own && (
                <div className="geo-vote-buttons">
                  <button
                    type="button"
                    className={`btn geo-yes ${choice === true ? 'on' : ''}`}
                    onClick={() => {
                      setVoted((v) => ({ ...v, [item.id]: true }));
                      onVote(item.id, true);
                    }}
                  >
                    {t('tri.real')}
                  </button>
                  <button
                    type="button"
                    className={`btn geo-no ${choice === false ? 'on' : ''}`}
                    onClick={() => {
                      setVoted((v) => ({ ...v, [item.id]: false }));
                      onVote(item.id, false);
                    }}
                  >
                    {t('tri.fake')}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
