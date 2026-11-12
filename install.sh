#!/usr/bin/env bash
#
# LaughTime.lol – one-command server setup
#
#   bash install.sh            interactive setup
#   bash install.sh --yes      no questions, defaults
#   bash install.sh --help     all options
#
# Sets up system packages, Node.js, the npm packages, the production build,
# a process manager (systemd or PM2) and a Cloudflare Tunnel that puts the
# instance online. Every step first checks what is already there, so the
# script is safe to run again at any time.
#
# Rules this script keeps:
#   - an existing .env is never modified, moved or printed – it is only read
#   - data/ is never deleted
#   - outside of the project folder it only touches files it installs itself
#     (service units, tunnel configuration, downloaded binaries)
#
# Variables for automated tests (not needed in normal use):
#   LT_INSTALL_ROOT            prefix for everything below /etc and /usr/local;
#                              with it nothing is written to the real system
#                              and sudo is not used
#   LT_INSTALL_INIT            "systemd" or "none" instead of looking at PID 1
#   LT_INSTALL_HEALTH_TIMEOUT  seconds to wait for the app (default 180)
#   LT_INSTALL_PUBLIC_TIMEOUT  seconds to wait for the public URL (default 120)
#   LT_INSTALL_LOGIN_TIMEOUT   seconds to wait for the Cloudflare login (default 600)

[ -n "${BASH_VERSION:-}" ] || { echo 'Please run this script with bash: bash install.sh' >&2; exit 1; }
set -Eeuo pipefail
# "&" in a replacement string must stay a plain character (bash 5.2+)
shopt -u patsub_replacement 2>/dev/null || true

# ---------------------------------------------------------------------------
# constants and state
# ---------------------------------------------------------------------------
readonly APP_NAME='laughtime'
readonly SERVICE_NAME='laughtime.service'
readonly MIN_NODE_TEXT='22.13'
readonly NODE_LINES=(24 22)          # LTS lines to install, newest first
readonly BUILD_RAM_MB=1500           # the first build needs about this much
readonly SWAP_MB=2048
readonly MANAGED_MARK='# Managed by the LaughTime installer (install.sh)'

APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly APP_DIR
readonly ENV_FILE="$APP_DIR/.env"
readonly DATA_DIR="$APP_DIR/data"
readonly LOG_FILE="$DATA_DIR/install.log"
readonly STATE_FILE="$DATA_DIR/install.state"
readonly ROOT_PREFIX="${LT_INSTALL_ROOT:-}"
readonly HEALTH_TIMEOUT="${LT_INSTALL_HEALTH_TIMEOUT:-180}"
readonly PUBLIC_TIMEOUT="${LT_INSTALL_PUBLIC_TIMEOUT:-120}"
readonly LOGIN_TIMEOUT="${LT_INSTALL_LOGIN_TIMEOUT:-600}"

# options
MODE='install'                       # install | update | uninstall
ASSUME_YES=0
DRY_RUN=0
OPT_DOMAIN=''
OPT_BETA_DOMAIN=''
OPT_PORT=''
OPT_TUNNEL_NAME=''
OPT_USER=''
WANT_BETA=1
WANT_WWW=1
WANT_TUNNEL=1
WANT_SERVICE=1
WANT_ANNOUNCE=1
FORCE_PM2=0
ORIG_ARGS=()

# runtime
INTERACTIVE=0
LOG_READY=0
STEP_NO=0
STEP_TOTAL=0
CURRENT_STEP='Preparation'
TMP_DIR=''
CHILD_PID=''
SWAP_FILE=''
SUDO_READY=0
APT_UPDATED=0
WARNINGS=()
C_RESET='' C_BOLD='' C_DIM='' C_RED='' C_GREEN='' C_YELLOW='' C_MAGENTA='' C_CYAN=''

OS_ID='unknown' OS_LIKE='' OS_NAME='' PKG='' ARCH='' LIBC='glibc' INIT='none'
CURRENT_USER='' OWNER_REF=''
SERVICE_USER='' SERVICE_GROUP='' SERVICE_HOME='' CREATE_USER=0 CHOWN_TREE=0 ROOT_FALLBACK=0
MANAGER='none'
NODE_BIN='' NODE_DIR='' PM2_BIN='' PM2_ENV=() CLOUDFLARED_BIN=''
DOMAIN='' BETA_DOMAIN='' PORT='' ENV_PORT='' PORT_OVERRIDE=0 LOCAL_HOST='127.0.0.1'
TUNNEL_NAME='' TUNNEL_ID='' TUNNEL_UNIT='' CF_CONFIG='' HOSTNAMES=()
DEPS_CHANGED=0 BUILD_CHANGED=0
APP_STATUS='' TUNNEL_STATUS='' PUBLIC_OK='' DNS_FAILED=()

# ---------------------------------------------------------------------------
# output
# ---------------------------------------------------------------------------
setup_colours() {
  if [[ -t 1 && -z "${NO_COLOR:-}" && "${TERM:-dumb}" != dumb ]]; then
    C_RESET=$'\e[0m' C_BOLD=$'\e[1m' C_DIM=$'\e[2m' C_RED=$'\e[1;31m'
    C_GREEN=$'\e[1;32m' C_YELLOW=$'\e[1;33m' C_MAGENTA=$'\e[1;35m' C_CYAN=$'\e[1;36m'
  fi
}

log_line() {
  if (( LOG_READY )); then printf '%s\n' "$*" >>"$LOG_FILE" 2>/dev/null || true; fi
}

say()  { printf '%s\n' "$*"; log_line "$*"; }
info() { printf '    %s\n' "$*"; log_line "    $*"; }
ok()   { printf '  %s+%s %s\n' "$C_GREEN" "$C_RESET" "$*"; log_line "  [ok] $*"; }
warn() { printf '  %s!%s %s\n' "$C_YELLOW" "$C_RESET" "$*"; log_line "  [warning] $*"; WARNINGS+=("$*"); }
note() { printf '  %s!%s %s\n' "$C_YELLOW" "$C_RESET" "$*"; log_line "  [note] $*"; }
err()  { printf '  %sx%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; log_line "  [error] $*"; }
dry()  { printf '  %s[dry-run]%s %s\n' "$C_CYAN" "$C_RESET" "$*"; }

step() {
  STEP_NO=$((STEP_NO + 1))
  CURRENT_STEP=$*
  printf '\n%s[%d/%d]%s %s%s%s\n' "$C_MAGENTA" "$STEP_NO" "$STEP_TOTAL" "$C_RESET" "$C_BOLD" "$*" "$C_RESET"
  log_line ''
  log_line "== [$STEP_NO/$STEP_TOTAL] $* =="
}

how_to_continue() {
  {
    printf '\n    How to continue: fix the cause above, then run the same command again:\n'
    printf '      bash install.sh%s\n' "${ORIG_ARGS[*]:+ ${ORIG_ARGS[*]}}"
    printf '    Finished steps are detected and skipped.\n'
    if (( LOG_READY )); then printf '    Full log: %s\n' "$LOG_FILE"; fi
  } >&2
}

# expected problems: clear message, no stack of shell errors
die() {
  err "$*"
  err "Stopped in step: $CURRENT_STEP"
  how_to_continue
  exit 1
}

# shellcheck disable=SC2317  # called by the ERR trap
on_err() {
  local rc=$1 line=$2 cmd=$3
  # failures inside subshells are reported once, by the main shell
  [[ "$BASHPID" == "$$" ]] || return 0
  trap - ERR
  err "Step \"$CURRENT_STEP\" failed unexpectedly (line $line, exit code $rc): $cmd"
  how_to_continue
  exit "$rc"
}

# shellcheck disable=SC2317  # called by the INT/TERM trap
on_signal() {
  trap - INT TERM
  printf '\n' >&2
  err 'Interrupted.'
  how_to_continue
  exit 130
}

# shellcheck disable=SC2317  # called by the EXIT trap
on_exit() {
  local rc=$?
  trap - EXIT ERR
  if [[ -n "$CHILD_PID" ]]; then kill "$CHILD_PID" 2>/dev/null || true; fi
  remove_swap
  if [[ -n "$TMP_DIR" && -d "$TMP_DIR" ]]; then rm -rf -- "$TMP_DIR"; fi
  exit "$rc"
}

tmp_dir() {
  if [[ -z "$TMP_DIR" ]]; then TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/laughtime-install.XXXXXX"); fi
}

# command line as text, for the log and for --dry-run
quote_cmd() {
  local prefix='' text
  while [[ "${1:-}" =~ ^(as_root|as_app|pm2_app|git_app|npm_app|build_app)$ ]]; do
    case "$1" in
      as_root) if (( EUID != 0 )) && [[ -z "$ROOT_PREFIX" ]]; then prefix='sudo '; fi ;;
      as_app)  if [[ "$SERVICE_USER" != "$CURRENT_USER" ]]; then prefix="(as $SERVICE_USER) "; fi ;;
      pm2_app) if [[ "$SERVICE_USER" != "$CURRENT_USER" ]]; then prefix="(as $SERVICE_USER) pm2 "; else prefix='pm2 '; fi ;;
      git_app) prefix='git ' ;;
      npm_app) prefix='npm ' ;;
      build_app) printf 'node index.js --build-only'; return 0 ;;
    esac
    shift
  done
  printf -v text '%q ' "$@"
  printf '%s%s' "$prefix" "${text% }"
}

# short command: output goes to the log only
quiet() {
  if (( DRY_RUN )); then dry "$(quote_cmd "$@")"; return 0; fi
  log_line "\$ $(quote_cmd "$@")"
  if (( LOG_READY )); then "$@" >>"$LOG_FILE" 2>&1; else "$@" >/dev/null 2>&1; fi
}

# long command: one tidy line on the terminal, the full output in the log,
# the last lines on the terminal when it fails
run_logged() {
  local label=$1; shift
  if (( DRY_RUN )); then dry "$(quote_cmd "$@")"; return 0; fi
  local out rc=0 start=$SECONDS frames=('|' '/' '-' "\\") i=0
  tmp_dir
  out=$(mktemp "$TMP_DIR/cmd.XXXXXX")
  log_line "\$ $(quote_cmd "$@")"
  "$@" >"$out" 2>&1 &
  CHILD_PID=$!
  if [[ -t 1 ]]; then
    while kill -0 "$CHILD_PID" 2>/dev/null; do
      printf '\r  %s%s%s %s (%ds) ' "$C_CYAN" "${frames[i++ % 4]}" "$C_RESET" "$label" "$((SECONDS - start))"
      sleep 0.2
    done
    printf '\r\e[K'
  fi
  wait "$CHILD_PID" || rc=$?
  CHILD_PID=''
  if (( LOG_READY )); then cat "$out" >>"$LOG_FILE" 2>/dev/null || true; fi
  if (( rc == 0 )); then
    ok "$label ($((SECONDS - start))s)"
  else
    err "$label failed (exit code $rc). Last lines of the output:"
    tail -n 25 "$out" | sed 's/^/      /' >&2
  fi
  rm -f -- "$out"
  return "$rc"
}

# ---------------------------------------------------------------------------
# questions
# ---------------------------------------------------------------------------
confirm() {   # <question> <default y|n>
  local question=$1 default=${2:-y} hint='[Y/n]' answer=''
  [[ "$default" == y ]] || hint='[y/N]'
  if (( ! INTERACTIVE )); then [[ "$default" == y ]]; return; fi
  while true; do
    read -r -p "  ${C_CYAN}?${C_RESET} $question $hint " answer || answer=''
    answer=${answer,,}
    case "${answer:-$default}" in
      y|yes|j|ja) log_line "  [question] $question -> yes"; return 0 ;;
      n|no|nein)  log_line "  [question] $question -> no"; return 1 ;;
    esac
  done
}

