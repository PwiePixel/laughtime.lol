/**
 * GeoTime.lol – zusätzliche API-Routen (HOT-MODUL)
 *
 * Diese Datei kann über geotime/updates/<kanal>/api/routes.js zur Laufzeit
 * ersetzt werden. Alles unter /geotime-api/, was api.js nicht selbst kennt,
 * landet hier.
 */
const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
  return true;
};

export async function handle(req, res, url) {
  if (url.pathname === '/geotime-api/ping') return json(res, 200, { pong: true, at: Date.now() });
  return false;
}
