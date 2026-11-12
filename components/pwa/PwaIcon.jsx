import { EllipsisVertical, Monitor, MonitorDown, RefreshCw, Share, Smartphone, SquarePlus, WifiOff } from 'lucide-react';

// A few extra line icons that only the app pages need (same set and same look as
// components/Icon.jsx: lucide, thick strokes).
const ICONS = {
  'ios-share': Share,
  'add-home': SquarePlus,
  menu: EllipsisVertical,
  phone: Smartphone,
  monitor: Monitor,
  'monitor-install': MonitorDown,
  refresh: RefreshCw,
  'wifi-off': WifiOff,
};

export default function PwaIcon({ name, size = 20, strokeWidth = 2.4, className = '', label, ...rest }) {
  const Cmp = ICONS[name] || Smartphone;
  return (
    <Cmp
      size={size}
      strokeWidth={strokeWidth}
      className={`icon ${className}`}
      aria-hidden={label ? undefined : 'true'}
      aria-label={label}
      role={label ? 'img' : undefined}
      focusable="false"
      {...rest}
    />
  );
}
