// Fills a running server with demo data: node --env-file=.env scripts/seed.js
const BASE = `http://localhost:${process.env.PORT || 1337}/parse`;

async function api(method, path, body, token) {
  const headers = { 'X-Parse-Application-Id': 'blog-app', 'Content-Type': 'application/json' };
  if (token) headers['X-Parse-Session-Token'] = token;
  const res = await fetch(BASE + path, { method, headers, body: body && JSON.stringify(body) });
  const json = await res.json();
  if (json.error) throw new Error(`${method} ${path}: ${json.error}`);
  return json;
}

async function signUpOrLogIn(username) {
  const credentials = { username, password: 'Password123!', email: `${username}@example.com` };
  try {
    return await api('POST', '/users', credentials);
  } catch {
    return api('GET', `/login?username=${username}&password=${credentials.password}`);
  }
}

async function main() {
  const [alice, bob, carol] = await Promise.all(['alice', 'bob', 'carol'].map(signUpOrLogIn));

  for (const [author, title] of [[alice, 'Hello world'], [bob, 'Parse Server tips'], [carol, 'Cloud Code notes']]) {
    const post = await api('POST', '/classes/Post', { title, body: `Body of "${title}"` }, author.sessionToken);
    for (const reader of [alice, bob, carol]) {
      if (reader === author) continue;
      await api('POST', '/classes/Comment', {
        text: 'Nice post!',
        post: { __type: 'Pointer', className: 'Post', objectId: post.objectId },
      }, reader.sessionToken);
      await api('POST', '/functions/toggleLike', { postId: post.objectId }, reader.sessionToken);
    }
  }
  console.log('Seeded users alice, bob, carol (password: Password123!) with 3 posts.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
