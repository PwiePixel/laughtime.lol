'use client';

import dynamic from 'next/dynamic';

// The start page imports this file too, so it stays a stub: the activity
// (game views, start screen, Discord SDK helpers) and the page shown outside of
// Discord are their own chunks, and normal visitors download none of it.
const Loading = () => <div className="activity-shell" aria-busy="true" />;
const ActivityRoot = dynamic(() => import('./activity/ActivityRoot'), { loading: Loading });
const ActivityOutside = dynamic(() => import('./activity/ActivityOutside'));

/**
 * LaughTime as a Discord Activity (opened by Discord in a frame).
 *   outside  the page was opened without Discord's frame parameters – then it
 *            only explains where the activity lives
 */
export default function ActivityApp({ outside = false }) {
  return outside ? <ActivityOutside /> : <ActivityRoot />;
}
