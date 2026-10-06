# 3. Development Modes

`npm run dev` runs installed Vite through Node and `shopify theme dev` in the current directory. Arguments are forwarded to Vite: `npm run dev -- --host 0.0.0.0`.

The command preserves `SHOPIFY_FLAG_PATH`, forwards termination signals, stops the sibling process when either exits, and propagates failures. On Windows, a shell is used only for the Shopify shim.

Set `devOrigin` to an HTTPS origin when a tunnel is managed elsewhere. During development the snippet contains HMR and reload clients; the previous snippet is restored at shutdown. A live or uncertain lock fails safely.

Shopify CLI flags can be supplied through its documented environment variables. In particular, an existing `SHOPIFY_FLAG_PATH` is passed through unchanged, which is useful when the command runs from a workspace root. Positional arguments after `dev` belong to Vite; they are not forwarded to Shopify CLI.

The command exits when either child exits and terminates the sibling. Spawn errors and non-zero exits produce a failing command. `SIGINT` and `SIGTERM` are forwarded so the plugin can restore the exact pre-development snippet before the processes finish.
