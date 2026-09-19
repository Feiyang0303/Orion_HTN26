# Orion

Name a place. An AI crew plans your day on real streets, then a guide flies you
through it over the real city.

```bash
cp .env.example .env   # fill in keys; never commit .env
npm install
npm run dev            # vite (5173) + proxy (8787)
```

- `src/plan/` — planning + storybook (Person A)
- `src/fly/`  — tiles + flythrough (Person B)
- `src/types.ts` — the contract between them; one editor at a time
- `scripts/proxy.mjs` — holds the OpenAI / TTS / Routes keys
- `scripts/make-fixture.mjs` — outline for generating a real Plan JSON
