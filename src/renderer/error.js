(() => {
  const p = new URLSearchParams(location.search);
  const url = p.get('url') || '';
  const desc = (p.get('desc') || 'something went wrong').replace(/^net::/, '').replace(/_/g, ' ').toLowerCase();
  const code = p.get('code');
  document.getElementById('url').textContent = url;
  document.getElementById('desc').textContent = desc;
  document.getElementById('code').textContent = code ? `(${code})` : '';

  const hints = {
    '-105': "dns couldn't find that name. typo? or the site is napping.",
    '-106': "you're offline. check the wifi, the cat may have unplugged it.",
    '-102': 'the server refused the connection.',
    '-118': 'the server took too long to answer.',
    '-200': "the site's certificate looks sketchy. proceed with caution.",
    '-201': "the site's certificate dates are off. check your clock?",
    '-202': "the site's certificate isn't trusted.",
  };
  document.getElementById('hint').textContent = hints[code] || 'try again in a sec, or search for it instead.';

  document.getElementById('retry').onclick = (e) => {
    e.preventDefault();
    if (url) location.replace(url);
  };
  let host = url;
  try {
    host = new URL(url).hostname;
  } catch {}
  document.getElementById('search').href = 'https://logicmeow.co.uk/search.cat?q=' + encodeURIComponent(host);
})();
