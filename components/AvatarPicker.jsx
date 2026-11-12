'use client';

import { AVATAR_COLORS, AVATAR_ICONS, sanitizeAvatar } from '@/lib/shared';
import Avatar from './Avatar';
import Icon from './Icon';
import { useApp } from './Providers';

export default function AvatarPicker({ value, onChange }) {
  const { t } = useApp();
  const clean = sanitizeAvatar(value);
  const [current, ci] = clean.split('|');
  return (
    <div className="avatar-picker">
      {/* the key restarts the little pop whenever the look changes */}
      <Avatar key={clean} value={value} size={72} className="avatar-preview" />
      <div className="avatar-options">
        <div className="icon-grid" role="group" aria-label={t('ui.avatar.icon')}>
          {AVATAR_ICONS.map((name) => (
            <button
              key={name}
              type="button"
              className={name === current ? 'on' : ''}
              onClick={() => onChange(`${name}|${ci}`)}
              aria-label={t(`ui.icon.${name}`)}
              title={t(`ui.icon.${name}`)}
              aria-pressed={name === current}
            >
              <Icon name={name} size={22} />
            </button>
          ))}
        </div>
        <div className="color-row" role="group" aria-label={t('ui.avatar.color')}>
          {AVATAR_COLORS.map((c, i) => (
            <button
              key={c}
              type="button"
              className={`swatch ${String(i) === ci ? 'on' : ''}`}
              style={{ background: c }}
              onClick={() => onChange(`${current}|${i}`)}
              aria-label={t(`ui.color.${i}`)}
              title={t(`ui.color.${i}`)}
              aria-pressed={String(i) === ci}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
