'use client';

import { AVATAR_COLORS, AVATAR_ICONS, sanitizeAvatar } from '@/lib/shared';
import Avatar from './Avatar';
import Icon from './Icon';

export default function AvatarPicker({ value, onChange }) {
  const [current, ci] = sanitizeAvatar(value).split('|');
  return (
    <div className="avatar-picker">
      <Avatar value={value} size={72} className="avatar-preview" />
      <div className="avatar-options">
        <div className="icon-grid">
          {AVATAR_ICONS.map((name) => (
            <button
              key={name}
              type="button"
              className={name === current ? 'on' : ''}
              onClick={() => onChange(`${name}|${ci}`)}
              aria-label={name}
              aria-pressed={name === current}
            >
              <Icon name={name} size={22} />
            </button>
          ))}
        </div>
        <div className="color-row">
          {AVATAR_COLORS.map((c, i) => (
            <button
              key={c}
              type="button"
              className={`swatch ${String(i) === ci ? 'on' : ''}`}
              style={{ background: c }}
              onClick={() => onChange(`${current}|${i}`)}
              aria-label={c}
              aria-pressed={String(i) === ci}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
