# Map files

Drop a `.json` here and load it with `?map=<name>` (for example
`http://localhost:5173/?map=example-arena`) or through "Load map JSON" in the
hangar. The format is documented in the project README under "Maps as JSON".

Both files list every rock explicitly with a stable `id`, which is the form a
server should hold. To author with clusters instead, write
`"rocks": { "generate": { ... } }`, load the file, and use "Save map as JSON"
to bake the expanded list back out.

- `starter-sector.json`: the built-in default, written out by the app.
- `example-arena.json`: a small hand-made arena; its iron ring was generated
  once and baked, the two centre rocks are hand-placed and never respawn.
