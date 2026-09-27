/**
 * Landing page behaviour, shared by the site's other pages (the guides and
 * the rest), configured by the instance's config.json. No framework, no
 * inline scripts: the server sends a CSP that forbids them.
 */
(() => {
  const DEFAULT_REPO = 'https://github.com/medhatdawoud/appreciate-button';

  /**
   * The instance the site's pages show in their snippets. Served by another
   * instance, they show that one instead (see `fillInstanceSnippets`).
   */
  const CANONICAL_INSTANCE = 'https://appreciate-button.com';

  // config.json sits next to this script at the site root, however deep the
  // page is. Read now: document.currentScript is only set while it first runs.
  const CONFIG_URL = new URL('config.json', document.currentScript?.src ?? location.href);

  function trimSlash(url) {
    return url.replace(/\/+$/, '');
  }

  function setLinks(config) {
    const repo = config.repoUrl || DEFAULT_REPO;
    for (const link of document.querySelectorAll('[data-repo-link]')) link.href = repo;
    for (const link of document.querySelectorAll('[data-selfhost-link]'))
      link.href = `${repo}#hosting-guide`;
    for (const link of document.querySelectorAll('[data-readme-link]'))
      link.href = `${repo}#readme`;

    const leaderboard = document.querySelector('[data-leaderboard-link]');
    if (leaderboard && config.leaderboardEnabled === false) leaderboard.hidden = true;

    const signIn = document.querySelector('[data-signin-link]');
    if (signIn && config.signInEnabled && config.apiUrl) {
      signIn.href = `${trimSlash(config.apiUrl)}/dashboard`;
      signIn.hidden = false;
    }
  }

  function showSignInError() {
    if (new URLSearchParams(location.search).get('error') !== 'not_allowed') return;
    const notice = document.querySelector('[data-error-notice]');
    if (notice) notice.hidden = false;
  }

  function fillSnippet(config) {
    const snippet = document.querySelector('[data-snippet]');
    if (!snippet || !config.apiUrl) return;
    const key = config.demoKey || 'pk_…';
    snippet.textContent = `<script src="${trimSlash(config.apiUrl)}/widget.js" data-key="${key}" async></script>`;
  }

  /**
   * The guides' snippets name the canonical instance; served by another one,
   * they name that one, so what is copied works where it was copied from.
   */
  function fillInstanceSnippets(config) {
    if (!config.apiUrl) return;
    const api = trimSlash(config.apiUrl);
    if (api === CANONICAL_INSTANCE) return;
    for (const snippet of document.querySelectorAll('[data-instance-snippet]')) {
      snippet.textContent = snippet.textContent.split(CANONICAL_INSTANCE).join(api);
    }
  }

  /**
   * The agent prompt for this instance. It knows no button here, so it asks
   * the owner for the key along with the rest.
   */
  function fillAgentPrompt(config) {
    const target = document.querySelector('[data-agent-prompt]');
    if (!target || typeof window.appreciateButtonAgentPrompt !== 'function') return;
    target.textContent = window.appreciateButtonAgentPrompt({
      apiUrl: trimSlash(config.apiUrl || 'https://your-instance.example'),
    });
  }

  function wireCopyButtons() {
    for (const button of document.querySelectorAll('[data-copy]')) {
      button.addEventListener('click', async () => {
        const target = document.querySelector(button.dataset.copy);
        if (!target) return;
        try {
          await navigator.clipboard.writeText(target.textContent);
          button.textContent = 'Copied';
        } catch {
          button.textContent = 'Select and copy';
        }
        setTimeout(() => {
          button.textContent = 'Copy';
        }, 1500);
      });
    }
  }

  function mountDemos(config) {
    const demo = document.querySelector('[data-demo]');
    const missing = document.querySelector('[data-demo-missing]');
    const variants = document.querySelector('[data-variants]');
    const multi = document.querySelector('[data-multi]');

    if (!config.apiUrl || !config.demoKey) {
      if (demo) demo.hidden = true;
      if (missing) missing.hidden = false;
      if (variants) variants.hidden = true;
      const positions = document.querySelector('[data-positions]');
      if (positions) positions.hidden = true;
      const readonly = document.querySelector('[data-readonly-demo]');
      if (readonly) readonly.hidden = true;
      if (multi) multi.hidden = true;
      return;
    }

    const api = trimSlash(config.apiUrl);
    for (const slot of document.querySelectorAll('[data-demo-slot]')) {
      const element = document.createElement('appreciate-button');
      element.dataset.api = api;
      element.dataset.key = config.demoKey;
      element.dataset.item = slot.dataset.item || `landing-${slot.dataset.demoSlot}`;
      if (slot.dataset.label) element.dataset.label = slot.dataset.label;
      if (slot.dataset.count) element.dataset.count = slot.dataset.count;
      if (slot.dataset.readonly !== undefined) element.dataset.readonly = '';
      slot.replaceChildren(element);
    }

    // The read-only demo shows the hero's counter; it re-reads it whenever a
    // click on the hero settles, so it follows along.
    const hero = document.querySelector('[data-demo-slot="hero"]');
    const mirror = document.querySelector('[data-demo-slot="readonly"] appreciate-button');
    if (hero && mirror) {
      hero.addEventListener('appreciate:change', () => {
        mirror.refresh?.();
      });
    }

    const script = document.createElement('script');
    script.src = `${api}/widget.js`;
    script.async = true;
    document.head.append(script);
  }

  /**
   * "Reset my votes": offered only once the visitor has used up the hero
   * demo. It asks the instance to forget this visitor's clicks on the demo
   * button (it refuses on any other button), then has every demo widget on the
   * page re-read its counts, which hides the offer again.
   */
  function wireReset(config) {
    const button = document.querySelector('[data-reset]');
    const status = document.querySelector('[data-reset-status]');
    if (!button || !status || !config.apiUrl || !config.demoKey) return;

    // The widget's events bubble out of its shadow root with the counts.
    const hero = document.querySelector('[data-demo-slot="hero"]');
    const follow = (event) => {
      if (!hero || !hero.contains(event.target) || !event.detail) return;
      button.toggleAttribute('data-offered', event.detail.maxed === true);
    };
    for (const name of ['appreciate:ready', 'appreciate:change']) {
      document.addEventListener(name, follow);
    }

    const showError = (message) => {
      status.textContent = message;
      status.classList.add('error');
      status.hidden = false;
    };

    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const response = await fetch(
          `${trimSlash(config.apiUrl)}/v1/buttons/${encodeURIComponent(config.demoKey)}/reset`,
          { method: 'POST', mode: 'cors', credentials: 'omit' },
        );
        if (!response.ok) throw new Error(`status ${response.status}`);
        await Promise.all(
          Array.from(document.querySelectorAll('appreciate-button'), (element) =>
            typeof element.refresh === 'function' ? element.refresh() : undefined,
          ),
        );
        status.hidden = true;
        button.removeAttribute('data-offered');
      } catch {
        showError('Could not reset right now. Try again in a moment.');
      } finally {
        button.disabled = false;
      }
    });
  }

  async function loadConfig() {
    try {
      const response = await fetch(CONFIG_URL, { cache: 'no-store' });
      if (!response.ok) return {};
      return await response.json();
    } catch {
      return {};
    }
  }

  /**
   * The live log in "Listen to it": the events the hero demo sends, newest
   * first, the way a page's own listener would see them.
   */
  function wireEventLog() {
    const log = document.querySelector('[data-event-log]');
    const hero = document.querySelector('[data-demo-slot="hero"]');
    if (!log || !hero) return;
    const names = [
      'appreciate:ready',
      'appreciate:burst',
      'appreciate:change',
      'appreciate:maxed',
      'appreciate:error',
    ];
    for (const name of names) {
      document.addEventListener(name, (event) => {
        if (!hero.contains(event.target)) return;
        const detail = event.detail ?? {};
        const entry = document.createElement('li');
        const label = document.createElement('code');
        label.textContent = name;
        const data =
          name === 'appreciate:error'
            ? ` ${detail.code}`
            : ` total ${detail.totalCount}, ${detail.visitorRemaining} left`;
        entry.append(label, data);
        log.prepend(entry);
        while (log.children.length > 8) log.lastElementChild.remove();
      });
    }
  }

  async function main() {
    const config = await loadConfig();
    setLinks(config);
    showSignInError();
    fillSnippet(config);
    fillInstanceSnippets(config);
    fillAgentPrompt(config);
    wireCopyButtons();
    // Before the demos, so the hero's first ready is in the log.
    wireEventLog();
    mountDemos(config);
    wireReset(config);
  }

  main();
})();
