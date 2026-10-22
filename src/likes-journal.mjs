const validId = value => /^[1-9]\d{0,17}$/.test(String(value));
const clone = value => JSON.parse(JSON.stringify(value));

export function emptyLikes(accountId) {
  if (!validId(accountId)) throw new Error('请先连接网易云账号。');
  return { accountId: String(accountId), remoteIds: [], remoteKnown: false, checkedAt: 0, addedIds: [], records: [] };
}

export function effectiveLike(journal, id) {
  const record = journal?.records?.find(item => item.id === String(id) && item.pending);
  return record ? record.liked : Boolean(journal?.remoteIds?.includes(String(id)));
}

export function stageLike(journal, song, liked, now = Date.now()) {
  if (!validId(song?.id) || typeof liked !== 'boolean') throw new Error('歌曲或喜欢状态无效。');
  const next = clone(journal);
  const previous = next.records.find(item => item.id === String(song.id));
  if (!previous && next.records.length >= 10000) throw new Error('喜欢记录已满，请先同步后再试。');
  const record = { id: String(song.id), title: String(song.title || '未知歌曲').slice(0, 300), artist: String(song.artist || '').slice(0, 300), liked, changedAt: now, revision: (previous?.revision || 0) + 1, pending: next.remoteKnown ? Boolean(previous?.pending) || next.remoteIds.includes(String(song.id)) !== liked : liked };
  next.records = next.records.filter(item => item.id !== record.id && (item.pending || now - item.changedAt < 30 * 86400000));
  next.records.push(record);
  return next;
}

export function observeLikes(journal, ids, now = Date.now()) {
  if (!Array.isArray(ids) || ids.length > 100000 || ids.some(id => !validId(id))) throw new Error('网易云喜欢列表不完整或格式错误，未覆盖本机记录。');
  const next = clone(journal);
  const remote = new Set(ids.map(String));
  const previous = new Set(next.remoteIds);
  next.addedIds = next.remoteKnown ? [...remote].filter(id => !previous.has(id)) : [];
  next.comparisonFrom = next.checkedAt;
  next.remoteIds = [...remote]; next.remoteKnown = true; next.checkedAt = now;
  next.records = next.records.map(record => ({ ...record, pending: record.pending && record.liked !== remote.has(record.id) }));
  return next;
}

export function likesReport(journal, now = Date.now()) {
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const records = (journal?.records || []).filter(record => record.changedAt >= today.getTime());
  const remote = new Set(journal?.remoteIds);
  const mismatches = journal?.remoteKnown ? records.filter(record => remote.has(record.id) !== record.liked) : [];
  return { today: records.length, pending: (journal?.records || []).filter(record => record.pending).length, matched: journal?.remoteKnown ? records.length - mismatches.length : 0, mismatches };
}

export function createLikeStore({ storage, key = 'suiting.public.likes.v1', request } = {}) {
  const read = accountId => {
    const saved = storage.getItem(key);
    const accounts = saved ? JSON.parse(saved) : {};
    return { accounts, journal: accounts[accountId] || emptyLikes(accountId) };
  };
  const change = (accountId, transform) => {
    const { accounts, journal } = read(accountId);
    const next = transform(journal);
    storage.setItem(key, JSON.stringify({ ...accounts, [accountId]: next }));
    return next;
  };
  return {
    get: async accountId => request ? request('local_likes_status', { accountId }) : clone(read(accountId).journal),
    stage: async (accountId, song, liked) => request ? request('local_likes_set', { accountId, song, liked }) : change(accountId, journal => stageLike(journal, song, liked)),
    observe: async (accountId, ids) => request ? request('local_likes_observe', { accountId, ids }) : change(accountId, journal => observeLikes(journal, ids)),
  };
}

export function createLikesController({ store, api, account }) {
  let syncing = false;
  const requireAccount = expected => {
    const current = String(account() || '');
    if (!validId(current) || expected && current !== expected) throw new Error('网易云账号已变化，请重新打开喜欢同步。');
    return current;
  };
  const check = async (expected = requireAccount()) => {
    requireAccount(expected);
    const result = await api('/api/likes');
    requireAccount(expected);
    if (String(result.accountId) !== expected) throw new Error('喜欢列表账号不一致，未覆盖本机记录。');
    return store.observe(expected, result.ids);
  };
  return {
    local: () => store.get(requireAccount()),
    stage: (song, liked) => store.stage(requireAccount(), song, liked),
    check: () => check(),
    async sync() {
      if (syncing) throw new Error('正在同步喜欢，请等待本次完成。');
      syncing = true;
      const failures = [];
      try {
        const accountId = requireAccount();
        const initial = await check(accountId);
        const batch = initial.records.filter(record => record.pending).slice(0, 100);
        for (const record of batch) {
          requireAccount(accountId);
          const current = await store.get(accountId);
          requireAccount(accountId);
          const latest = current.records.find(item => item.id === record.id);
          if (!latest?.pending || latest.revision !== record.revision) continue;
          try {
            const result = await api('/api/like', { method: 'POST', body: JSON.stringify({ accountId, id: record.id, liked: record.liked }) });
            requireAccount(accountId);
            if (String(result.accountId) !== accountId || result.liked !== record.liked || result.verified !== true) throw new Error('网易云未确认写入结果');
          } catch (error) {
            requireAccount(accountId);
            failures.push({ id: record.id, message: error.message });
            break;
          }
        }
        const journal = await check(accountId);
        return { journal, failures };
      } finally { syncing = false; }
    },
  };
}
