(() => {
  const THEME_KEY = 'theme';

  const css = `
tool-shell { display: block; }
tool-shell nav {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 0.9rem;
  width: 100%;
  padding: 0.6rem 1.2rem;
  background: var(--bg-elev);
  border-bottom: 1px solid var(--border);
  font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans SC", sans-serif;
  color: var(--text);
}
tool-shell .brand {
  font-weight: 700;
  color: var(--accent);
  text-decoration: none;
  letter-spacing: -0.01em;
}
tool-shell .title { color: var(--muted); font-size: 0.92rem; }
tool-shell .spacer { flex: 1; }
tool-shell .user { color: var(--muted); font-size: 0.92rem; }
tool-shell a.signin {
  font: inherit;
  font-size: 0.92rem;
  padding: 0.35rem 0.8rem;
  border: 1px solid var(--border);
  border-radius: 9px;
  color: var(--accent);
  text-decoration: none;
}
tool-shell a.signin:hover { background: var(--bg-soft); }
tool-shell .forbid {
  font: inherit;
  font-size: 0.85rem;
  padding: 0.25rem 0.7rem;
  border: 1px solid var(--danger);
  border-radius: 999px;
  background: var(--danger-soft);
  color: var(--danger);
  cursor: default;
}
tool-shell button {
  font: inherit;
  padding: 0.35rem 0.8rem;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
}
tool-shell button:hover { background: var(--bg-soft); }
tool-shell button.theme { width: 2.1rem; padding: 0.35rem 0; }
`;

  function activeTheme() {
    return document.documentElement.dataset.theme
      || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }

  class ToolShell extends HTMLElement {
    async connectedCallback() {
      if (this.shadowRoot) return;
      const style = document.createElement('style');
      style.textContent = css;
      document.head.appendChild(style);

      this.innerHTML = `
        <nav>
          <a class="brand" href="/">Tools</a>
          <span class="title"></span>
          <span class="spacer"></span>
          <span class="forbid" hidden>Forbidden</span>
          <span class="user" hidden></span>
          <a class="signin" hidden>Sign in</a>
          <button class="logout" type="button" hidden>Sign out</button>
          <button class="theme" type="button" aria-label="Toggle color theme" title="Toggle color theme"></button>
        </nav>`;
      this.querySelector('.title').textContent = this.getAttribute('title') || '';

      const themeBtn = this.querySelector('button.theme');
      const paint = () => { themeBtn.textContent = activeTheme() === 'dark' ? '☀' : '☾'; };
      themeBtn.addEventListener('click', () => {
        document.documentElement.dataset.theme = activeTheme() === 'dark' ? 'light' : 'dark';
        localStorage.setItem(THEME_KEY, document.documentElement.dataset.theme);
        paint();
      });
      matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paint);
      paint();

      const sessionUrl = this.dataset.sessionUrl || '/api/auth/session';
      try {
        const res = await fetch(sessionUrl);
        if (res.status === 403) {
          this.querySelector('.forbid').hidden = false;
          return;
        }
        const data = res.status === 401 ? null : await res.json().catch(() => null);
        if (data && data.username) {
          const user = this.querySelector('.user');
          user.textContent = data.username;
          user.hidden = false;
          const out = this.querySelector('button.logout');
          out.hidden = false;
          out.addEventListener('click', async () => {
            out.disabled = true;
            await fetch(this.dataset.logoutUrl || '/api/auth/logout', {
              method: 'POST',
              headers: { 'X-Requested-With': 'XMLHttpRequest' },
            }).catch(() => {});
            this.loginRedirect();
          });
        } else {
          // guests are the mainstream on public pages: offer sign-in, never force a redirect
          const signin = this.querySelector('a.signin');
          signin.href = '/login?next=' + encodeURIComponent(location.pathname + location.search);
          signin.hidden = false;
        }
      } catch (e) {
        // network failure: keep the topbar functional, page content decides what to show
      }
    }

    loginRedirect() {
      location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search);
    }
  }

  customElements.define('tool-shell', ToolShell);
})();
