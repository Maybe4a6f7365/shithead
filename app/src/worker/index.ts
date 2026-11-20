// ============================================================================
// Worker entry (wrangler.toml `main`): the HTTP front door, and the Durable
// Object class it hands each room's sockets to.
//
//   http.ts          routing, security headers, CORS, room-code allocation
//   room/Room.ts     the Durable Object: sockets, one serialized queue, dispatch
//   room/context.ts  a room's state, persistence, roles and views
//   room/*.ts        what the messages do: membership, lobby, gameplay, reactions
// ============================================================================
export { default } from './http'
export { Room } from './room/Room'
