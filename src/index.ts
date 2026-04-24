import { Elysia, t } from 'elysia';
import { cors } from '@elysiajs/cors';

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type JsonObject = { [key: string]: JsonValue };

const ROOM = 'shared-doc';

const state: { data: JsonObject; version: number; updatedAt: number } = {
  data: {},
  version: 0,
  updatedAt: Date.now(),
};

function setByPath(obj: JsonObject, path: string[], value: JsonValue): void {
  if (path.length === 0) return;
  let cursor: JsonObject = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]!;
    const next = cursor[key];
    if (next === undefined || next === null || typeof next !== 'object' || Array.isArray(next)) {
      cursor[key] = {};
    }
    cursor = cursor[key] as JsonObject;
  }
  cursor[path[path.length - 1]!] = value;
}

function deleteByPath(obj: JsonObject, path: string[]): void {
  if (path.length === 0) return;
  let cursor: JsonObject = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]!;
    const next = cursor[key];
    if (next === undefined || next === null || typeof next !== 'object' || Array.isArray(next)) {
      return;
    }
    cursor = next as JsonObject;
  }
  delete cursor[path[path.length - 1]!];
}

function deepMerge(target: JsonObject, patch: JsonObject): JsonObject {
  for (const key of Object.keys(patch)) {
    const pv = patch[key];
    const tv = target[key];
    if (
      pv &&
      typeof pv === 'object' &&
      !Array.isArray(pv) &&
      tv &&
      typeof tv === 'object' &&
      !Array.isArray(tv)
    ) {
      target[key] = deepMerge({ ...(tv as JsonObject) }, pv as JsonObject);
    } else {
      target[key] = pv as JsonValue;
    }
  }
  return target;
}

const messageSchema = t.Union([
  t.Object({ type: t.Literal('set'), path: t.Array(t.String()), value: t.Any() }),
  t.Object({ type: t.Literal('delete'), path: t.Array(t.String()) }),
  t.Object({ type: t.Literal('merge'), patch: t.Record(t.String(), t.Any()) }),
  t.Object({ type: t.Literal('replace'), data: t.Record(t.String(), t.Any()) }),
  t.Object({ type: t.Literal('sync') }),
]);

const app = new Elysia()
  .use(cors())
  .get('/', () => ({ ok: true, service: 'elysia-ws', version: state.version }))
  .get('/state', () => state)
  .ws('/ws', {
    body: messageSchema,
    open(ws) {
      ws.subscribe(ROOM);
      ws.send({ type: 'snapshot', version: state.version, data: state.data });
    },
    close(ws) {
      ws.unsubscribe(ROOM);
    },
    message(ws, msg) {
      switch (msg.type) {
        case 'set':
          setByPath(state.data, msg.path, msg.value as JsonValue);
          break;
        case 'delete':
          deleteByPath(state.data, msg.path);
          break;
        case 'merge':
          deepMerge(state.data, msg.patch as JsonObject);
          break;
        case 'replace':
          state.data = msg.data as JsonObject;
          break;
        case 'sync':
          ws.send({ type: 'snapshot', version: state.version, data: state.data });
          return;
      }

      state.version += 1;
      state.updatedAt = Date.now();

      const payload = {
        type: 'update' as const,
        version: state.version,
        op: msg,
        data: state.data,
      };

      ws.send(payload);
      ws.publish(ROOM, payload);
    },
  })
  .listen(3001);

console.log(`WebSocket server running at http://${app.server?.hostname}:${app.server?.port}`);
console.log(`WS endpoint: ws://${app.server?.hostname}:${app.server?.port}/ws`);
