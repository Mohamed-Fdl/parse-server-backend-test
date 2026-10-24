const path = require('path');
const express = require('express');
const { ParseServer } = require('parse-server');
const { MongoClient } = require('mongodb');
const schema = require('./schema');

// Parse schemas cannot declare unique indexes, so create it directly in MongoDB:
// one Like per (post, user), even under parallel requests.
async function ensureLikeIndex(databaseURI) {
  const client = await MongoClient.connect(databaseURI);
  try {
    await client.db().collection('Like').createIndex({ _p_post: 1, _p_user: 1 }, { unique: true });
  } finally {
    await client.close();
  }
}

async function startServer({ port, databaseURI, masterKey }) {
  if (!masterKey) throw new Error('PARSE_MASTER_KEY is required');

  const parseServer = new ParseServer({
    appId: 'blog-app',
    masterKey,
    databaseURI,
    serverURL: `http://localhost:${port}/parse`,
    cloud: path.join(__dirname, '..', 'cloud', 'main.js'),
    schema,
    allowClientClassCreation: false,
    // users publicly readable (posts show their author)...
    enforcePrivateUsers: false,
    // users email is hidden from everybody except the user themself.
    protectedFields: { _User: { '*': ['email'] } },
  });
  await parseServer.start();
  await ensureLikeIndex(databaseURI);

  const app = express();
  app.use('/parse', parseServer.app);
  const httpServer = await new Promise((resolve) => {
    const s = app.listen(port, () => resolve(s));
  });
  parseServer.server = httpServer; // lets handleShutdown() close it
  return { httpServer, parseServer };
}

module.exports = { startServer };

if (require.main === module) {
  const port = Number(process.env.PORT) || 1337;
  startServer({
    port,
    databaseURI: process.env.DATABASE_URI || 'mongodb://localhost:27017/blog',
    masterKey: process.env.PARSE_MASTER_KEY,
  })
    .then(() => console.log(`Parse Server running on http://localhost:${port}/parse`))
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
