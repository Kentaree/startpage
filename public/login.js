(function () {
  var errorEl = document.getElementById('login-error');
  var messages = {
    account_exists: 'An account with this email already exists. Please sign in with your existing method (email and password) instead of Google.',
    google_unverified: 'Your Google account does not have a verified email address, so it cannot be used to sign in.',
    google_failed: 'Google sign-in failed. Please try again.',
    google_unavailable: 'Google sign-in is not available right now.'
  };
  function show(msg) { errorEl.textContent = msg; errorEl.hidden = false; }

  var code = new URLSearchParams(location.search).get('error');
  if (code) show(messages[code] || 'Sign-in failed. Please try again.');

  function wire(id) {
    var form = document.getElementById(id);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      errorEl.hidden = true;
      fetch(form.action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email.value, password: form.password.value })
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (r.ok) location.assign('/');
          else show(j.error || 'Something went wrong. Please try again.');
        });
      }).catch(function () { show('Network error. Please try again.'); });
    });
  }
  wire('signin-form');
  wire('signup-form');
})();
