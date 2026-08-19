export function debounce(fn, delayMs) {
  let timer = null;
  let lastArgs = null;
  let hasCall = false;

  function debounced(...args) {
    lastArgs = args;
    hasCall = true;
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      hasCall = false;
      const captured = lastArgs;
      lastArgs = null;
      fn(...captured);
    }, delayMs);
  }

  debounced.cancel = function cancel() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    lastArgs = null;
    hasCall = false;
  };

  debounced.flush = function flush() {
    if (timer !== null && hasCall) {
      clearTimeout(timer);
      timer = null;
      const captured = lastArgs;
      lastArgs = null;
      hasCall = false;
      fn(...captured);
    }
  };

  return debounced;
}