ask() {       # <question> <default> -> answer on stdout
  local question=$1 default=$2 answer=''
  if (( INTERACTIVE )); then
    read -r -p "  ${C_CYAN}?${C_RESET} $question [$default] " answer || answer=''
  fi
  printf '%s' "${answer:-$default}"
}

# ---------------------------------------------------------------------------
# small helpers
# ---------------------------------------------------------------------------
have() { command -v "$1" >/dev/null 2>&1; }

# path below the test prefix (the real path in normal use)
dst() { printf '%s%s' "$ROOT_PREFIX" "$1"; }

trim() {
  local s=$1
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  printf '%s' "$s"
}

# Reads one value from a KEY=value file without executing anything in it.
# Same rules as index.js: first match wins, surrounding quotes are removed.
env_get() {   # <key> [file]
  local key=$1 file=${2:-$ENV_FILE} line k v
  [[ -r "$file" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    line=${line%$'\r'}
    line=$(trim "$line")
    [[ -n "$line" && "$line" != \#* && "$line" == *=* ]] || continue
    k=$(trim "${line%%=*}")
    [[ "$k" == "$key" ]] || continue
    v=$(trim "${line#*=}")
    if [[ ${#v} -ge 2 && ( ( "$v" == \"*\" ) || ( "$v" == \'*\' ) ) ]]; then v=${v:1:${#v}-2}; fi
    printf '%s' "$v"
    return 0
  done <"$file"
}

state_get() { env_get "$1" "$STATE_FILE"; }

# the installer remembers its own choices, so a later run (or --update,
# --uninstall) does not need the same flags again
state_set() { # <key> <value>
  local key=$1 value=$2 line content=''
  (( DRY_RUN )) && return 0
  [[ -d "$DATA_DIR" ]] || return 0
  if [[ -r "$STATE_FILE" ]]; then
    while IFS= read -r line || [[ -n "$line" ]]; do
      [[ "$line" == "$key="* ]] || content+="$line"$'\n'
    done <"$STATE_FILE"
  else
    content="# Written by install.sh – remembers the choices of the last run."$'\n'
  fi
  [[ -z "$value" ]] || content+="$key=$value"$'\n'
  printf '%s' "$content" >"$STATE_FILE" 2>/dev/null || return 0
  own "$STATE_FILE"
}

# files the script creates inside the project belong to the project owner
own() {
  if (( EUID == 0 )) && [[ -z "$ROOT_PREFIX" && -n "$OWNER_REF" ]]; then chown -h "$OWNER_REF" "$@" 2>/dev/null || true; fi
}

sha256_of() {
  if have sha256sum; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

host_of_url() {
  local h=$1
  h=${h#*://}; h=${h%%/*}; h=${h##*@}; h=${h%%:*}
  printf '%s' "${h,,}"
}

valid_hostname() {
  [[ "$1" =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z0-9-]{2,}$ && ${#1} -le 253 ]]
}

home_of() {
  local home=''
  if have getent; then home=$(getent passwd "$1" 2>/dev/null | cut -d: -f6) || home=''; fi
  if [[ -z "$home" && -r /etc/passwd ]]; then home=$(awk -F: -v u="$1" '$1 == u { print $6; exit }' /etc/passwd); fi
  printf '%s' "$home"
}

ensure_sudo() {
  (( SUDO_READY )) && return 0
  have sudo || die "This step needs root rights, but sudo is not installed. Run the script as root: su -c 'bash install.sh'"
  if ! sudo -n true 2>/dev/null; then
    if [[ -t 0 ]]; then
      note 'Root rights are needed for the next step – sudo may ask for your password.'
      sudo -v || die 'sudo did not grant root rights.'
    else
      die 'Root rights are needed, but sudo wants a password and there is no terminal. Run the script as root or allow sudo without a password.'
    fi
  fi
  SUDO_READY=1
}

# system changes: directly as root, otherwise through sudo
as_root() {
  if (( EUID == 0 )) || [[ -n "$ROOT_PREFIX" ]]; then
    "$@"
  else
    ensure_sudo
    sudo -- "$@"
  fi
}

# everything inside the project runs as the service user, so the files it
# creates (node_modules, .next, data) belong to the account that runs the app
as_app() {
  local path="$PATH"
  [[ -z "$NODE_DIR" ]] || path="$NODE_DIR:$PATH"
  if [[ "$SERVICE_USER" == "$CURRENT_USER" ]]; then
    PATH="$path" "$@"
  elif (( EUID == 0 )) && have runuser; then
    runuser -u "$SERVICE_USER" -- env HOME="$SERVICE_HOME" USER="$SERVICE_USER" LOGNAME="$SERVICE_USER" PATH="$path" "$@"
  elif (( EUID == 0 )); then
    local line
    printf -v line '%q ' env HOME="$SERVICE_HOME" USER="$SERVICE_USER" LOGNAME="$SERVICE_USER" PATH="$path" "$@"
    su -s /bin/sh "$SERVICE_USER" -c "$line"
  else
    ensure_sudo
    sudo -H -u "$SERVICE_USER" -- env PATH="$path" "$@"
  fi
}

pm2_app() { as_app "$PM2_BIN" "$@"; }

# ---------------------------------------------------------------------------
# command line
# ---------------------------------------------------------------------------
usage() {
  cat <<EOF
LaughTime.lol – server setup

Usage: bash install.sh [options]

  -y, --yes               no questions, use the defaults
      --domain <d>        public domain (default: host of PUBLIC_URL in .env, else laughtime.lol)
      --beta-domain <d>   beta hostname (default: beta.<domain>)
      --no-beta           no beta hostname
      --no-www            no www.<domain> hostname
      --port <n>          port of the app (default: SERVER_PORT / PORT in .env, else 3000)
      --tunnel-name <n>   name of the Cloudflare Tunnel (default: laughtime)
      --no-tunnel         do not set up a Cloudflare Tunnel (own reverse proxy, see deploy/)
      --no-service        do not set up a process manager (only install and build)
      --pm2               use PM2 instead of systemd
      --user <name>       account that runs the app (default: the owner of this folder;
                          as root in a root-owned folder: a system user "laughtime")
      --no-announce       do not post to the Discord webhook at the end
      --update            git pull (clean git checkout only), reinstall, rebuild, restart
      --uninstall         remove services and tunnel configuration (.env and data/ are kept)
      --dry-run           print every action, change nothing
  -h, --help              this help

Examples:
  bash install.sh
  bash install.sh --yes --domain example.com
  bash install.sh --no-tunnel --port 8080
  bash install.sh --update

Log: data/install.log   Documentation: README.md, deploy/
EOF
}

usage_error() {
  printf 'install.sh: %s\n\nRun "bash install.sh --help" for all options.\n' "$*" >&2
  exit 2
}

parse_args() {
  local arg value
  while (( $# )); do
    arg=$1
    value=''
    # --flag=value and --flag value are both fine
    case "$arg" in
      --domain=*|--beta-domain=*|--port=*|--tunnel-name=*|--user=*)
        value=${arg#*=}; arg=${arg%%=*}
        [[ -n "$value" ]] || usage_error "$arg needs a value"
        ;;
      --domain|--beta-domain|--port|--tunnel-name|--user)
        (( $# >= 2 )) || usage_error "$arg needs a value"
        value=$2; shift
        ;;
    esac
    case "$arg" in
      -y|--yes)       ASSUME_YES=1 ;;
      --domain)       OPT_DOMAIN=${value,,} ;;
      --beta-domain)  OPT_BETA_DOMAIN=${value,,} ;;
      --no-beta)      WANT_BETA=0 ;;
      --no-www)       WANT_WWW=0 ;;
      --port)         OPT_PORT=$value ;;
      --tunnel-name)  OPT_TUNNEL_NAME=$value ;;
      --no-tunnel)    WANT_TUNNEL=0 ;;
      --no-service)   WANT_SERVICE=0 ;;
      --pm2)          FORCE_PM2=1 ;;
      --user)         OPT_USER=$value ;;
      --no-announce)  WANT_ANNOUNCE=0 ;;
      --update)       MODE='update' ;;
      --uninstall)    MODE='uninstall' ;;
      --dry-run)      DRY_RUN=1 ;;
      -h|--help)      usage; exit 0 ;;
      *)              usage_error "unknown option: $arg" ;;
    esac
    shift
  done

  if [[ -n "$OPT_DOMAIN" ]]; then
    OPT_DOMAIN=$(host_of_url "$OPT_DOMAIN")
    valid_hostname "$OPT_DOMAIN" || usage_error "--domain: \"$OPT_DOMAIN\" is not a valid domain"
  fi
  if [[ -n "$OPT_BETA_DOMAIN" ]]; then
    OPT_BETA_DOMAIN=$(host_of_url "$OPT_BETA_DOMAIN")
    valid_hostname "$OPT_BETA_DOMAIN" || usage_error "--beta-domain: \"$OPT_BETA_DOMAIN\" is not a valid hostname"
  fi
  if [[ -n "$OPT_PORT" ]]; then
    if [[ ! "$OPT_PORT" =~ ^[0-9]{1,5}$ ]] || (( 10#$OPT_PORT < 1 || 10#$OPT_PORT > 65535 )); then
      usage_error "--port: \"$OPT_PORT\" is not a port number"
    fi
    OPT_PORT=$((10#$OPT_PORT))
  fi
  if [[ -n "$OPT_TUNNEL_NAME" ]]; then
    [[ "$OPT_TUNNEL_NAME" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$ ]] || usage_error '--tunnel-name: use letters, digits, "-" and "_" only'
  fi
  if [[ -n "$OPT_USER" ]]; then
    [[ "$OPT_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || usage_error "--user: \"$OPT_USER\" is not a valid user name"
  fi
}

# ---------------------------------------------------------------------------
# detection (reads only)
# ---------------------------------------------------------------------------
detect_os() {
  local machine
  OS_NAME=$(uname -s)
  if [[ -r /etc/os-release ]]; then
    OS_ID=$(env_get ID /etc/os-release); OS_ID=${OS_ID,,}
    OS_LIKE=$(env_get ID_LIKE /etc/os-release); OS_LIKE=${OS_LIKE,,}
    OS_NAME=$(env_get PRETTY_NAME /etc/os-release)
    [[ -n "$OS_NAME" ]] || OS_NAME=$OS_ID
  fi
  case " $OS_ID $OS_LIKE " in
    *' debian '*|*' ubuntu '*) PKG='apt' ;;
    *' fedora '*|*' rhel '*|*' centos '*|*' almalinux '*|*' rocky '*) PKG='dnf' ;;
    *' arch '*|*' manjaro '*) PKG='pacman' ;;
    *suse*) PKG='zypper' ;;
    *' alpine '*) PKG='apk' ;;
  esac
  # unknown distribution: go by the package manager that is there
  if [[ -z "$PKG" ]]; then
    if have apt-get; then PKG='apt'
    elif have dnf || have yum; then PKG='dnf'
    elif have pacman; then PKG='pacman'
    elif have zypper; then PKG='zypper'
    elif have apk; then PKG='apk'
    fi
  fi
  machine=$(uname -m)
  case "$machine" in
    x86_64|amd64)   ARCH='amd64' ;;
    aarch64|arm64)  ARCH='arm64' ;;
    armv7l|armv6l|armhf) ARCH='armhf' ;;
    *)              ARCH="unsupported ($machine)" ;;
  esac
  if [[ "$OS_ID" == alpine ]] || compgen -G '/lib/ld-musl-*' >/dev/null; then LIBC='musl'; fi

  case "${LT_INSTALL_INIT:-}" in
    systemd) INIT='systemd' ;;
    none)    INIT='none' ;;
    *)
      # only a systemd that really is PID 1 can run units (not in most containers)
      if [[ -d /run/systemd/system && "$(cat /proc/1/comm 2>/dev/null || true)" == systemd ]] && have systemctl; then INIT='systemd'; fi
      ;;
  esac
}

