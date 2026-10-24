const MASTER = { useMasterKey: true };
const { VALIDATION_ERROR, OBJECT_NOT_FOUND } = Parse.Error;

// --- helpers ---------------------------------------------------------------

function invalid(message) {
  return new Parse.Error(VALIDATION_ERROR, message);
}

// Trims `field` and checks its length. Returns the trimmed value.
function cleanString(object, field, min, max) {
  const value = object.get(field);
  if (typeof value !== 'string') throw invalid(`${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw invalid(`${field} must be between ${min} and ${max} characters`);
  }
  object.set(field, trimmed);
}

function requireUser(request) {
  if (!request.user) throw invalid('Login required');
  return request.user;
}

// Public read, write only for `user`.
function authorACL(user) {
  const acl = new Parse.ACL();
  acl.setPublicReadAccess(true);
  acl.setWriteAccess(user, true);
  return acl;
}

// Puts back the original value of fields the client must not change.
function lockFields(request, fields) {
  for (const field of fields) {
    request.object.set(field, request.original.get(field));
  }
}

// --- Post ------------------------------------------------------------------

Parse.Cloud.beforeSave('Post', (request) => {
  if (request.master) return; // trusted server code (counters)
  const post = request.object;

  cleanString(post, 'title', 3, 120);
  cleanString(post, 'body', 1, 5000);

  if (post.isNew()) {
    const user = requireUser(request);
    post.set({ author: user, likesCount: 0, commentsCount: 0 });
    post.setACL(authorACL(user));
  } else {
    lockFields(request, ['author', 'likesCount', 'commentsCount']);
  }
});

Parse.Cloud.afterDelete('Post', async (request) => {
  for (const className of ['Comment', 'Like']) {
    const query = new Parse.Query(className).equalTo('post', request.object);
    await query.each((item) => item.destroy(MASTER), MASTER);
  }
});

// --- Comment ---------------------------------------------------------------

Parse.Cloud.beforeSave('Comment', async (request) => {
  if (request.master) return;
  const comment = request.object;

  cleanString(comment, 'text', 1, 500);

  if (comment.isNew()) {
    const user = requireUser(request);
    const post = comment.get('post');
    if (!post) throw invalid('post is required');
    await new Parse.Query('Post').get(post.id, MASTER);
    comment.set('author', user);
    comment.setACL(authorACL(user));
  } else {
    lockFields(request, ['post', 'author']);
  }
});

async function addToCommentsCount(comment, amount) {
  const post = comment.get('post');
  post.increment('commentsCount', amount);
  try {
    await post.save(null, MASTER);
  } catch (error) {
    if (error.code !== OBJECT_NOT_FOUND) throw error;
  }
}

Parse.Cloud.afterSave('Comment', async (request) => {
  if (request.object.existed()) return; // only count new comments
  await addToCommentsCount(request.object, 1);
});

Parse.Cloud.afterDelete('Comment', (request) => addToCommentsCount(request.object, -1));

// --- Likes -----------------------------------------------------------------

const DUPLICATE_VALUE = 137;

// Flips the like once. The unique index on Like (post, user) makes parallel
// calls safe: the loser of a race either hits a duplicate or finds the like
// already deleted, and does not touch the counter.
async function flipLike(post, user) {
  const existing = await new Parse.Query('Like').equalTo('post', post).equalTo('user', user).first(MASTER);

  if (existing) {
    try {
      await existing.destroy(MASTER);
    } catch (error) {
      if (error.code === OBJECT_NOT_FOUND) return flipLike(post, user); // someone else just unliked
      throw error;
    }
    post.increment('likesCount', -1);
    return false;
  }

  const like = new Parse.Object('Like', { post, user });
  const acl = new Parse.ACL();
  acl.setPublicReadAccess(true);
  like.setACL(acl);
  try {
    await like.save(null, MASTER);
  } catch (error) {
    if (error.code === DUPLICATE_VALUE) return flipLike(post, user); // someone else just liked
    throw error;
  }
  post.increment('likesCount', 1);
  return true;
}

Parse.Cloud.define(
  'toggleLike',
  async (request) => {
    const { postId } = request.params;
    if (typeof postId !== 'string' || !postId) throw invalid('postId is required');

    const post = await new Parse.Query('Post').get(postId, MASTER); // throws 101 if missing
    const liked = await flipLike(post, request.user);
    await post.save(null, MASTER);
    return { liked, likesCount: post.get('likesCount') };
  },
  { requireUser: true }
);

// --- Stats -----------------------------------------------------------------

Parse.Cloud.define('userStats', async (request) => {
  const { userId } = request.params;
  if (typeof userId !== 'string' || !userId) throw invalid('userId is required');

  const user = await new Parse.Query(Parse.User).get(userId, MASTER); // throws 101 if missing
  const posts = new Parse.Query('Post').equalTo('author', user);
  const [postCount, comments, likesReceived] = await Promise.all([
    posts.count(MASTER),
    new Parse.Query('Comment').equalTo('author', user).count(MASTER),
    new Parse.Query('Like').matchesQuery('post', posts).count(MASTER),
  ]);
  return { posts: postCount, comments, likesReceived };
});
