(() => {
  const setDirection = () => {
    const isHebrew = window.location.pathname === '/he' || window.location.pathname.startsWith('/he/');
    document.documentElement.dir = isHebrew ? 'rtl' : 'ltr';
    document.documentElement.lang = isHebrew ? 'he' : 'en';
  };

  setDirection();
  window.addEventListener('popstate', setDirection);
  window.addEventListener('hashchange', setDirection);

  const originalPushState = history.pushState;
  history.pushState = function (...args) {
    const result = originalPushState.apply(this, args);
    setDirection();
    return result;
  };

  const originalReplaceState = history.replaceState;
  history.replaceState = function (...args) {
    const result = originalReplaceState.apply(this, args);
    setDirection();
    return result;
  };
})();