# every parent folder must let other users pass, otherwise a separate service
# user cannot reach the project (typical: a checkout below /root)
reachable_by_others() {
  local dir=$1 mode
  while [[ -n "$dir" && "$dir" != / ]]; do
    mode=$(stat -c %A "$dir" 2>/dev/null) || return 1
    [[ "${mode: -1}" == x || "${mode: -1}" == t ]] || return 1
    dir=$(dirname "$dir")
  done
}

load_settings() {
  local src=$ENV_FILE public_url host remembered
  [[ -f "$src" ]] || src="$APP_DIR/.env.example"

  public_url=$(env_get PUBLIC_URL "$src")
  host=$(host_of_url "$public_url"); host=${host#www.}
  DOMAIN=$OPT_DOMAIN
  [[ -n "$DOMAIN" ]] || DOMAIN=$(state_get domain)
  if [[ -z "$DOMAIN" ]] && valid_hostname "$host" && [[ ! "$host" =~ ^[0-9.]+$ ]]; then DOMAIN=$host; fi
  [[ -n "$DOMAIN" ]] || DOMAIN='laughtime.lol'

  ENV_PORT=$(env_get SERVER_PORT "$src")
  [[ -n "$ENV_PORT" ]] || ENV_PORT=$(env_get PORT "$src")
  [[ "$ENV_PORT" =~ ^[0-9]{1,5}$ ]] || ENV_PORT=3000
  PORT=$OPT_PORT
  [[ -n "$PORT" ]] || PORT=$(state_get port)
  [[ "$PORT" =~ ^[0-9]{1,5}$ ]] || PORT=$ENV_PORT
  PORT_OVERRIDE=0
  [[ "$PORT" == "$ENV_PORT" ]] || PORT_OVERRIDE=1

  # the app may be bound to one address only
  host=$(env_get HOST "$src")
  case "$host" in
    ''|0.0.0.0|::|localhost|127.0.0.1|'[::]') LOCAL_HOST='127.0.0.1' ;;
    *:*) LOCAL_HOST="[$host]" ;;
    *)   LOCAL_HOST=$host ;;
  esac

  TUNNEL_NAME=$OPT_TUNNEL_NAME
  [[ -n "$TUNNEL_NAME" ]] || TUNNEL_NAME=$(state_get tunnel_name)
  [[ "$TUNNEL_NAME" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$ ]] || TUNNEL_NAME='laughtime'
  TUNNEL_UNIT="cloudflared-$TUNNEL_NAME.service"

  remembered=$(state_get beta_domain)
  BETA_DOMAIN=$OPT_BETA_DOMAIN
  # a remembered beta host only counts while the domain is still the same
  if [[ -z "$BETA_DOMAIN" && -z "$OPT_DOMAIN" ]] && valid_hostname "$remembered"; then BETA_DOMAIN=$remembered; fi
  set_hostnames
}

set_hostnames() {
  [[ -n "$BETA_DOMAIN" ]] || BETA_DOMAIN="beta.$DOMAIN"
  HOSTNAMES=("$DOMAIN")
  if (( WANT_WWW )) && [[ "$DOMAIN" != www.* ]]; then HOSTNAMES+=("www.$DOMAIN"); fi
  if (( WANT_BETA )) && [[ "$BETA_DOMAIN" != "$DOMAIN" ]]; then HOSTNAMES+=("$BETA_DOMAIN"); fi
}

resolve_service_user() {
  local owner
  CURRENT_USER=$(id -un)
  owner=$(stat -c %U "$APP_DIR" 2>/dev/null || echo UNKNOWN)
  OWNER_REF=$(stat -c %u:%g "$APP_DIR")
  CREATE_USER=0 CHOWN_TREE=0 ROOT_FALLBACK=0

  SERVICE_USER=$OPT_USER
  [[ -n "$SERVICE_USER" ]] || SERVICE_USER=$(state_get user)
  if [[ -z "$SERVICE_USER" ]]; then
    if (( EUID != 0 )); then
      SERVICE_USER=$CURRENT_USER
    elif [[ "$owner" != root && "$owner" != UNKNOWN ]]; then
      # "sudo bash install.sh" in somebody's checkout: the app runs as that user
      SERVICE_USER=$owner
    elif (( ! WANT_SERVICE )); then
      SERVICE_USER=root
    elif reachable_by_others "$APP_DIR"; then
      SERVICE_USER=$APP_NAME
    else
      # e.g. /root/laughtime.lol: no other account can get in there
      SERVICE_USER=root
      ROOT_FALLBACK=1
    fi
  fi

  if id -u "$SERVICE_USER" >/dev/null 2>&1; then
    SERVICE_GROUP=$(id -gn "$SERVICE_USER")
    SERVICE_HOME=$(home_of "$SERVICE_USER")
  else
    CREATE_USER=1
    SERVICE_GROUP=$SERVICE_USER
    SERVICE_HOME="/var/lib/$SERVICE_USER"
  fi
  [[ -n "$SERVICE_HOME" ]] || SERVICE_HOME=$APP_DIR
  if [[ "$SERVICE_USER" != "$owner" ]] && (( WANT_SERVICE )); then CHOWN_TREE=1; fi
}

resolve_manager() {
  if (( ! WANT_SERVICE )); then MANAGER='none'
  elif (( FORCE_PM2 )) || [[ "$(state_get manager)" == pm2 ]]; then MANAGER='pm2'
  elif [[ "$INIT" == systemd ]]; then MANAGER='systemd'
  else MANAGER='pm2'
  fi
  if [[ "$MANAGER" == systemd ]]; then
    CF_CONFIG="/etc/cloudflared/$TUNNEL_NAME.yml"
  elif [[ "$MANAGER" == pm2 ]]; then
    CF_CONFIG="$SERVICE_HOME/.cloudflared/$TUNNEL_NAME.yml"
  else
    CF_CONFIG="$HOME/.cloudflared/$TUNNEL_NAME.yml"
  fi
}

node_ok() {
  have node || return 1
  node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 13) ? 0 : 1)' 2>/dev/null || return 1
  node -e 'require("node:sqlite")' >/dev/null 2>&1
}

mem_available_mb() {
  awk '/^MemAvailable:/ { a = $2 } /^SwapFree:/ { s = $2 } END { printf "%d", (a + s) / 1024 }' /proc/meminfo 2>/dev/null || printf '0'
}

disk_free_mb() { df -Pm "$1" 2>/dev/null | awk 'NR == 2 { print $4 }'; }

# ---------------------------------------------------------------------------
# packages
# ---------------------------------------------------------------------------
pkg_install() {   # <package...>
  case "$PKG" in
    apt)
      if (( ! APT_UPDATED )); then
        run_logged 'Refreshing the package lists' as_root apt-get update -qq || note 'apt-get update reported problems – trying to install anyway.'
        APT_UPDATED=1
      fi
      run_logged "Installing $*" as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$@"
      ;;
    dnf)
      if have dnf; then run_logged "Installing $*" as_root dnf install -y "$@"
      else run_logged "Installing $*" as_root yum install -y "$@"; fi
      ;;
    # -y refreshes the package database first, a stale one answers with 404
    pacman) run_logged "Installing $*" as_root pacman -Sy --needed --noconfirm "$@" ;;
    zypper) run_logged "Installing $*" as_root zypper --non-interactive install --no-recommends "$@" ;;
    apk)    run_logged "Installing $*" as_root apk add --no-cache "$@" ;;
    *)      err "No supported package manager found – please install by hand: $*"; return 1 ;;
  esac
}

has_ca_certificates() {
  local f
  for f in /etc/ssl/certs/ca-certificates.crt /etc/pki/tls/certs/ca-bundle.crt /etc/ssl/ca-bundle.pem /etc/ssl/cert.pem; do
    [[ -s "$f" ]] && return 0
  done
  return 1
}

download() {  # <url> <target file>
  curl -fsSL --retry 3 --retry-delay 2 --connect-timeout 20 -o "$2" "$1"
}

# ---------------------------------------------------------------------------
# step: system check
# ---------------------------------------------------------------------------
step_system() {
  local mem disk
  step 'System check'
  ok "System: $OS_NAME, $ARCH${PKG:+, package manager $PKG}"
  [[ "$ARCH" != unsupported* ]] || warn "CPU architecture $ARCH is not tested – downloads of Node.js and cloudflared will not work, system packages might."
  [[ -n "$PKG" ]] || warn 'Unknown distribution: missing system packages have to be installed by hand.'
  if (( EUID == 0 )); then
    ok 'Running as root'
  elif [[ -n "$ROOT_PREFIX" ]]; then
    ok "Running as $CURRENT_USER with the test prefix $ROOT_PREFIX (no sudo)"
  else
    ok "Running as $CURRENT_USER – system changes (packages, services, files below /etc) use sudo"
  fi
  if [[ "$INIT" == systemd ]]; then ok 'Init system: systemd'; else ok 'Init system: no systemd as PID 1 – services run with PM2'; fi

  mem=$(mem_available_mb)
  disk=$(disk_free_mb "$APP_DIR")
  if (( mem > 0 )); then
    if (( mem < BUILD_RAM_MB )); then
      warn "Only ${mem} MB of memory (RAM + swap) are free – the first build needs about ${BUILD_RAM_MB} MB."
    else
      ok "Memory: ${mem} MB free"
    fi
  fi
  if [[ -n "$disk" ]]; then
    if (( disk < 2000 )); then
      warn "Only ${disk} MB of disk space are free in $APP_DIR – packages and build need about 1.5 GB, uploads and the media cache come on top."
    else
      ok "Disk: ${disk} MB free"
    fi
  fi
}

# ---------------------------------------------------------------------------
# step: system packages
# ---------------------------------------------------------------------------
step_packages() {
  local missing=() cmd
  step 'System packages'
  for cmd in curl git tar gzip; do
    have "$cmd" || missing+=("$cmd")
  done
  has_ca_certificates || missing+=('ca-certificates')
  if (( ${#missing[@]} == 0 )); then
    ok 'curl, ca-certificates, git, tar and gzip are installed'
    return 0
  fi
  pkg_install "${missing[@]}" || die "Could not install: ${missing[*]}. Install these packages by hand and run the script again."
  hash -r
}

# ---------------------------------------------------------------------------
# step: update (git pull)
# ---------------------------------------------------------------------------
git_app() {
  local owner
  owner=$(stat -c %U "$APP_DIR")
  # git refuses to work in a checkout that belongs to somebody else
  if (( EUID == 0 )) && [[ "$owner" != root && "$owner" != UNKNOWN ]] && have runuser; then
    runuser -u "$owner" -- git -C "$APP_DIR" "$@"
  else
    git -C "$APP_DIR" "$@"
  fi
}

step_update_source() {
  local before after
  step 'Update the source'
  if [[ ! -e "$APP_DIR/.git" ]]; then
    ok 'Not a git checkout – nothing to pull (replace the files yourself, then run --update)'
    return 0
  fi
  have git || { warn 'git is not installed – skipping the pull.'; return 0; }
  if [[ -n "$(git_app status --porcelain --untracked-files=no 2>/dev/null || echo unknown)" ]]; then
    warn 'The checkout has local changes – not pulling. Commit or stash them and run --update again to get the new version.'
    return 0
  fi
  before=$(sha256_of "$APP_DIR/install.sh")
  if ! run_logged 'git pull' git_app pull --ff-only; then
    warn 'git pull failed (see above) – continuing with the current source.'
    return 0
  fi
  (( DRY_RUN )) && return 0
  after=$(sha256_of "$APP_DIR/install.sh")
  if [[ "$before" != "$after" && -z "${LT_INSTALL_REEXEC:-}" ]]; then
    ok 'The installer itself was updated – starting the new version'
    remove_swap
    if [[ -n "$TMP_DIR" ]]; then rm -rf -- "$TMP_DIR"; fi
    LT_INSTALL_REEXEC=1 exec bash "$APP_DIR/install.sh" "${ORIG_ARGS[@]}"
  fi
}

# ---------------------------------------------------------------------------
# step: Node.js
# ---------------------------------------------------------------------------
install_node_nodesource() {   # <major>
  local line=$1 script
  [[ "$ARCH" != unsupported* && "$LIBC" == glibc ]] || return 1
  tmp_dir
  script="$TMP_DIR/nodesource-setup.sh"
  case "$PKG" in
    apt) download "https://deb.nodesource.com/setup_${line}.x" "$script" || return 1 ;;
    dnf) [[ "$ARCH" != armhf ]] || return 1
         download "https://rpm.nodesource.com/setup_${line}.x" "$script" || return 1 ;;
    *)   return 1 ;;
  esac
  run_logged "Adding the NodeSource repository (Node.js $line)" as_root bash "$script" || return 1
  APT_UPDATED=1
  pkg_install nodejs
}

