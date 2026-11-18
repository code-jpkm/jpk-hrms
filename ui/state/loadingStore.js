const active = new Set();
const listeners = new Set();

function emit() {
  listeners.forEach((listener) => listener());
}

export function startLoading(id) {
  active.add(id);
  emit();
}

export function endLoading(id) {
  active.delete(id);
  emit();
}

export function subscribeLoading(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getLoadingSnapshot() {
  return active.size;
}
