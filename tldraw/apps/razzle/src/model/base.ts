// Where this copy of the studio lives, and which build it is (docs/DEPLOY.md).
//
// BASE is the path the page is served under ('' at the root, '/private' behind the login), so
// server URLs work whatever prefix nginx mounts the app at.
//
// PUBLIC builds (VITE_RAZZLE_PUBLIC=1) talk to no server: decks are kept in the browser and
// exported as files; recording, notes, the agent and presenting are left out.
export const BASE = new URL('.', location.href).pathname.replace(/\/$/, '')

export const PUBLIC = import.meta.env.VITE_RAZZLE_PUBLIC === '1'
