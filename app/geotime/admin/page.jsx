import AdminPanel from '@/components/geotime/AdminPanel';

/**
 * Betriebsansicht von GeoTime – Instanzen, Ports und Hot-Updates.
 *
 * Bewusst NICHT im Admin-Bereich von LaughTime: die beiden Projekte bleiben
 * getrennt. Ohne den Token aus GEOTIME_ADMIN_TOKEN zeigt die Seite nichts,
 * und die API gibt ohne Token auch nichts heraus.
 */
export const metadata = {
  title: { absolute: 'GeoTime – Betrieb' },
  robots: { index: false, follow: false, nocache: true },
};

export default function GeotimeAdminPage() {
  return <AdminPanel />;
}
