'use client';

import Avatar from '../Avatar';
import Icon from '../Icon';
import { useApp } from '../Providers';

const AWARD_ICONS = { best_meme: 'trophy', on_fire: 'flame', crowd: 'heart', best_avg: 'star', supplier: 'image-up', one_shot: 'target' };

/** One award of the final screen (titles only - awards never carry points). */
export default function AwardCard({ award, player, index = 0 }) {
  const { t } = useApp();
  const value = award.id === 'best_avg' ? Number(award.value).toFixed(1) : award.value;
  return (
    <li className={`award-card award-${award.id}`} style={{ '--i': index }}>
      <span className="award-icon" aria-hidden="true">
        <Icon name={AWARD_ICONS[award.id] || 'medal'} size={24} strokeWidth={2.4} />
      </span>
      <strong className="award-title">{t(`award.${award.id}`)}</strong>
      <span className="award-who">
        <Avatar value={player?.avatar} icon={player ? undefined : 'ghost'} size={26} />
        <span>{player?.name || t('common.unknownPlayer')}</span>
      </span>
      <span className="award-value">
        {t(`award.${award.id}.value`, { n: value })}
        {award.round ? ` · ${t('final.round', { n: award.round })}` : ''}
      </span>
    </li>
  );
}
