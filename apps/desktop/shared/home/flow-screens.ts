/**
 * Which full screen the first minute shows, as a pure machine: Welcome, Find, the map. The full-page Find is the FIRST scan only: it opens from Welcome and from nowhere
 * else. Once the map has been shown, "Find more" is a panel in the right column of the map (renderer/home/first-run/FindPanel.tsx), so no event from the map leads back to a
 * full page. Pure: a screen and an event go in, a screen comes out. An event that does not fit the screen leaves it as it is.
 *
 * Events: `find` (the button on Welcome), `leave` ("Not now" on the full-page Find), `done` (the full-page Find finished reading), `findMore` (the navigation's "Find more").
 */
export type Screen = 'welcome' | 'find' | 'map';
export type FlowEvent = 'find' | 'leave' | 'done' | 'findMore';

export function screenAfter(screen: Screen, event: FlowEvent): Screen {
  switch (screen) {
    case 'welcome': return event === 'find' ? 'find' : 'welcome';
    case 'find': return event === 'leave' ? 'welcome' : event === 'done' ? 'map' : 'find';
    case 'map': return 'map';
  }
}
