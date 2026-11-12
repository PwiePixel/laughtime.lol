import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { activityFramePolicy } from '../server/activity.js';

const savedDevFrame = process.env.ACTIVITY_DEV_FRAME;

afterEach(() => {
  if (savedDevFrame === undefined) delete process.env.ACTIVITY_DEV_FRAME;
  else process.env.ACTIVITY_DEV_FRAME = savedDevFrame;
});

const policy = (address) => {
  const url = new URL(address, 'https://laughtime.lol');
  return activityFramePolicy(url.pathname, url.searchParams);
};

const DISCORD = "frame-ancestors 'self' https://discord.com https://*.discord.com https://discordapp.com https://*.discordapp.com https://*.discordsays.com";

test('framing: only the activity may be shown in a frame by Discord', () => {
  delete process.env.ACTIVITY_DEV_FRAME;
  assert.equal(policy('/activity'), DISCORD);
  assert.equal(policy('/activity?frame_id=f&instance_id=i&platform=desktop'), DISCORD);
  assert.equal(policy('/?frame_id=f&instance_id=i&platform=mobile'), DISCORD);
});

test('framing: every other address with frame_id is locked', () => {
  delete process.env.ACTIVITY_DEV_FRAME;
  // next.config.mjs sends no X-Frame-Options when frame_id is present
  for (const address of ['/?frame_id=f', '/login?frame_id=f&instance_id=i', '/account?frame_id=1', '/admin?frame_id=f&instance_id=i', '/activityx?frame_id=f&instance_id=i']) {
    assert.equal(policy(address), "frame-ancestors 'self'", address);
  }
});

test('framing: normal pages keep the X-Frame-Options of next.config.mjs', () => {
  for (const address of ['/', '/login', '/memes?user=a', '/?instance_id=i']) assert.equal(policy(address), null, address);
});

test('framing: the local test harness is only added when it is a plain origin', () => {
  process.env.ACTIVITY_DEV_FRAME = 'http://localhost:3333';
  assert.equal(policy('/activity'), `${DISCORD} http://localhost:3333`);
  for (const bad of ['*', 'https://evil.example; script-src *', 'http://localhost:3333/path', "'unsafe-inline'", 'javascript:alert(1)']) {
    process.env.ACTIVITY_DEV_FRAME = bad;
    assert.equal(policy('/activity'), DISCORD, bad);
  }
});
