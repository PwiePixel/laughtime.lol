/**
 * Trennung von LaughTime und GeoTime im gemeinsamen Next.js-Build.
 * (In Next 16 heißt die frühere "middleware" jetzt "proxy".)
 *
 * Die GeoTime-Seiten liegen unter /geotime, sind aber NUR über die
 * GeoTime-Ports erreichbar: die Instanz setzt den Header x-geotime-instance.
 * Ohne diesen Header gibt es 404 – auf laughtime.lol existiert GeoTime also nicht.
 */
import { NextResponse } from 'next/server';

export default function proxy(request) {
  if (!request.headers.get('x-geotime-instance')) {
    return new NextResponse(null, { status: 404 });
  }
  return NextResponse.next();
}

export const config = {
  // beide Schreibweisen abdecken, damit hier nie etwas durchrutscht
  matcher: ['/geotime', '/geotime/', '/geotime/:path*'],
};
