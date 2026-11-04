import { Relay, validateRequest, reply } from './relay.mjs'

// SQLite-backed namespace for Free-plan compatibility only. No storage, SQL,
// alarms, identity, replay, event history, outbound fetch or logging calls.
export class SurfaceRoom {
  constructor() { this.relay = new Relay() }
  fetch(request) { return this.relay.fetch(request) }
}

export default {
  async fetch(request, env) {
    let room
    try { room = validateRequest(request) } catch (error) { return reply(error.status || 400, request) }
    if (request.method === 'OPTIONS') return reply(204, request, { 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,X-Surface' })
    try {
      // Every edge instance resolves the same room to one global coordinator.
      return await env.ROOMS.get(env.ROOMS.idFromName(room)).fetch(request)
    } catch { return reply(503, request) }
  },
}
