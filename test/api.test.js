const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');

const PORT = 1338;
const BASE = `http://localhost:${PORT}/parse`;
const MASTER_KEY = 'test-master-key';

let mongo;
let server;

before(async () => {
  mongo = await MongoMemoryServer.create();
  const { startServer } = require('../src/server');
  server = await startServer({ port: PORT, databaseURI: mongo.getUri(), masterKey: MASTER_KEY });
});

after(async () => {
  await server.parseServer.handleShutdown();
  await mongo.stop();
});

// --- REST helpers ----------------------------------------------------------

async function api(method, path, { body, token, master } = {}) {
  const headers = { 'X-Parse-Application-Id': 'blog-app', 'Content-Type': 'application/json' };
  if (token) headers['X-Parse-Session-Token'] = token;
  if (master) headers['X-Parse-Master-Key'] = MASTER_KEY;
  const res = await fetch(BASE + path, { method, headers, body: body && JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

let userCount = 0;
async function signUp() {
  const n = ++userCount;
  const { body } = await api('POST', '/users', {
    body: { username: `user${n}`, password: 'Password123!', email: `user${n}@example.com` },
  });
  return { id: body.objectId, token: body.sessionToken };
}

const createPost = (user, data = {}) =>
  api('POST', '/classes/Post', { token: user.token, body: { title: 'Hello', body: 'World', ...data } });

const getPost = async (id) => (await api('GET', `/classes/Post/${id}`)).body;

const comment = (user, postId, text = 'Nice') =>
  api('POST', '/classes/Comment', {
    token: user.token,
    body: { text, post: { __type: 'Pointer', className: 'Post', objectId: postId } },
  });

const toggleLike = (user, postId) =>
  api('POST', '/functions/toggleLike', { token: user.token, body: { postId } });

// --- tests -----------------------------------------------------------------

test('health check', async () => {
  const res = await fetch(`${BASE}/health`);
  assert.deepEqual(await res.json(), { status: 'ok' });
});

test('R2: post title and body are trimmed and validated', async () => {
  const alice = await signUp();

  const tooShort = await createPost(alice, { title: ' ab ' });
  assert.equal(tooShort.body.code, 142);
  const emptyBody = await createPost(alice, { body: '   ' });
  assert.equal(emptyBody.body.code, 142);
  const tooLong = await createPost(alice, { title: 'x'.repeat(121) });
  assert.equal(tooLong.body.code, 142);

  const ok = await createPost(alice, { title: '  Trimmed  ', body: '  text  ' });
  const post = await getPost(ok.body.objectId);
  assert.equal(post.title, 'Trimmed');
  assert.equal(post.body, 'text');
});

test('R3: on create the server sets author, counters and ACL', async () => {
  const alice = await signUp();
  const bob = await signUp();
  const res = await createPost(alice, {
    author: { __type: 'Pointer', className: '_User', objectId: bob.id },
    likesCount: 99,
    commentsCount: 99,
    ACL: { '*': { write: true } },
  });
  const post = await getPost(res.body.objectId);
  assert.equal(post.author.objectId, alice.id);
  assert.equal(post.likesCount, 0);
  assert.equal(post.commentsCount, 0);

  // Only the author can write.
  const edit = await api('PUT', `/classes/Post/${post.objectId}`, { token: bob.token, body: { title: 'Hacked' } });
  assert.equal(edit.body.code, 101);
});

test('R3: on update the client cannot change author or counters', async () => {
  const alice = await signUp();
  const bob = await signUp();
  const { body } = await createPost(alice);
  await api('PUT', `/classes/Post/${body.objectId}`, {
    token: alice.token,
    body: {
      title: 'Edited',
      author: { __type: 'Pointer', className: '_User', objectId: bob.id },
      likesCount: 50,
      commentsCount: 50,
    },
  });
  const post = await getPost(body.objectId);
  assert.equal(post.title, 'Edited');
  assert.equal(post.author.objectId, alice.id);
  assert.equal(post.likesCount, 0);
  assert.equal(post.commentsCount, 0);
});

test('R4 + R5: comments are validated and keep commentsCount up to date', async () => {
  const alice = await signUp();
  const bob = await signUp();
  const { body } = await createPost(alice);

  assert.equal((await comment(bob, body.objectId, '')).body.code, 142);
  assert.equal((await comment(bob, 'doesNotExist')).body.code, 101);

  const created = await comment(bob, body.objectId);
  assert.equal((await getPost(body.objectId)).commentsCount, 1);
  const saved = await api('GET', `/classes/Comment/${created.body.objectId}`);
  assert.equal(saved.body.author.objectId, bob.id);

  await api('DELETE', `/classes/Comment/${created.body.objectId}`, { token: bob.token });
  assert.equal((await getPost(body.objectId)).commentsCount, 0);
});

test('R6: deleting a post deletes its comments and likes', async () => {
  const alice = await signUp();
  const { body } = await createPost(alice);
  await comment(alice, body.objectId);
  await toggleLike(alice, body.objectId);

  await api('DELETE', `/classes/Post/${body.objectId}`, { token: alice.token });

  const where = encodeURIComponent(JSON.stringify({ post: { __type: 'Pointer', className: 'Post', objectId: body.objectId } }));
  for (const className of ['Comment', 'Like']) {
    const res = await api('GET', `/classes/${className}?where=${where}`);
    assert.equal(res.body.results.length, 0, `${className} should be deleted`);
  }
});

test('R7: toggleLike likes, unlikes and counts per user', async () => {
  const alice = await signUp();
  const bob = await signUp();
  const { body } = await createPost(alice);

  assert.deepEqual((await toggleLike(alice, body.objectId)).body.result, { liked: true, likesCount: 1 });
  assert.deepEqual((await toggleLike(bob, body.objectId)).body.result, { liked: true, likesCount: 2 });
  assert.deepEqual((await toggleLike(alice, body.objectId)).body.result, { liked: false, likesCount: 1 });
  assert.equal((await getPost(body.objectId)).likesCount, 1);
});

test('R7: toggleLike error contract', async () => {
  const alice = await signUp();
  const { body } = await createPost(alice);

  const anonymous = await api('POST', '/functions/toggleLike', { body: { postId: body.objectId } });
  assert.equal(anonymous.body.code, 142);
  assert.equal((await toggleLike(alice, undefined)).body.code, 142);
  assert.equal((await toggleLike(alice, 'doesNotExist')).body.code, 101);
});

test('R1: permissions — clients cannot create likes or classes, anonymous cannot post', async () => {
  const alice = await signUp();
  const { body } = await createPost(alice);

  const like = await api('POST', '/classes/Like', {
    token: alice.token,
    body: { post: { __type: 'Pointer', className: 'Post', objectId: body.objectId } },
  });
  assert.equal(like.body.code, 119);

  const newClass = await api('POST', '/classes/Secret', { token: alice.token, body: { a: 1 } });
  assert.equal(newClass.body.code, 119);

  const anonymous = await api('POST', '/classes/Post', { body: { title: 'Hello', body: 'World' } });
  assert.ok(anonymous.body.code === 119 || anonymous.body.code === 101);
});

test('users are public but their email is only visible to themselves', async () => {
  const alice = await signUp();
  const bob = await signUp();

  const seenByBob = await api('GET', `/users/${alice.id}`, { token: bob.token });
  assert.equal(seenByBob.body.username, 'user' + (userCount - 1));
  assert.equal(seenByBob.body.email, undefined);

  const seenByAlice = await api('GET', `/users/${alice.id}`, { token: alice.token });
  assert.ok(seenByAlice.body.email);
});

test('bonus: parallel toggleLike by the same user keeps one consistent state', async () => {
  const alice = await signUp();
  const { body } = await createPost(alice);

  await Promise.all(Array.from({ length: 6 }, () => toggleLike(alice, body.objectId)));

  const where = encodeURIComponent(JSON.stringify({ post: { __type: 'Pointer', className: 'Post', objectId: body.objectId } }));
  const likes = (await api('GET', `/classes/Like?where=${where}`)).body.results;
  assert.ok(likes.length <= 1);
  assert.equal((await getPost(body.objectId)).likesCount, likes.length);
});

test('bonus: userStats counts posts, comments and likes received', async () => {
  const alice = await signUp();
  const bob = await signUp();
  const { body } = await createPost(alice);
  await createPost(alice);
  await comment(alice, body.objectId);
  await toggleLike(bob, body.objectId);

  const stats = await api('POST', '/functions/userStats', { body: { userId: alice.id } });
  assert.deepEqual(stats.body.result, { posts: 2, comments: 1, likesReceived: 1 });
  assert.equal((await api('POST', '/functions/userStats', { body: { userId: 'nope' } })).body.code, 101);
});
