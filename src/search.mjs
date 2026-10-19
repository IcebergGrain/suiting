export function searchText(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, ' ').trim();
}

export function matchesSearch(fields, query) {
  const terms = searchText(query).split(' ').filter(Boolean);
  const haystack = searchText(fields.filter(value => value != null).join(' '));
  return terms.every(term => haystack.includes(term));
}

export function createSearchInput({ update, render, delay = 100, schedule = setTimeout, cancel = clearTimeout }) {
  let composing = false;
  let timer = null;
  function flush() {
    if (timer !== null) cancel(timer);
    timer = null;
    if (!composing) render();
  }
  return {
    get composing() { return composing; },
    get pending() { return timer !== null; },
    start() { composing = true; if (timer !== null) cancel(timer); timer = null; },
    input(value, isComposing = false) {
      update(value);
      if (timer !== null) cancel(timer);
      if (composing || isComposing) return;
      timer = schedule(flush, delay);
    },
    end(value) { composing = false; update(value); flush(); },
    flush,
  };
}
