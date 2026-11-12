// Release channel of a request ("stable" or "beta") – main page and beta page
// are served by this one instance, see lib/features.js.
import { BETA_COOKIE, betaEnabledFromEnv, betaHostsFromEnv, resolveChannel } from '../lib/features.js';
import { parseCookies } from './http.js';

export const betaHosts = () => betaHostsFromEnv(process.env);
export const betaEnabled = () => betaEnabledFromEnv(process.env);

export function requestChannel(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  const optedIn = parseCookies(req.headers.cookie)[BETA_COOKIE] === '1';
  return resolveChannel({ host, optedIn, betaHosts: betaHosts(), enabled: betaEnabled() });
}
