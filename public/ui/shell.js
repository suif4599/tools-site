(() => {
  const THEME_KEY = 'theme';

  function activeTheme() {
    return document.documentElement.dataset.theme || 'dark';
  }

  class ToolShell extends HTMLElement {
    async connectedCallback() {
      if (this.shadowRoot) return;

      this.innerHTML = `
        <nav>
          <a class="brand" href="/">Tools</a>
          <span class="title"></span>
          <span class="spacer"></span>
          <span class="forbid" hidden>ACCESS DENIED</span>
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
