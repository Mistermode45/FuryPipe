# Graph Report - gfix  (2026-09-25)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 10 nodes · 17 edges · 3 communities (0 shown, 3 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- login-form.ts
- login.ts
- login

## God Nodes (most connected - your core abstractions)
1. `login()` - 6 edges
2. `renderButton()` - 3 edges
3. `submit()` - 3 edges
4. `createSession()` - 3 edges
5. `testLogin()` - 2 edges

## Surprising Connections (you probably didn't know these)
- `testLogin()` --calls--> `login()`  [EXTRACTED]
  tests/login.test.ts → src/auth/login.ts
- `submit()` --calls--> `login()`  [EXTRACTED]
  src/ui/login-form.ts → src/auth/login.ts
- `login()` --calls--> `createSession()`  [EXTRACTED]
  src/auth/login.ts → src/auth/session.ts
- `submit()` --calls--> `renderButton()`  [EXTRACTED]
  src/ui/login-form.ts → src/ui/button.ts

## Import Cycles
- None detected.

## Communities (3 total, 3 thin omitted)

## Knowledge Gaps
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `login()` connect `login` to `login-form.ts`, `login.ts`?**
  _High betweenness centrality (0.366) - this node is a cross-community bridge._
- **Why does `submit()` connect `login-form.ts` to `login`?**
  _High betweenness centrality (0.046) - this node is a cross-community bridge._
- **Why does `createSession()` connect `login.ts` to `login`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._