# official build from nodejs.org into /usr/local, checksum verified
install_node_tarball() {
  local node_arch line sums file sum target
  case "$ARCH" in
    amd64) node_arch='x64' ;;
    arm64) node_arch='arm64' ;;
    armhf) node_arch='armv7l' ;;
    *)     return 1 ;;
  esac
  [[ "$LIBC" == glibc ]] || node_arch+='-musl'
  tmp_dir
  for line in "${NODE_LINES[@]}"; do
    sums="$TMP_DIR/SHASUMS256-$line.txt"
    download "https://nodejs.org/dist/latest-v${line}.x/SHASUMS256.txt" "$sums" || continue
    # not every line is built for every architecture (32-bit ARM ends with Node 22)
    file=$(awk -v suffix="-linux-${node_arch}.tar.gz" 'index($2, suffix) && substr($2, length($2) - length(suffix) + 1) == suffix { print $2; exit }' "$sums")
    [[ -n "$file" ]] || continue
    sum=$(awk -v f="$file" '$2 == f { print $1; exit }' "$sums")
    run_logged "Downloading $file from nodejs.org" download "https://nodejs.org/dist/latest-v${line}.x/$file" "$TMP_DIR/$file" || continue
    if [[ "$(sha256_of "$TMP_DIR/$file")" != "$sum" ]]; then
      err "Checksum of $file does not match – not installing it."
      rm -f -- "$TMP_DIR/$file"
      continue
    fi
    ok "Checksum verified (sha256 ${sum:0:16}…)"
    target=$(dst /usr/local)
    quiet as_root mkdir -p "$target"
    run_logged "Unpacking Node.js into $target" as_root tar -xzf "$TMP_DIR/$file" -C "$target" --strip-components=1 --no-same-owner \
      --exclude='*/CHANGELOG.md' --exclude='*/README.md' --exclude='*/LICENSE' || return 1
    rm -f -- "$TMP_DIR/$file"
    case ":$PATH:" in *":$target/bin:"*) ;; *) PATH="$target/bin:$PATH" ;; esac
    return 0
  done
  return 1
}

install_node() {
  local line
  case "$PKG" in
    apt|dnf)
      for line in "${NODE_LINES[@]}"; do
        if install_node_nodesource "$line"; then hash -r; node_ok && return 0; fi
        note "NodeSource did not deliver a usable Node.js $line."
      done
      ;;
    # these distributions ship current Node.js releases themselves
    pacman) pkg_install nodejs npm || true ;;
    zypper) pkg_install nodejs22 npm22 || pkg_install nodejs npm || true ;;
    apk)    pkg_install nodejs npm libstdc++ || true ;;
  esac
  hash -r
  if node_ok && have npm; then return 0; fi
  note 'Falling back to the official build from nodejs.org.'
  install_node_tarball || return 1
  hash -r
  node_ok
}

step_node() {
  step 'Node.js'
  if node_ok && have npm; then
    ok "Node.js $(node -v) is installed and has the built-in SQLite"
  else
    if have node; then
      note "Found Node.js $(node -v 2>/dev/null || echo '?'), but LaughTime needs $MIN_NODE_TEXT or newer (built-in SQLite)."
    else
      info "Node.js is not installed – installing the current LTS release (needed: $MIN_NODE_TEXT or newer)."
    fi
    if (( DRY_RUN )); then
      dry "install Node.js ${NODE_LINES[0]} (NodeSource repository where supported, otherwise the nodejs.org build into /usr/local, checksum verified)"
    else
      install_node || die "Could not install Node.js. Install Node.js 22.13+ or 24 yourself (https://nodejs.org/en/download) and run the script again."
      have npm || die 'Node.js is installed, but npm is missing. Install npm with your package manager and run the script again.'
      # the acceptance test of the app itself
      node -e 'require("node:sqlite")' >/dev/null 2>&1 || die "Node.js $(node -v) has no built-in SQLite (node:sqlite)."
      ok "Node.js $(node -v) installed, built-in SQLite works"
    fi
  fi
  if have node; then
    NODE_BIN=$(command -v node)
    NODE_DIR=$(dirname "$NODE_BIN")
  else
    NODE_BIN='/usr/bin/node'; NODE_DIR='/usr/bin'
  fi
}

# ---------------------------------------------------------------------------
# step: project files, .env, service user
# ---------------------------------------------------------------------------
create_service_user() {
  local shell='/bin/false' s
  for s in /usr/sbin/nologin /sbin/nologin; do
    if [[ -x "$s" ]]; then shell=$s; break; fi
  done
  [[ -z "$ROOT_PREFIX" ]] || die "The user \"$SERVICE_USER\" does not exist (no accounts are created while LT_INSTALL_ROOT is set)."
  if have useradd; then
    quiet as_root useradd --system --user-group --create-home --home-dir "$SERVICE_HOME" --shell "$shell" "$SERVICE_USER" \
      || die "Could not create the user \"$SERVICE_USER\"."
  elif have adduser; then
    # BusyBox (Alpine)
    quiet as_root addgroup -S "$SERVICE_USER" || true
    quiet as_root adduser -S -D -h "$SERVICE_HOME" -s "$shell" -G "$SERVICE_USER" "$SERVICE_USER" \
      || die "Could not create the user \"$SERVICE_USER\"."
  else
    die "Neither useradd nor adduser found – create the user \"$SERVICE_USER\" yourself and run the script again."
  fi
  ok "System user \"$SERVICE_USER\" created (home: $SERVICE_HOME, no login)"
}

step_project() {
  local trust
  step 'Project files and settings'

  # .env – an existing file is only ever read
  if [[ -e "$ENV_FILE" || -L "$ENV_FILE" ]]; then
    ok '.env exists – it stays exactly as it is'
  elif [[ -f "$APP_DIR/.env.example" ]]; then
    if (( DRY_RUN )); then
      dry "install -m 600 $APP_DIR/.env.example $ENV_FILE"
    else
      install -m 600 "$APP_DIR/.env.example" "$ENV_FILE"
      own "$ENV_FILE"
      ok '.env created from .env.example (only readable by the owner)'
    fi
    info 'The game runs without any keys. Worth setting in .env:'
    info "  PUBLIC_URL             the public address, e.g. https://$DOMAIN"
    info '  DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET   login with Discord'
    info '  GIPHY_API_KEY / KLIPY_API_KEY               more GIF and meme sources'
    info "After editing: $(restart_hint)"
  else
    warn '.env.example is missing – the app starts with its built-in defaults.'
  fi

  if [[ -d "$DATA_DIR" ]]; then
    ok 'data/ exists'
  elif (( DRY_RUN )); then
    dry "mkdir -p $DATA_DIR"
  else
    mkdir -p "$DATA_DIR"; own "$DATA_DIR"
    ok 'data/ created'
  fi
  info 'data/ holds the database (accounts, memes, statistics) and all uploads – back it up regularly.'

  # service user
  if (( CREATE_USER )); then
    if (( DRY_RUN )); then dry "create the system user \"$SERVICE_USER\" (home $SERVICE_HOME, no login)"; else create_service_user; fi
  fi
  if (( CHOWN_TREE )); then
    note "The app runs as \"$SERVICE_USER\", so the project folder is handed over to that account."
    quiet as_root chown -R "$SERVICE_USER:$SERVICE_GROUP" "$APP_DIR" || die "Could not change the owner of $APP_DIR."
    OWNER_REF=$(stat -c %u:%g "$APP_DIR")
    ok "Owner of $APP_DIR is now $SERVICE_USER"
  fi
  if (( ROOT_FALLBACK )); then
    warn "The app will run as root, because no other account can reach $APP_DIR. Safer: move the project to /opt/laughtime and run the script again there."
  fi
  if (( ! DRY_RUN )); then
    as_app test -w "$APP_DIR" 2>/dev/null || die "The user \"$SERVICE_USER\" cannot write to $APP_DIR. Choose the owner of the folder with --user, or move the project to a folder that account can reach (e.g. /opt/laughtime)."
    if [[ -n "$NODE_BIN" ]]; then
      as_app "$NODE_BIN" -v >/dev/null 2>&1 || die "The user \"$SERVICE_USER\" cannot run $NODE_BIN. Install Node.js system-wide (not in a home folder) and run the script again."
    fi
  fi
  ok "The app runs as: $SERVICE_USER"

  trust=$(env_get TRUST_PROXY); trust=${trust,,}
  if (( WANT_TUNNEL )) && [[ "$trust" == false || "$trust" == 0 || "$trust" == no || "$trust" == off ]]; then
    warn 'TRUST_PROXY is switched off in .env. Behind the Cloudflare Tunnel it must be TRUST_PROXY=true, otherwise every player has the same IP address (rate limits, bans). Please change it in .env.'
  elif (( WANT_TUNNEL )); then
    ok 'TRUST_PROXY is on (needed behind the tunnel – keep it that way)'
  fi
}

restart_hint() {
  case "$MANAGER" in
    systemd) printf 'sudo systemctl restart %s' "${SERVICE_NAME%.service}" ;;
    pm2)     printf 'pm2 restart %s' "$APP_NAME" ;;
    *)       printf 'restart the app' ;;
  esac
}

# ---------------------------------------------------------------------------
# step: dependencies and build
# ---------------------------------------------------------------------------
create_swap() {
  local file free_root
  file=$(dst /swapfile-laughtime-install)
  [[ -z "$ROOT_PREFIX" ]] || { note 'Test prefix active – not creating a swap file.'; return 0; }
  if ! have mkswap || ! have swapon; then note 'mkswap/swapon not available – continuing without extra swap.'; return 0; fi
  free_root=$(disk_free_mb /)
  if [[ -n "$free_root" ]] && (( free_root < SWAP_MB + 2000 )); then
    note 'Not enough free disk space for a temporary swap file – continuing without it.'
    return 0
  fi
  if (( DRY_RUN )); then dry "create a temporary ${SWAP_MB} MB swap file $file (removed again at the end)"; return 0; fi
  SWAP_FILE=$file
  if { as_root fallocate -l "${SWAP_MB}M" "$file" 2>/dev/null || as_root dd if=/dev/zero of="$file" bs=1M count="$SWAP_MB" status=none; } \
    && as_root chmod 600 "$file" && quiet as_root mkswap "$file" && quiet as_root swapon "$file"; then
    ok "Temporary swap file active (${SWAP_MB} MB, removed again at the end)"
  else
    note 'Could not activate a swap file here (containers and some file systems do not allow it) – continuing without it.'
    remove_swap
  fi
}

remove_swap() {
  [[ -n "$SWAP_FILE" ]] || return 0
  as_root swapoff "$SWAP_FILE" 2>/dev/null || true
  as_root rm -f -- "$SWAP_FILE" 2>/dev/null || true
  SWAP_FILE=''
}

# shellcheck disable=SC2317  # both are passed to run_logged as commands
npm_app() { as_app npm "$@"; }

