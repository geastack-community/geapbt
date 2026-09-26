# Gea PBT demo

> Geastack Community is an independent community project and is not
> affiliated with or endorsed by Gea. Gea has granted permission for the
> project to use the 'Geastack Community' name and associated
> geastack-community domain and package namespace.

A small Gea app and test project demonstrating all three `geapbt` helpers against
real Gea stores, compiler-generated components, DOM interactions, and lifecycle
mixins.

## Run it

From the repository root, build the local `geapbt` package once, then install and
run this example:

```sh
npm run build
cd examples/pbt-demo
pnpm install --ignore-workspace --config.node-linker=hoisted
pnpm test
pnpm typecheck
pnpm build
pnpm dev
```

The app uses the same `@geajs/vite-plugin` and `jsxImportSource` setup as a
standard Gea app. Vitest runs tests in jsdom, so `testComponentInvariants`
renders the compiled Checkbox and sends actual click and keyboard events.
The test-only Vite config disables Gea's HMR virtual module while leaving the
normal app config unchanged.
The checkbox invariant checks the emitted ARIA contract and that enabled
controls receive every generated event; disabled controls must retain their
initial checked state.

## What's exercised

- `testStoreInvariants` tries randomized `reset`, `increment`, `decrement`, and
  bounded/unbounded `setCount` inputs across action sequences.
- `testComponentInvariants` generates checked/disabled props, renders the
  checkbox, performs click/Space interactions, waits for Gea's batched DOM
  updates, and checks the ARIA contract after each state transition.
- `testMixinLifecycle` composes two Gea `Component` mixins and checks both
  `created()` hooks through 100 runs.

Each property test pins a seed so failures can be replayed. Remove `seed` or
change it to explore other cases. fast-check reports the failing seed and
shrinking details when an invariant breaks.
