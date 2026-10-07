"use strict";
(function () {
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const empty = () => ({
    version: "-1",
    id: "00000000-0000-0000-0000-000000000000",
  });
  const key = (id) => "bap-sync:" + id;
  const isMeta = (row) =>
    typeof row.id === "string" && row.id.startsWith("bap-sync:");
  const valid = (c) =>
    c &&
    typeof c.version === "string" &&
    /^(-1|\d{1,19})$/.test(c.version) &&
    BigInt(c.version) <= 9223372036854775807n &&
    uuid.test(c.id);
  async function cursor(db, store, userId) {
    return new Promise((resolve, reject) => {
      const r = db.transaction(store).objectStore(store).get(key(userId));
      r.onsuccess = () =>
        resolve(valid(r.result?.cursor) ? r.result.cursor : empty());
      r.onerror = () => reject(r.error);
    });
  }
  // Cursor y registros se guardan juntos: si falla la página, se vuelve a pedir.
  function commit(db, store, userId, rows, next) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite"),
        s = tx.objectStore(store);
      tx.oncomplete = resolve;
      tx.onabort = () =>
        reject(tx.error || Error("No se pudo guardar la página"));
      tx.onerror = () => {};
      try {
        for (const row of rows) s.put(row);
        s.put({ id: key(userId), cursor: next });
      } catch (error) {
        tx.abort();
        reject(error);
      }
    });
  }
  async function pull({ db, store, userId, cloud, kind, active, merge }) {
    let current = await cursor(db, store, userId),
      pages = 0;
    while (active()) {
      const { data, error } = await cloud.rpc("bap_pull_changes", {
        p_kind: kind,
        p_version: current.version,
        p_id: current.id,
        p_limit: kind === "expenses" ? 5 : 100,
      });
      if (error) throw error;
      if (!active()) return;
      if (
        !data ||
        !Array.isArray(data.rows) ||
        !valid(data.cursor) ||
        data.rows.some((r) => r.user_id !== userId || !uuid.test(r.id))
      )
        throw Error("Página de sincronización inválida");
      const next = data.cursor;
      const advanced =
        BigInt(next.version) > BigInt(current.version) ||
        (next.version === current.version && next.id > current.id);
      if (data.rows.length && !advanced) throw Error("El cursor no avanzó");
      if (data.rows.length)
        await commit(
          db,
          store,
          userId,
          data.rows.map(merge).filter(Boolean),
          next,
        );
      current = next;
      if (!data.more) return;
      if (!data.rows.length || ++pages > 50000)
        throw Error("Paginación inválida");
    }
  }
  function clearCursor(db, store, userId) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).delete(key(userId));
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
    });
  }
  window.BAP_SYNC = Object.freeze({
    isMeta,
    pull,
    commit,
    cursor,
    clearCursor,
  });
})();
