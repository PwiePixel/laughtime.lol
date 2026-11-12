'use client';

import dynamic from 'next/dynamic';
import ActivityBoot from './activity/ActivityBoot';
import ActivityOutside from './activity/ActivityOutside';

function Loading() {
  return (
    <div className="activity-shell">
      <ActivityBoot step="connect" />
    </div>
  );
}

// The activity (game views, Discord SDK helpers) is its own chunk: the start
// page imports this file too, and normal visitors must not download any of it.
const ActivityRoot = dynamic(() => import('./activity/ActivityRoot'), { loading: Loading });

/**
 * LaughTime as a Discord Activity (opened by Discord in a frame).
 *   outside  the page was opened without Discord's frame parameters – then it
 *            only explains where the activity lives
 */
export default function ActivityApp({ outside = false }) {
  return outside ? <ActivityOutside /> : <ActivityRoot />;
}
