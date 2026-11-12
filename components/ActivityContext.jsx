'use client';

import { createContext, useContext } from 'react';

/**
 * Set while LaughTime runs as a Discord Activity:
 * { platform, invite(), close(), openExternal(url), onState(state), onRoomGone() }
 * null on the normal website.
 */
export const ActivityContext = createContext(null);

export const useActivity = () => useContext(ActivityContext);
