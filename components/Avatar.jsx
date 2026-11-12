import { parseAvatar } from '@/lib/shared';
import Icon from './Icon';

export default function Avatar({ value, size = 44, className = '', title, icon }) {
  const parsed = parseAvatar(value);
  return (
    <span
      className={`avatar ${className}`}
      style={{ '--size': `${size}px`, background: icon ? '#E6DDF5' : parsed.color }}
      title={title}
      aria-hidden={title ? undefined : 'true'}
    >
      <Icon name={icon || parsed.icon} size={Math.round(size * 0.56)} strokeWidth={2.3} />
    </span>
  );
}
