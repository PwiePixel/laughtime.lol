import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  ChartNoAxesColumn,
  ChevronDown,
  Clock,
  ExternalLink,
  Images,
  KeyRound,
  LogIn,
  LogOut,
  Medal,
  Moon,
  Settings,
  Share2,
  Swords,
  Target,
  User,
  UserPlus,
  Vote,
  Bird,
  Bot,
  Bug,
  Cat,
  Check,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  Clapperboard,
  Cookie,
  Crown,
  Dices,
  Dog,
  Donut,
  Download,
  Eye,
  Fish,
  Flame,
  Frown,
  Gamepad2,
  Ghost,
  Hand,
  Headphones,
  Heart,
  IceCreamCone,
  Image,
  Laugh,
  Lock,
  Meh,
  PartyPopper,
  Pencil,
  Pizza,
  Play,
  Plus,
  Popcorn,
  Rabbit,
  Repeat,
  Rocket,
  SearchX,
  ShieldCheck,
  Skull,
  SkipForward,
  Smile,
  Snail,
  Sparkles,
  Squirrel,
  Star,
  ThumbsUp,
  Trash2,
  TriangleAlert,
  Trophy,
  Turtle,
  Users,
  Volume2,
  VolumeX,
  X,
  Zap,
  Search,
  Globe,
  Shuffle,
  Package,
  Layers,
  WandSparkles,
  Link2,
  Copy,
  Hourglass,
  Radar,
  DoorOpen,
  LockOpen,
  EyeOff,
  Upload,
  Hash,
  ArrowLeftRight,
  ImageUp,
  Flag,
  BadgeCheck,
} from 'lucide-react';

// One place for every icon used in the app (lucide icons, ISC license).
const ICONS = {
  // avatars
  cat: Cat,
  dog: Dog,
  bird: Bird,
  fish: Fish,
  rabbit: Rabbit,
  squirrel: Squirrel,
  turtle: Turtle,
  snail: Snail,
  bug: Bug,
  ghost: Ghost,
  skull: Skull,
  bot: Bot,
  rocket: Rocket,
  crown: Crown,
  pizza: Pizza,
  'ice-cream': IceCreamCone,
  cookie: Cookie,
  donut: Donut,
  popcorn: Popcorn,
  gamepad: Gamepad2,
  headphones: Headphones,
  flame: Flame,
  zap: Zap,
  star: Star,
  // ratings & reactions
  meh: Meh,
  smile: Smile,
  laugh: Laugh,
  party: PartyPopper,
  heart: Heart,
  'thumbs-up': ThumbsUp,
  frown: Frown,
  // ui
  alert: TriangleAlert,
  'arrow-right': ArrowRight,
  check: Check,
  'check-circle': CircleCheck,
  clip: Clapperboard,
  dice: Dices,
  download: Download,
  error: CircleAlert,
  eye: Eye,
  hand: Hand,
  image: Image,
  lock: Lock,
  pencil: Pencil,
  play: Play,
  plus: Plus,
  repeat: Repeat,
  'search-x': SearchX,
  shield: ShieldCheck,
  skip: SkipForward,
  sparkles: Sparkles,
  trash: Trash2,
  trophy: Trophy,
  users: Users,
  'volume-on': Volume2,
  'volume-off': VolumeX,
  x: X,
  'arrow-left': ArrowLeft,
  calendar: Calendar,
  chart: ChartNoAxesColumn,
  'chevron-down': ChevronDown,
  clock: Clock,
  external: ExternalLink,
  images: Images,
  key: KeyRound,
  'log-in': LogIn,
  'log-out': LogOut,
  medal: Medal,
  podium: ChartNoAxesColumn,
  settings: Settings,
  share: Share2,
  swords: Swords,
  target: Target,
  user: User,
  'user-plus': UserPlus,
  vote: Vote,
  discord: DiscordIcon,
  help: CircleHelp,
  search: Search,
  globe: Globe,
  shuffle: Shuffle,
  package: Package,
  layers: Layers,
  wand: WandSparkles,
  link: Link2,
  copy: Copy,
  hourglass: Hourglass,
  radar: Radar,
  door: DoorOpen,
  'lock-open': LockOpen,
  edit: Pencil,
  'eye-off': EyeOff,
  upload: Upload,
  hash: Hash,
  swap: ArrowLeftRight,
  'image-up': ImageUp,
  flag: Flag,
  approved: BadgeCheck,
  moon: Moon,
};

/** Discord brand glyph (lucide has no brand icons). */
function DiscordIcon({ size = 20, className, children, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} {...rest}>
      {children}
      <path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3a13.7 13.7 0 0 0-.6 1.3 18.4 18.4 0 0 0-5.5 0A12.8 12.8 0 0 0 8.6 3a19.7 19.7 0 0 0-4.9 1.5C.6 9.1-.3 13.6.1 18.1a19.9 19.9 0 0 0 6 3 14.6 14.6 0 0 0 1.3-2.1 12.9 12.9 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4a12.9 12.9 0 0 1-2 1 14.4 14.4 0 0 0 1.3 2.1 19.8 19.8 0 0 0 6-3c.5-5.2-.9-9.7-3.7-13.7ZM8.3 15.3c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm7.4 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z" />
    </svg>
  );
}

/**
 * Optical stroke width: lucide draws on a 24px grid, so the same stroke looks
 * thin on a 14px icon and clumsy on a 56px one. Small icons get a slightly
 * heavier line, big ones a lighter one – on screen every icon ends up between
 * about 1.6px and 4px, which matches the bold type and the 3px outlines.
 */
export function opticalStroke(size) {
  const px = Number(size) || 20;
  if (px <= 14) return 2.75;
  if (px <= 16) return 2.6;
  if (px <= 19) return 2.5;
  if (px <= 24) return 2.4;
  if (px <= 34) return 2.25;
  if (px <= 48) return 2.1;
  return 1.9;
}

/**
 * name:  key of ICONS
 * label: makes the icon meaningful for screen readers (and shows as a tooltip);
 *        without it the icon is decorative and hidden from them.
 */
export default function Icon({ name, size = 20, strokeWidth, className = '', label, ...rest }) {
  const Cmp = ICONS[name] || CircleHelp;
  const extra = Cmp === DiscordIcon ? {} : { strokeWidth: strokeWidth ?? opticalStroke(size) };
  return (
    <Cmp
      size={size}
      {...extra}
      className={`icon ${className}`.trim()}
      aria-hidden={label ? undefined : 'true'}
      aria-label={label}
      role={label ? 'img' : undefined}
      focusable="false"
      {...rest}
    >
      {/* keyed: lucide appends children to its own list of shapes */}
      {label ? <title key="title">{label}</title> : null}
    </Cmp>
  );
}