# shellcheck disable=SC2317
build_app() {
  local unset_public=() name
  # NEXT_PUBLIC_* values are baked into the build and are part of the build
  # hash. The service does not have the variables of this shell, so they must
  # not leak in – otherwise the first service start would build again.
  while IFS= read -r name; do
    [[ -n "$name" ]] && unset_public+=(-u "$name")
  done < <(compgen -v | grep -E '^NEXT_PUBLIC_' || true)
  as_app env "${unset_public[@]}" -u LT_DEV -u FORCE_BUILD NODE_ENV=production "$NODE_BIN" "$APP_DIR/index.js" --build-only
}

step_app() {
  local lock="$APP_DIR/package-lock.json" stamp="$APP_DIR/node_modules/.laughtime-install-stamp" lock_hash before after mem
  step 'Dependencies and production build'
  [[ -f "$lock" ]] || lock="$APP_DIR/package.json"
  lock_hash=$(sha256_of "$lock")

  if [[ "$MODE" != update && -f "$stamp" && "$(cat "$stamp" 2>/dev/null)" == "$lock_hash" ]]; then
    ok 'npm packages are up to date'
  else
    if [[ -f "$APP_DIR/package-lock.json" ]]; then
      if ! (cd "$APP_DIR" && run_logged 'npm ci (exact versions from package-lock.json)' npm_app ci --no-audit --no-fund --loglevel=error); then
        note 'npm ci did not work – trying npm install instead.'
        (cd "$APP_DIR" && run_logged 'npm install' npm_app install --no-audit --no-fund --loglevel=error) \
          || die 'Installing the npm packages failed. Check the network connection and the lines above, then run the script again.'
      fi
    else
      (cd "$APP_DIR" && run_logged 'npm install' npm_app install --no-audit --no-fund --loglevel=error) \
        || die 'Installing the npm packages failed. Check the network connection and the lines above, then run the script again.'
    fi
    if (( ! DRY_RUN )); then
      printf '%s\n' "$lock_hash" | as_app tee "$stamp" >/dev/null 2>&1 || true
    fi
    DEPS_CHANGED=1
  fi

  mem=$(mem_available_mb)
  if (( mem > 0 && mem < BUILD_RAM_MB )) && [[ ! -f "$APP_DIR/.next/BUILD_ID" || "$MODE" == update ]]; then
    if confirm "Only ${mem} MB of memory are free. Create a temporary ${SWAP_MB} MB swap file for the build?" y; then
      create_swap
    else
      note 'Building without extra swap – if the build is killed, run the script again and allow the swap file.'
    fi
  fi

  before=$(cat "$APP_DIR/.next/BUILD_ID" 2>/dev/null || true)
  (cd "$APP_DIR" && run_logged 'Production build (node index.js --build-only)' build_app) \
    || die 'The production build failed. With little memory, run the script again and allow the temporary swap file.'
  after=$(cat "$APP_DIR/.next/BUILD_ID" 2>/dev/null || true)
  [[ "$before" == "$after" ]] || BUILD_CHANGED=1
  if (( ! DRY_RUN )); then
    if (( BUILD_CHANGED )); then ok 'New build is ready'; else ok 'The existing build is up to date'; fi
  fi
  remove_swap
}

# ---------------------------------------------------------------------------
# step: process manager
# ---------------------------------------------------------------------------
# writes a root-owned file when its content changed; returns 0 when it wrote
install_root_file() {   # <real path> <mode> <content>
  local path=$1 mode=$2 content=$3 target tmp
  target=$(dst "$path")
  if [[ -f "$target" && "$(as_root cat "$target" 2>/dev/null)" == "$content" ]]; then return 1; fi
  if (( DRY_RUN )); then
    dry "write $target (mode $mode):"
    printf '%s\n' "$content" | sed "s/^/      ${C_DIM}|${C_RESET} /"
    return 0
  fi
  tmp_dir
  tmp=$(mktemp "$TMP_DIR/file.XXXXXX")
  printf '%s\n' "$content" >"$tmp"
  as_root mkdir -p "$(dirname "$target")"
  as_root install -m "$mode" "$tmp" "$target"
  rm -f -- "$tmp"
  log_line "  wrote $target (mode $mode)"
  return 0
}

