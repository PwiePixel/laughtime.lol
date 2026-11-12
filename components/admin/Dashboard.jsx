'use client';

import dynamic from 'next/dynamic';

// The charts are the heaviest part of the admin area and only admins ever see
// them: they are fetched when the dashboard tab is actually shown.
const DashboardView = dynamic(() => import('./DashboardView'), {
  ssr: false,
  loading: () => <div className="spinner" aria-hidden="true" />,
});

export default function Dashboard() {
  return <DashboardView />;
}
