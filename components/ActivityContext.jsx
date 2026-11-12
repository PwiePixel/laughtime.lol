'use client';

import { createContext, useContext } from 'react';

/**
 * Set while LaughTime runs as a Discord Activity (see components/activity/ActivityRoot.jsx):
 *   platform          'desktop' | 'mobile'
 *   publicUrl         address of the website (for links that are shared)
 *   invite()          opens Discord's invite dialog, resolves to true when it could be opened
 *   close()           closes the activity
 *   openExternal(url) opens a link in the browser (Discord asks first)
 *   navigate(href)    opens a website path as a view of the activity, or in the browser
 *   onState(state)    the game reports its room state (banner, small tile, Rich Presence)
 *   onRoomGone()      the room expired – a new one is opened for this call
 * null on the normal website.
 */
export const ActivityContext = createContext(null);

export const useActivity = () => useContext(ActivityContext);
