# Blog API — Parse Server + Express

## Run
```
cp .env.example .env     # set PARSE_MASTER_KEY, DATABASE_URI (MongoDB)
npm install && npm start # http://localhost:1337/parse, GET /parse/health
npm test                 # in-memory MongoDB (downloaded on first run)
```

## Done
All Must items R1–R8 and all Bonus items (12 tests in `test/api.test.js`).

Extras: `npm run lint`, `npm run seed` (server must be running), `docker compose up --build`.

## Choices
- Schema + CLPs in `src/schema.js`, applied by Parse Server at startup (`lockSchemas`, no client class creation).
- Triggers skip `request.master`, so server-side counter updates are not blocked.
- Counters use atomic `increment()`.
- A unique MongoDB index on `Like (post, user)` is created at startup; `toggleLike` retries on a lost race.

## With more time
Rate limiting; pagination for post lists; a CI workflow.