render_app_unit() {
  local tpl caps='' port_env='# the port comes from .env (SERVER_PORT / PORT)'
  tpl=$(<"$APP_DIR/deploy/laughtime.service")
  # ports below 1024 need a capability when the app does not run as root
  (( PORT >= 1024 )) || caps='CAP_NET_BIND_SERVICE'
  (( ! PORT_OVERRIDE )) || port_env="Environment=SERVER_PORT=$PORT"
  tpl=${tpl//@USER@/$SERVICE_USER}
  tpl=${tpl//@GROUP@/$SERVICE_GROUP}
  tpl=${tpl//@APP_DIR@/$APP_DIR}
  tpl=${tpl//@NODE@/$NODE_BIN}
  tpl=${tpl//@PATH@/$NODE_DIR:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin}
  tpl=${tpl//@PORT_ENV@/$port_env}
  tpl=${tpl//@CAPS@/$caps}
  printf '%s' "$tpl"
}

render_tunnel_unit() {
  local tpl
  tpl=$(<"$APP_DIR/deploy/cloudflared-laughtime.service")
  tpl=${tpl//@TUNNEL_NAME@/$TUNNEL_NAME}
  tpl=${tpl//@CLOUDFLARED@/$CLOUDFLARED_BIN}
  tpl=${tpl//@CONFIG@/$CF_CONFIG}
  printf '%s' "$tpl"
}

# installs a unit, enables it and (re)starts it only when something changed,
# so a second run does not throw the players out of their rooms
systemd_apply() {   # <unit name> <content> <restart needed 0|1>
  local unit=$1 content=$2 restart=$3
  if install_root_file "/etc/systemd/system/$unit" 644 "$content"; then
    ok "Unit $unit written"
    quiet as_root systemctl daemon-reload || die 'systemctl daemon-reload failed.'
    restart=1
  else
    ok "Unit $unit is unchanged"
  fi
  if (( DRY_RUN )); then
    dry "sudo systemctl enable --now $unit"
    return 0
  fi
  if as_root systemctl is-active --quiet "$unit" 2>/dev/null; then
    quiet as_root systemctl enable "$unit" || die "systemctl enable $unit failed."
    if (( restart )); then
      quiet as_root systemctl restart "$unit" || return 1
      ok "$unit restarted"
    else
      ok "$unit is already running – left alone"
    fi
  else
    quiet as_root systemctl enable --now "$unit" || return 1
    ok "$unit enabled and started"
  fi
}

ensure_pm2() {
  local prefix
  if have pm2; then
    PM2_BIN=$(command -v pm2)
    ok "PM2 $("$PM2_BIN" --version 2>/dev/null | tail -n 1) is installed"
    return 0
  fi
  if (( DRY_RUN )); then dry 'npm install -g pm2'; PM2_BIN='pm2'; return 0; fi
  prefix=$(npm prefix -g 2>/dev/null || true)
  if [[ -n "$prefix" && -w "$prefix" ]] || (( EUID == 0 )); then
    run_logged 'Installing PM2 (npm install -g pm2)' npm install -g pm2 --no-audit --no-fund --loglevel=error || die 'Could not install PM2.'
  else
    run_logged 'Installing PM2 (sudo npm install -g pm2)' as_root env PATH="$PATH" npm install -g pm2 --no-audit --no-fund --loglevel=error || die 'Could not install PM2.'
  fi
  hash -r
  if have pm2; then PM2_BIN=$(command -v pm2)
  elif [[ -n "$prefix" && -x "$prefix/bin/pm2" ]]; then PM2_BIN="$prefix/bin/pm2"
  else die 'PM2 was installed, but the pm2 command is not on the PATH.'
  fi
  ok 'PM2 installed'
}

pm2_running() {   # <name>
  local pid
  pid=$(pm2_app pid "$1" 2>/dev/null | tail -n 1) || return 1
  [[ "$pid" =~ ^[0-9]+$ ]] && (( pid > 0 ))
}

# starts a PM2 process, or replaces it when its settings may have changed;
# PM2 remembers the environment of the start command (PM2_ENV)
pm2_apply() {   # <name> <restart needed 0|1> <script> [pm2 options...]
  local name=$1 restart=$2 script=$3; shift 3
  if (( DRY_RUN )); then dry "$(quote_cmd pm2_app start "$script" --name "$name" "$@")"; return 0; fi
  if pm2_app describe "$name" >/dev/null 2>&1; then
    if (( ! restart )) && pm2_running "$name"; then
      ok "PM2 process \"$name\" is already running – left alone"
      return 0
    fi
    quiet pm2_app delete "$name" || true
  fi
  quiet as_app env "${PM2_ENV[@]}" "$PM2_BIN" start "$script" --name "$name" "$@" || return 1
  ok "PM2 process \"$name\" started"
}

pm2_persist() {
  (( DRY_RUN )) && { dry "$(quote_cmd pm2_app save)"; return 0; }
  quiet pm2_app save || note 'pm2 save failed – the process list is not stored for the next boot.'
  if [[ "$INIT" == systemd ]]; then
    # PM2 itself becomes a systemd service, so the processes survive a reboot
    if quiet as_root env PATH="$NODE_DIR:$PATH" "$PM2_BIN" startup systemd -u "$SERVICE_USER" --hp "$SERVICE_HOME"; then
      ok 'PM2 starts with the system (pm2 startup)'
    else
      note "Run this once so PM2 starts with the system: sudo env PATH=\$PATH pm2 startup systemd -u $SERVICE_USER --hp $SERVICE_HOME"
    fi
  else
    info 'PM2 process list saved. This system has no systemd, so PM2 cannot register itself for the boot:'
    info "  start it from your init system or container entry point with:  pm2 resurrect   (as $SERVICE_USER)"
    info '  on a server with systemd:  pm2 startup   (prints the command to run once)'
  fi
}

show_app_logs() {
  {
    printf '\n    Last log lines of the app:\n'
    if [[ "$MANAGER" == systemd ]]; then
      as_root journalctl -u "$SERVICE_NAME" -n 40 --no-pager 2>&1 | sed 's/^/      /' || true
    else
      pm2_app logs "$APP_NAME" --lines 40 --nostream 2>&1 | sed 's/^/      /' || true
    fi
  } >&2
}

# waits until the URL answers with 200
wait_for_http() {   # <url> <timeout seconds> <label> [extra curl options...]
  local url=$1 timeout=$2 label=$3 start=$SECONDS code
  shift 3
  while true; do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$@" "$url" 2>/dev/null) || true
    [[ "$code" == 200 ]] && break
    if (( SECONDS - start >= timeout )); then
      [[ -t 1 ]] && printf '\r\e[K'
      log_line "  $url did not answer with 200 within ${timeout}s (last status: ${code:-none})"
      return 1
    fi
    [[ -t 1 ]] && printf '\r  %s…%s %s (%ds of max. %ds) ' "$C_CYAN" "$C_RESET" "$label" "$((SECONDS - start))" "$timeout"
    sleep 3
  done
  [[ -t 1 ]] && printf '\r\e[K'
  return 0
}

step_service() {
  local restart=0 health="http://$LOCAL_HOST:$PORT/api/status"
  step "Process manager ($MANAGER)"
  if (( DEPS_CHANGED || BUILD_CHANGED )) || [[ "$MODE" == update ]]; then restart=1; fi

  if [[ "$MANAGER" == systemd ]]; then
    [[ "$APP_DIR" =~ ^/[A-Za-z0-9_./@+,-]*$ ]] || die "The project path \"$APP_DIR\" contains characters a systemd unit cannot handle safely (spaces, quotes, …). Move the project, e.g. to /opt/laughtime."
    systemd_apply "$SERVICE_NAME" "$(render_app_unit)" "$restart" || {
      show_app_logs
      die "Could not start $SERVICE_NAME – see the log lines above (sudo journalctl -u ${SERVICE_NAME%.service} -e)."
    }
  else
    ensure_pm2
    PM2_ENV=(NODE_ENV=production)
    (( ! PORT_OVERRIDE )) || PM2_ENV+=("SERVER_PORT=$PORT")
    pm2_apply "$APP_NAME" "$restart" "$APP_DIR/index.js" --cwd "$APP_DIR" \
      --interpreter "$NODE_BIN" --time --restart-delay 5000 --kill-timeout 20000 \
      || { show_app_logs; die "Could not start the PM2 process \"$APP_NAME\"."; }
    pm2_persist
  fi

  if (( DRY_RUN )); then
    dry "wait until $health answers with 200 (max. ${HEALTH_TIMEOUT}s)"
    APP_STATUS='dry run'
    return 0
  fi
  if wait_for_http "$health" "$HEALTH_TIMEOUT" 'Waiting for the app (the first start may take a moment)' --noproxy '*'; then
    ok "The app answers on $health"
    APP_STATUS='running'
  else
    APP_STATUS='not answering'
    err "The app did not answer on $health within ${HEALTH_TIMEOUT} seconds."
    show_app_logs
    die "The service was started, but the app is not healthy. Is port $PORT already in use (see the log lines above)? Use --port <n> for another port."
  fi
}

# ---------------------------------------------------------------------------
# step: Cloudflare Tunnel
# ---------------------------------------------------------------------------
install_cloudflared_repo() {
  local key list repo
  tmp_dir
  case "$PKG" in
    apt)
      key=$(dst /usr/share/keyrings/cloudflare-public-v2.gpg)
      list=$(dst /etc/apt/sources.list.d/cloudflared.list)
      download 'https://pkg.cloudflare.com/cloudflare-public-v2.gpg' "$TMP_DIR/cloudflare.gpg" || return 1
      as_root mkdir -p "$(dirname "$key")" "$(dirname "$list")" || return 1
      as_root install -m 644 "$TMP_DIR/cloudflare.gpg" "$key" || return 1
      printf 'deb [signed-by=/usr/share/keyrings/cloudflare-public-v2.gpg] https://pkg.cloudflare.com/cloudflared any main\n' >"$TMP_DIR/cloudflared.list"
      as_root install -m 644 "$TMP_DIR/cloudflared.list" "$list" || return 1
      APT_UPDATED=0
      pkg_install cloudflared
      ;;
    dnf)
      repo=$(dst /etc/yum.repos.d/cloudflared.repo)
      download 'https://pkg.cloudflare.com/cloudflared.repo' "$TMP_DIR/cloudflared.repo" || return 1
      as_root mkdir -p "$(dirname "$repo")" || return 1
      as_root install -m 644 "$TMP_DIR/cloudflared.repo" "$repo" || return 1
      pkg_install cloudflared
      ;;
    *) return 1 ;;
  esac
}

install_cloudflared_binary() {
  local asset target
  case "$ARCH" in
    amd64) asset='cloudflared-linux-amd64' ;;
    arm64) asset='cloudflared-linux-arm64' ;;
    armhf) asset='cloudflared-linux-armhf' ;;
    *)     return 1 ;;
  esac
  tmp_dir
  target=$(dst /usr/local/bin/cloudflared)
  run_logged "Downloading $asset from the cloudflared releases on GitHub" \
    download "https://github.com/cloudflare/cloudflared/releases/latest/download/$asset" "$TMP_DIR/cloudflared" || return 1
  chmod +x "$TMP_DIR/cloudflared"
  # a truncated or wrong download must not end up in /usr/local/bin
  "$TMP_DIR/cloudflared" --version >/dev/null 2>&1 || { err 'The downloaded cloudflared binary does not run on this system.'; return 1; }
  as_root mkdir -p "$(dirname "$target")" || return 1
  as_root install -m 755 "$TMP_DIR/cloudflared" "$target" || return 1
  case ":$PATH:" in *":$(dirname "$target"):"*) ;; *) PATH="$(dirname "$target"):$PATH" ;; esac
}

ensure_cloudflared() {
  if have cloudflared; then
    CLOUDFLARED_BIN=$(command -v cloudflared)
    ok "cloudflared is installed ($("$CLOUDFLARED_BIN" --version 2>/dev/null | head -n 1))"
    return 0
  fi
  if (( DRY_RUN )); then
    dry 'install cloudflared (Cloudflare package repository for apt/dnf, otherwise the release binary into /usr/local/bin)'
    CLOUDFLARED_BIN='/usr/local/bin/cloudflared'
    return 0
  fi
  if [[ "$PKG" == apt || "$PKG" == dnf ]] && [[ "$ARCH" != unsupported* ]]; then
    install_cloudflared_repo || note 'The Cloudflare package repository did not work here – using the release binary instead.'
    hash -r
  fi
  if ! have cloudflared; then
    install_cloudflared_binary || die 'Could not install cloudflared. Install it yourself (https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) and run the script again, or skip the tunnel with --no-tunnel.'
    hash -r
  fi
  have cloudflared || die 'cloudflared was installed, but the command is not on the PATH.'
  CLOUDFLARED_BIN=$(command -v cloudflared)
  ok "cloudflared installed ($("$CLOUDFLARED_BIN" --version 2>/dev/null | head -n 1))"
}

cf_cert_path() { printf '%s' "${TUNNEL_ORIGIN_CERT:-$HOME/.cloudflared/cert.pem}"; }

rule() { printf '%s%s%s\n' "$C_YELLOW" '======================================================================' "$C_RESET"; }

# prints what cloudflared says and makes the authorisation link stand out
show_login_output() {
  local line shown=0
  while IFS= read -r line; do
    log_line "    cloudflared: $line"
    if [[ "$line" =~ (https://[^[:space:]]+) ]] && (( ! shown )); then
      shown=1
      printf '\n'
      rule
      printf '%s  OPEN THIS LINK IN YOUR BROWSER (any device):%s\n\n' "$C_BOLD" "$C_RESET"
      printf '%s\n\n' "${BASH_REMATCH[1]}"
      printf '  1. Log in to your Cloudflare account.\n'
      printf '  2. Choose the zone  %s%s%s  and click "Authorize".\n' "$C_BOLD" "$DOMAIN" "$C_RESET"
      printf '  3. Come back here – the script continues by itself.\n'
      rule
      printf '\n'
    fi
  done
}

cf_login() {
  local cert fifo login_pid reader_pid start=$SECONDS rc=0
  cert=$(cf_cert_path)
  if [[ -s "$cert" ]]; then
    ok 'Cloudflare authorisation found (cert.pem) – no new login needed'
    return 0
  fi
  if (( DRY_RUN )); then
    dry "cloudflared tunnel login   (shows the authorisation link, then waits up to ${LOGIN_TIMEOUT}s for $cert)"
    return 0
  fi
  say ''
  say "  ${C_BOLD}Cloudflare has to authorise this server once.${C_RESET}"
  say "  The domain $DOMAIN must already be added to your Cloudflare account (as a zone)."
  say '  A link appears below in a moment – open it, log in and choose that zone.'
  tmp_dir
  fifo="$TMP_DIR/login.fifo"
  rm -f -- "$fifo"; mkfifo "$fifo"
  "$CLOUDFLARED_BIN" tunnel login >"$fifo" 2>&1 &
  login_pid=$!
  CHILD_PID=$login_pid
  show_login_output <"$fifo" &
  reader_pid=$!

  while [[ ! -s "$cert" ]]; do
    if ! kill -0 "$login_pid" 2>/dev/null; then
      wait "$login_pid" || rc=$?
      break
    fi
    if (( SECONDS - start >= LOGIN_TIMEOUT )); then
      kill "$login_pid" 2>/dev/null || true
      wait "$login_pid" 2>/dev/null || true
      wait "$reader_pid" 2>/dev/null || true
      CHILD_PID=''
      die "No authorisation within $((LOGIN_TIMEOUT / 60)) minutes. Nothing is lost: run the script again and open the link it shows. Without a browser at hand: copy the link to any device – it only has to be opened by somebody who is logged in to the Cloudflare account."
    fi
    sleep 2
  done
  # cloudflared ends by itself right after it has written the certificate
  local waited=0
  while kill -0 "$login_pid" 2>/dev/null && (( waited < 10 )); do sleep 1; waited=$((waited + 1)); done
  kill "$login_pid" 2>/dev/null || true
  wait "$login_pid" 2>/dev/null || true
  wait "$reader_pid" 2>/dev/null || true
  CHILD_PID=''
  rm -f -- "$fifo"
  [[ -s "$cert" ]] || die "cloudflared tunnel login ended without a certificate (exit code $rc). Details: $LOG_FILE. Try again; if a browser cannot be reached from this server, open the link on another device."
  ok "Authorised – certificate saved as $cert"
}

# id of the tunnel with our name, empty when there is none
cf_find_tunnel() {
  local json
  json=$("$CLOUDFLARED_BIN" tunnel list --output json --name "$TUNNEL_NAME" 2>>"$LOG_FILE") || return 1
  printf '%s' "$json" | "$NODE_BIN" -e '
    let text = "";
    process.stdin.on("data", (d) => (text += d)).on("end", () => {
      let list;
      try { list = JSON.parse(text) || []; } catch { process.exit(3); }
      const live = (t) => !t.deleted_at || String(t.deleted_at).startsWith("0001");
      const hit = list.find((t) => t && t.name === process.argv[1] && live(t));
      if (hit) console.log(hit.id);
    });' "$TUNNEL_NAME"
}

cf_tunnel() {
  local cf_home creds
  cf_home=$(dirname "$(cf_cert_path)")
  if (( DRY_RUN )) && { [[ ! -s "$(cf_cert_path)" ]] || ! have cloudflared; }; then
    dry "cloudflared tunnel list --output json --name $TUNNEL_NAME   (reuse the tunnel when it exists)"
    dry "cloudflared tunnel create $TUNNEL_NAME"
    TUNNEL_ID='<tunnel-id>'
    return 0
  fi
  TUNNEL_ID=$(cf_find_tunnel) || die "cloudflared could not list the tunnels of the account (details: $LOG_FILE). If the authorisation was revoked, delete $(cf_cert_path) and run the script again."
  if [[ -n "$TUNNEL_ID" ]]; then
    ok "Tunnel \"$TUNNEL_NAME\" exists ($TUNNEL_ID) – using it"
  elif (( DRY_RUN )); then
    dry "cloudflared tunnel create $TUNNEL_NAME"
    TUNNEL_ID='<tunnel-id>'
    return 0
  else
    quiet "$CLOUDFLARED_BIN" tunnel create "$TUNNEL_NAME" || die "cloudflared tunnel create $TUNNEL_NAME failed (details: $LOG_FILE)."
    TUNNEL_ID=$(cf_find_tunnel) || TUNNEL_ID=''
    [[ -n "$TUNNEL_ID" ]] || die "The tunnel \"$TUNNEL_NAME\" was created, but it does not show up in the tunnel list (details: $LOG_FILE)."
    ok "Tunnel \"$TUNNEL_NAME\" created ($TUNNEL_ID)"
  fi
  [[ "$TUNNEL_ID" =~ ^[0-9a-fA-F-]{36}$ ]] || die "Unexpected tunnel id \"$TUNNEL_ID\"."

  # the credentials file is written by "tunnel create" on the machine that
  # created the tunnel – a tunnel made elsewhere gets a fresh one from the API
  creds="$cf_home/$TUNNEL_ID.json"
  if [[ ! -s "$creds" ]]; then
    if (( DRY_RUN )); then
      dry "cloudflared tunnel token --cred-file $creds $TUNNEL_ID"
    else
      note 'The credentials file of this tunnel is not on this server – fetching it from Cloudflare.'
      quiet "$CLOUDFLARED_BIN" tunnel token --cred-file "$creds" "$TUNNEL_ID" \
        || die "Could not fetch the credentials of tunnel \"$TUNNEL_NAME\". Copy $TUNNEL_ID.json from the server that created the tunnel to $cf_home/, or use another --tunnel-name."
      chmod 600 "$creds" 2>/dev/null || true
      ok 'Credentials file fetched'
    fi
  fi
}

render_cf_config() {   # <credentials path as the service sees it>
  local host
  printf '%s – changes are overwritten on the next run.\n' "$MANAGED_MARK"
  printf '# Tunnel "%s" for LaughTime.lol. Main page and beta are served by the same\n' "$TUNNEL_NAME"
  printf '# instance; the app tells them apart by the Host header, which the tunnel\n'
  printf '# passes on unchanged. WebSockets need no extra settings.\n\n'
  printf 'tunnel: %s\n' "$TUNNEL_ID"
  printf 'credentials-file: %s\n\n' "$1"
  printf 'ingress:\n'
  for host in "${HOSTNAMES[@]}"; do
    printf '  - hostname: %s\n    service: http://%s:%s\n' "$host" "${LOCAL_HOST/127.0.0.1/localhost}" "$PORT"
  done
  printf '  # mandatory last rule: everything else is answered with 404\n'
  printf '  - service: http_status:404\n'
}

# returns 0 when the configuration changed
cf_config() {
  local cf_home creds_src conf_dir creds_dst content target backup changed=1
  cf_home=$(dirname "$(cf_cert_path)")
  creds_src="$cf_home/$TUNNEL_ID.json"
  conf_dir=$(dirname "$CF_CONFIG")
  creds_dst="$conf_dir/$TUNNEL_ID.json"
  target=$(dst "$CF_CONFIG")

  # the service reads its own copy of the credentials: a systemd service has
  # no access to home folders, a PM2 process runs as the service user
  if [[ "$conf_dir" != "$cf_home" ]]; then
    if (( DRY_RUN )); then
      dry "install -m 600 $creds_src $(dst "$creds_dst")"
    elif [[ ! -f "$(dst "$creds_dst")" ]] || ! as_root cmp -s "$creds_src" "$(dst "$creds_dst")"; then
      as_root mkdir -p "$(dst "$conf_dir")"
      as_root install -m 600 "$creds_src" "$(dst "$creds_dst")" || die "Could not copy the tunnel credentials to $conf_dir."
      if [[ "$MANAGER" == pm2 && -z "$ROOT_PREFIX" ]]; then
        as_root chown "$SERVICE_USER:$SERVICE_GROUP" "$(dst "$conf_dir")" "$(dst "$creds_dst")" || true
      fi
      ok "Tunnel credentials copied to $creds_dst (mode 600)"
    fi
  fi

  content=$(render_cf_config "$creds_dst")
  if [[ -f "$target" && "$(as_root cat "$target" 2>/dev/null)" == "$content" ]]; then
    ok "Tunnel configuration $CF_CONFIG is unchanged"
    return 1
  fi
  if [[ -f "$target" ]] && (( ! DRY_RUN )); then
    backup="$target.bak-$(date +%Y%m%d-%H%M%S)"
    as_root cp -p "$target" "$backup"
    ok "Previous configuration saved as ${backup#"$ROOT_PREFIX"}"
  fi
  install_root_file "$CF_CONFIG" 644 "$content" || true
  if (( DRY_RUN )); then return 0; fi
  if [[ "$MANAGER" == pm2 && -z "$ROOT_PREFIX" && "$conf_dir" != "$cf_home" ]]; then as_root chown "$SERVICE_USER:$SERVICE_GROUP" "$target" || true; fi
  ok "Tunnel configuration written: $CF_CONFIG"
  for host in "${HOSTNAMES[@]}"; do info "  $host -> http://${LOCAL_HOST/127.0.0.1/localhost}:$PORT"; done
  if ! as_root "$CLOUDFLARED_BIN" tunnel --config "$target" ingress validate >>"$LOG_FILE" 2>&1; then
    die "cloudflared does not accept the configuration $CF_CONFIG (details: $LOG_FILE)."
  fi
  changed=0
  return "$changed"
}

cf_dns() {
  local host out rc pattern
  DNS_FAILED=()
  for host in "${HOSTNAMES[@]}"; do
    if (( DRY_RUN )); then dry "cloudflared tunnel route dns --overwrite-dns $TUNNEL_NAME $host"; continue; fi
    rc=0
    log_line "\$ cloudflared tunnel route dns --overwrite-dns $TUNNEL_ID $host"
    out=$("$CLOUDFLARED_BIN" tunnel route dns --overwrite-dns "$TUNNEL_ID" "$host" 2>&1) || rc=$?
    log_line "$out"
    # A hostname outside the authorised zone does not fail: cloudflared then
    # creates "<hostname>.<authorised zone>" instead, which helps nobody.
    pattern="${host//./\\.}\\.[a-z0-9-]"
    if (( rc != 0 )); then
      DNS_FAILED+=("$host")
      err "DNS record for $host could not be created:"
      printf '%s\n' "$out" | tail -n 4 | sed 's/^/      /' >&2
    elif printf '%s' "$out" | grep -qiE -- "$pattern"; then
      DNS_FAILED+=("$host")
      err "DNS record for $host landed in another zone:"
      printf '%s\n' "$out" | tail -n 2 | sed 's/^/      /' >&2
    else
      ok "DNS: $host -> tunnel $TUNNEL_NAME"
    fi
  done
  if (( ${#DNS_FAILED[@]} )); then
    warn "No DNS record for: ${DNS_FAILED[*]}. The authorisation (cert.pem) is valid for exactly one zone – the one chosen at the login. If the domain is in another zone or account: delete $(cf_cert_path), run the script again and choose the right zone. Or create the record by hand in the Cloudflare dashboard: CNAME <hostname> -> $TUNNEL_ID.cfargotunnel.com (proxied)."
  fi
}

cf_service() {   # <restart needed 0|1>
  local restart=$1 target
  target=$(dst "$CF_CONFIG")
  case "$MANAGER" in
    systemd)
      systemd_apply "$TUNNEL_UNIT" "$(render_tunnel_unit)" "$restart" || {
        as_root journalctl -u "$TUNNEL_UNIT" -n 20 --no-pager 2>&1 | sed 's/^/      /' >&2 || true
        die "Could not start $TUNNEL_UNIT (sudo journalctl -u ${TUNNEL_UNIT%.service} -e)."
      }
      TUNNEL_STATUS="systemd unit $TUNNEL_UNIT"
      ;;
    pm2)
      PM2_ENV=(NO_AUTOUPDATE=true)
      pm2_apply "cloudflared-$TUNNEL_NAME" "$restart" "$CLOUDFLARED_BIN" --interpreter none --time --restart-delay 5000 \
        -- --no-autoupdate tunnel --config "$target" run \
        || die "Could not start the PM2 process \"cloudflared-$TUNNEL_NAME\"."
      if (( ! DRY_RUN )); then quiet pm2_app save || true; fi
      TUNNEL_STATUS="PM2 process cloudflared-$TUNNEL_NAME"
      ;;
    *)
      note 'No process manager (--no-service): the tunnel is configured, but not started. Start it yourself:'
      info "  cloudflared --no-autoupdate tunnel --config $CF_CONFIG run"
      TUNNEL_STATUS='configured, not started (--no-service)'
      ;;
  esac
}

check_public() {   # <timeout seconds>
  local url="https://$DOMAIN/api/status"
  if (( DRY_RUN )); then dry "wait until $url answers with 200 (max. $1s)"; return 0; fi
  if wait_for_http "$url" "$1" "Waiting for $url"; then
    PUBLIC_OK=1
    ok "$url answers – the instance is online"
  else
    PUBLIC_OK=0
  fi
}

step_tunnel() {
  local labels changed=0
  step 'Cloudflare Tunnel'
  labels=${DOMAIN//[^.]/}
  if (( ${#labels} >= 2 )) && (( ${#HOSTNAMES[@]} > 1 )); then
    note "If $DOMAIN is a subdomain: Cloudflare's free certificate covers one level only (*.example.com). Hostnames below it (www.$DOMAIN, beta.$DOMAIN) then need --no-www and e.g. --beta-domain beta-${DOMAIN%%.*}.${DOMAIN#*.}."
  fi
  ensure_cloudflared
  cf_login
  cf_tunnel
  if cf_config; then changed=1; fi
  cf_dns
  cf_service "$changed"
  state_set tunnel_name "$TUNNEL_NAME"
  state_set domain "$DOMAIN"
  if (( WANT_BETA )); then state_set beta_domain "$BETA_DOMAIN"; fi

  if [[ "$MANAGER" == none ]]; then
    PUBLIC_OK=''
    return 0
  fi
  check_public "$PUBLIC_TIMEOUT"
  if [[ "$PUBLIC_OK" == 0 ]]; then
    warn "https://$DOMAIN/api/status did not answer with 200 within ${PUBLIC_TIMEOUT} seconds. New DNS records can take a few minutes; test again with: curl -I https://$DOMAIN/api/status"
  fi
}

# ---------------------------------------------------------------------------
# step: summary and Discord ping
# ---------------------------------------------------------------------------
announce() {
  local hook title text payload rc=0
  (( WANT_ANNOUNCE )) || return 0
  hook=$(env_get DISCORD_WEBHOOK_URL)
  [[ -n "$hook" ]] || return 0
  if [[ "$PUBLIC_OK" != 1 ]]; then
    (( DRY_RUN )) && { dry "post \"LaughTime v2 is live on $DOMAIN\" to the Discord webhook (only when the public URL answers)"; return 0; }
    info "Discord: no announcement, because https://$DOMAIN did not answer yet. Run the script again when it does."
    return 0
  fi
  if [[ "$(state_get announced)" == "$DOMAIN" ]]; then
    # one "we are live" per domain is enough – a re-run must not spam the channel
    if (( ! INTERACTIVE )) || ! confirm "The Discord channel was already told that $DOMAIN is live. Post again?" n; then
      info 'Discord: already announced earlier – not posting again.'
      return 0
    fi
  elif ! confirm "Post \"LaughTime v2 is live on $DOMAIN\" to your Discord webhook?" y; then
    return 0
  fi
  title="LaughTime v2 is live on $DOMAIN"
  text="LaughTime v2 ist jetzt live: https://$DOMAIN – LaughTime v2 is now live: https://$DOMAIN"
  if [[ -f "$APP_DIR/scripts/announce.mjs" ]]; then
    (cd "$APP_DIR" && as_app "$NODE_BIN" scripts/announce.mjs "$title" "$text") >>"$LOG_FILE" 2>&1 || rc=$?
  elif [[ "$hook" =~ ^https://[^[:space:]\"\\]+$ ]]; then
    # shellcheck disable=SC2016  # JavaScript template string, not a shell expansion
    payload=$("$NODE_BIN" -e 'process.stdout.write(JSON.stringify({ content: `**${process.argv[1]}**\n${process.argv[2]}` }))' "$title" "$text")
    # the webhook address is a secret: it goes to curl on stdin, not on the command line
    printf 'url = "%s"\n' "$hook" | curl -fsS --max-time 15 -o /dev/null -H 'Content-Type: application/json' -d "$payload" -K - >>"$LOG_FILE" 2>&1 || rc=$?
  else
    rc=1
  fi
  if (( rc == 0 )); then
    ok 'Posted to the Discord webhook'
    state_set announced "$DOMAIN"
  else
    note 'The Discord webhook did not accept the message – the installation itself is fine.'
  fi
}

box_line() { printf '  %s|%s %s\n' "$C_MAGENTA" "$C_RESET" "$*"; log_line "  | $*"; }
box_rule() { printf '  %s+--------------------------------------------------------------------%s\n' "$C_MAGENTA" "$C_RESET"; log_line '  +--------------------------------------------------------------------'; }

step_summary() {
  local w host
  step 'Summary'
  if [[ -z "$PUBLIC_OK" ]] && (( ! DRY_RUN )) && [[ "$MANAGER" != none ]]; then
    # no tunnel from this run: one short look whether a reverse proxy already answers
    if wait_for_http "https://$DOMAIN/api/status" 0 ''; then PUBLIC_OK=1; else PUBLIC_OK=0; fi
  fi
  announce || true

  say ''
  box_rule
  if (( DRY_RUN )); then box_line "${C_BOLD}Dry run finished – nothing was changed.${C_RESET}"
  elif [[ "$MODE" == update ]]; then box_line "${C_BOLD}LaughTime is updated.${C_RESET}"
  else box_line "${C_BOLD}LaughTime is installed.${C_RESET}"; fi
  box_rule
  box_line "Folder      $APP_DIR"
  case "$MANAGER" in
    systemd) box_line "App         systemd unit $SERVICE_NAME (user $SERVICE_USER)${APP_STATUS:+ – $APP_STATUS}" ;;
    pm2)     box_line "App         PM2 process \"$APP_NAME\" (user $SERVICE_USER)${APP_STATUS:+ – $APP_STATUS}" ;;
    *)       box_line 'App         no process manager (--no-service) – start it with: node index.js' ;;
  esac
  box_line "Port        $PORT   (http://$LOCAL_HOST:$PORT/api/status)"
  if (( WANT_TUNNEL )) && [[ "$MODE" != update ]]; then
    box_line "Tunnel      \"$TUNNEL_NAME\"${TUNNEL_ID:+ ($TUNNEL_ID)}"
    box_line "            ${TUNNEL_STATUS:-not set up}, configuration: $CF_CONFIG"
    for host in "${HOSTNAMES[@]}"; do box_line "            https://$host"; done
  elif [[ "$MODE" == update ]]; then
    box_line 'Tunnel      not touched by --update'
  else
    box_line 'Tunnel      none (--no-tunnel) – reverse proxy example: deploy/nginx.example.conf'
  fi
  case "$PUBLIC_OK" in
    1) box_line "Public      ${C_GREEN}https://$DOMAIN answers${C_RESET}" ;;
    0) box_line "Public      ${C_YELLOW}https://$DOMAIN does not answer yet${C_RESET} (DNS can take a few minutes)" ;;
    *) box_line 'Public      not checked' ;;
  esac
  box_rule
  case "$MANAGER" in
    systemd)
      box_line "Logs        sudo journalctl -u ${SERVICE_NAME%.service} -f"
      (( ! WANT_TUNNEL )) || box_line "            sudo journalctl -u ${TUNNEL_UNIT%.service} -f"
      box_line "Restart     sudo systemctl restart ${SERVICE_NAME%.service}"
      ;;
    pm2)
      box_line "Logs        pm2 logs $APP_NAME     (as $SERVICE_USER)"
      box_line "Restart     pm2 restart $APP_NAME"
      ;;
  esac
  box_line "Install log $LOG_FILE"
  box_line 'Update      bash install.sh --update'
  box_line 'Uninstall   bash install.sh --uninstall   (.env and data/ are kept)'
  box_line 'Backup      data/ and .env – everything else can be rebuilt'
  box_rule
  if (( ${#WARNINGS[@]} )); then
    say ''
    say "  ${C_YELLOW}Please check (${#WARNINGS[@]}):${C_RESET}"
    for w in "${WARNINGS[@]}"; do say "   - $w"; done
  fi
  say ''
}

# ---------------------------------------------------------------------------
# uninstall
# ---------------------------------------------------------------------------
uninstall() {
  local unit target id='' f removed=0 conf
  STEP_TOTAL=1
  step 'Uninstall'
  info 'Removes the services and the tunnel configuration of this installation.'
  info "Kept: .env, data/, the build, Node.js, cloudflared and the tunnel \"$TUNNEL_NAME\" in your Cloudflare account."
  if ! confirm 'Remove the LaughTime services from this server?' n && (( INTERACTIVE )); then
    info 'Nothing was changed.'
    return 0
  fi

  for unit in "$SERVICE_NAME" "$TUNNEL_UNIT"; do
    target=$(dst "/etc/systemd/system/$unit")
    [[ -f "$target" ]] || continue
    if [[ "$INIT" == systemd ]]; then
      quiet as_root systemctl disable --now "$unit" || true
    fi
    quiet as_root rm -f -- "$target"
    ok "Removed $unit"
    removed=1
  done
  if (( removed )) && [[ "$INIT" == systemd ]]; then quiet as_root systemctl daemon-reload || true; fi

  if have pm2; then
    PM2_BIN=$(command -v pm2)
    if have node; then NODE_BIN=$(command -v node); NODE_DIR=$(dirname "$NODE_BIN"); fi
    for unit in "$APP_NAME" "cloudflared-$TUNNEL_NAME"; do
      if pm2_app describe "$unit" >/dev/null 2>&1; then
        quiet pm2_app delete "$unit" || true
        ok "Removed the PM2 process \"$unit\""
        removed=1
      fi
    done
    if (( removed )); then quiet pm2_app save --force || true; fi
  fi

  # our tunnel configuration (and its backups); the copy of the credentials
  # only where the script put one – never the originals in ~/.cloudflared
  for conf in "/etc/cloudflared/$TUNNEL_NAME.yml" "$SERVICE_HOME/.cloudflared/$TUNNEL_NAME.yml" "$HOME/.cloudflared/$TUNNEL_NAME.yml"; do
    target=$(dst "$conf")
    [[ -f "$target" ]] || continue
    if ! as_root grep -qF -- "$MANAGED_MARK" "$target" 2>/dev/null; then
      note "$conf was not written by this script – left alone."
      continue
    fi
    # shellcheck disable=SC2016  # awk program
    id=$(as_root awk '$1 == "tunnel:" { print $2; exit }' "$target" 2>/dev/null || true)
    quiet as_root rm -f -- "$target"
    for f in "$target".bak-*; do
      [[ -e "$f" ]] && quiet as_root rm -f -- "$f"
    done
    if [[ "$conf" == /etc/cloudflared/* && "$id" =~ ^[0-9a-fA-F-]{36}$ && -f "$(dst "/etc/cloudflared/$id.json")" ]]; then
      quiet as_root rm -f -- "$(dst "/etc/cloudflared/$id.json")"
    fi
    ok "Removed the tunnel configuration $conf"
    removed=1
  done

  (( removed )) || ok 'Nothing of this installation was found – nothing to remove'
  say ''
  info 'Still there, on purpose:'
  info "  $ENV_FILE and $DATA_DIR (your settings and data)"
  info "  the tunnel in your Cloudflare account – delete it with:  cloudflared tunnel delete $TUNNEL_NAME"
  info '  its DNS records (Cloudflare dashboard -> DNS), Node.js and cloudflared'
  say ''
}

# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
start_log() {
  (( DRY_RUN )) && return 0
  if [[ ! -d "$DATA_DIR" ]]; then mkdir -p "$DATA_DIR" 2>/dev/null && own "$DATA_DIR"; fi
  if : >>"$LOG_FILE" 2>/dev/null; then
    LOG_READY=1
    own "$LOG_FILE"
    log_line ''
    log_line "######## install.sh ${ORIG_ARGS[*]:-} – $(date '+%Y-%m-%d %H:%M:%S %z') ########"
  fi
}

print_plan() {
  local created='' port_note=''
  (( ! CREATE_USER )) || created=' (will be created)'
  (( ! PORT_OVERRIDE )) || port_note=' (overrides the port in .env)'
  say ''
  say "  ${C_BOLD}LaughTime.lol – server setup${C_RESET}"
  say ''
  say "    Folder    $APP_DIR"
  case "$MANAGER" in
    systemd) say "    Service   systemd unit $SERVICE_NAME, user $SERVICE_USER$created" ;;
    pm2)     say "    Service   PM2 process \"$APP_NAME\", user $SERVICE_USER$created" ;;
    *)       say '    Service   none (--no-service)' ;;
  esac
  say "    Port      $PORT$port_note"
  if [[ "$MODE" == update ]]; then
    say '    Mode      update: pull, reinstall, rebuild, restart (the tunnel is not touched)'
  elif (( WANT_TUNNEL )); then
    say "    Tunnel    Cloudflare Tunnel \"$TUNNEL_NAME\" -> ${HOSTNAMES[*]}"
  else
    say '    Tunnel    none (--no-tunnel)'
  fi
  (( ! DRY_RUN )) || say "    ${C_CYAN}Dry run: every action is only printed, nothing is changed.${C_RESET}"
  say ''
}

main() {
  ORIG_ARGS=("$@")
  parse_args "$@"
  setup_colours
  [[ -f "$APP_DIR/index.js" && -f "$APP_DIR/package.json" ]] || { printf 'install.sh has to stay in the LaughTime project folder (index.js is missing next to it).\n' >&2; exit 1; }
  cd "$APP_DIR"
  trap 'on_err "$?" "$LINENO" "$BASH_COMMAND"' ERR
  trap on_exit EXIT
  trap on_signal INT TERM

  if (( ! ASSUME_YES )) && [[ -t 0 ]]; then INTERACTIVE=1; fi
  # the new installer after "git pull" already has the user's go-ahead
  [[ -z "${LT_INSTALL_REEXEC:-}" ]] || INTERACTIVE=0

  detect_os
  load_settings
  resolve_service_user
  resolve_manager

  if [[ "$MODE" == uninstall ]]; then
    start_log
    uninstall
    exit 0
  fi
  if [[ "$MODE" == update ]]; then WANT_TUNNEL=0; fi

  if (( INTERACTIVE && WANT_TUNNEL )) && [[ -z "$OPT_DOMAIN" ]]; then
    say ''
    while true; do
      DOMAIN=$(ask 'Domain of this instance (must be a zone in your Cloudflare account)' "$DOMAIN")
      DOMAIN=$(host_of_url "$DOMAIN")
      valid_hostname "$DOMAIN" && break
      note "\"$DOMAIN\" is not a valid domain."
      DOMAIN='laughtime.lol'
    done
    [[ -n "$OPT_BETA_DOMAIN" ]] || BETA_DOMAIN=''
    set_hostnames
  fi

  print_plan
  if (( ! ASSUME_YES )) && [[ ! -t 0 ]] && [[ -z "${LT_INSTALL_REEXEC:-}" ]]; then
    note 'No terminal for questions – continuing with the defaults (same as --yes).'
  fi
  if (( INTERACTIVE )) && ! confirm 'Start?' y; then
    say '  Nothing was changed.'
    exit 0
  fi

  STEP_TOTAL=6
  [[ "$MODE" != update ]] || STEP_TOTAL=$((STEP_TOTAL + 1))
  [[ "$MANAGER" == none ]] || STEP_TOTAL=$((STEP_TOTAL + 1))
  (( ! WANT_TUNNEL )) || STEP_TOTAL=$((STEP_TOTAL + 1))

  start_log
  step_system
  step_packages
  if [[ "$MODE" == update ]]; then step_update_source; fi
  step_node
  step_project
  step_app
  if [[ "$MANAGER" != none ]]; then step_service; fi

  if (( FORCE_PM2 )); then state_set manager pm2; fi
  if [[ -n "$OPT_USER" ]]; then state_set user "$SERVICE_USER"; fi
  if [[ -n "$OPT_PORT" ]]; then
    # only a port that differs from .env has to be remembered
    if (( PORT_OVERRIDE )); then state_set port "$PORT"; else state_set port ''; fi
  fi

  if (( WANT_TUNNEL )); then step_tunnel; fi
  step_summary
}

main "$@"; exit $?
