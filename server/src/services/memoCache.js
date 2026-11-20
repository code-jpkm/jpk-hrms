/**
 * Tiny in-memory caches for things read on almost every request (who is
 * signed in, the attendance policy). The database may be a long way from the
 * server, and every trip there costs time; these let most requests skip a few.
 *
 * Values are stored as JSON text and turned back into a fresh Mongoose
 * document on every read, so one request can never change another's copy.
 *
 * watchWrites(schema, onWrite) clears the cache whenever that collection is
 * written through Mongoose, so new passwords, roles and settings apply at once.
 */
function createCache({ ttlMs, max = 2000 }) {
  const map = new Map();
  return {
    get(key) {
      const k = String(key);
      const hit = map.get(k);
      if (!hit) return undefined;
      if (Date.now() - hit.at > ttlMs) { map.delete(k); return undefined; }
      return hit.value;
    },
    set(key, value) {
      if (!(ttlMs > 0)) return;
      const k = String(key);
      map.delete(k);
      map.set(k, { value, at: Date.now() });
      if (map.size > max) map.delete(map.keys().next().value);
    },
    update(key, change) {
      const hit = map.get(String(key));
      if (hit) hit.value = change(hit.value);
    },
    delete(key) { map.delete(String(key)); },
    clear() { map.clear(); },
    get size() { return map.size; }
  };
}

const freeze = (doc) => JSON.stringify(doc && typeof doc.toObject === 'function' ? doc.toObject({ depopulate: true, virtuals: false, getters: false, transform: false }) : doc);
const thaw = (Model, text) => (text ? Model.hydrate(JSON.parse(text)) : null);

/** Ids a write touched, when the filter names them; null means "could be any". */
function idsInFilter(filter) {
  const id = filter && filter._id;
  if (id === undefined || id === null) return null;
  if (typeof id === 'string' || (typeof id === 'object' && typeof id.toHexString === 'function')) return [String(id)];
  if (typeof id === 'object' && Array.isArray(id.$in)) return id.$in.map(String);
  return null;
}

const QUERY_WRITES = ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete'];

/**
 * onWrite({ ids, update }) runs after every write. ids: the documents touched
 * (null when unknown → clear everything). update: the update object for query writes.
 */
function watchWrites(schema, onWrite) {
  schema.post('save', (doc) => onWrite({ ids: [String(doc._id)], update: null }));
  schema.post('deleteOne', { document: true, query: false }, (doc) => onWrite({ ids: [String(doc._id)], update: null }));
  schema.post(QUERY_WRITES, function afterQueryWrite(result) {
    const fromResult = result && result._id ? [String(result._id)] : null;
    onWrite({ ids: fromResult || idsInFilter(this.getFilter && this.getFilter()), update: this.getUpdate ? this.getUpdate() : null });
  });
  schema.post('insertMany', () => onWrite({ ids: null, update: null }));
}

module.exports = { createCache, freeze, thaw, watchWrites, idsInFilter };
