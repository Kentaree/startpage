document.getElementById('signout').addEventListener('click', function () {
  fetch('/auth/logout', { method: 'POST' }).finally(function () { location.assign('/login'); });
});
