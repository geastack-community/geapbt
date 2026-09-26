# geapbt

> Geastack Community is an independent community project and is not
> affiliated with or endorsed by Gea. Gea has granted permission for the
> project to use the 'Geastack Community' name and associated
> geastack-community domain and package namespace.

`@geastack-community/geapbt` is a property-based test helper for Gea mixins, components, and stores. It has no direct dependencies on Vitest or Jest; when called, it executes tests on the spot. Exceptions are propagated to the calling test runner.
`testStoreInvariants` and mixin lifecycle hooks are synchronous. Their asynchronous counterparts return Promises and should be awaited. Component invariants may also be asynchronous; `testComponentInvariants` waits for Gea's batched DOM updates before the next check.

## Install

```sh
pnpm add -D @geastack-community/geapbt
```

## Component invariants

Generate the component's props and action sequence, and verify the invariants for the initial state and after each action. 
If you are using the DOM, please run the test in a DOM environment, such as Vitest's `jsdom`.

```ts
import { expect, test } from 'vitest'
import { testComponentInvariants } from '@geastack-community/geapbt'
import Checkbox from './Checkbox'

test('Checkbox invariants', async () => {
  await testComponentInvariants(Checkbox, {
    props: {
      checked: 'boolean',
      indeterminate: 'boolean',
      disabled: 'boolean',
    },
    interactions: ['click', 'pressSpace'],
    invariants: (component) => {
      if (component.props.disabled) {
        expect(component.el?.getAttribute('aria-disabled')).toBe('true')
      }
    },
  })
})
```

Props can be defined as `‘boolean’`, `‘string’`, `‘number’`, `‘integer’`, a constant value, 
`Arbitrary` from `fast-check`, or a function that returns a value.
Each component is rendered after setting its generated props for each run, and is disposed of after validation.
Gea batches DOM updates after events, so this helper returns a Promise and must be awaited.
Invariant callbacks may also be async. `click` dispatches a click event on the root element,
and `pressSpace` dispatches keydown and keyup events for the Space key.

## Store invariants

Generate a random sequence of actions from the specified action, and verify the invariant after the initial state and after each action. If you use fast-check's `Arbitrary` for argument definitions, 
reproducibility based on the seed and shrinking will be enabled.

```ts
import { expect, test } from 'vitest'
import { testStoreInvariants } from '@geastack-community/geapbt'
import { integer } from 'fast-check'
import UserStore from './UserStore'

test('UserStore invariants', () => {
  testStoreInvariants(UserStore, {
    actions: {
      reset: [],
      clearError: [],
      setAge: [integer({ min: 0, max: 100 })],
    },
    invariants: (store) => {
      expect(store.age).toBeGreaterThanOrEqual(0)
    },
  })
})
```

You can also specify arguments in the form of `() => value`, as shown in the example. Since functions that call `Math.random()` directly are not controlled by the fast-check seed, we recommend using `Arbitrary` for reproducible tests.
The maximum length of the action sequence can be adjusted using `maxActions`.

## Asynchronous store invariants

Use `testStoreInvariantsAsync` when actions or invariants return Promises. Each
action, optional `flushSync()`, invariant check, and `dispose()` is awaited
before continuing, so randomized operations cannot race one another.

```ts
import { expect, test } from 'vitest'
import { integer } from 'fast-check'
import { testStoreInvariantsAsync } from '@geastack-community/geapbt'
import UserStore from './UserStore'

test('async UserStore invariants', async () => {
  await testStoreInvariantsAsync(UserStore, {
    actions: {
      refresh: [],
      setAge: [integer({ min: 0, max: 100 })],
    },
    runs: 200,
    invariants: async (store) => {
      await Promise.resolve()
      expect(store.age).toBeGreaterThanOrEqual(0)
    },
  })
})
```

Action arguments use the same `PropertyInput` values and fast-check arbitraries
as the synchronous helper. Rejected actions, invariant checks, and disposal
errors fail the property and are reported by fast-check.

## Mixin lifecycle

A mixin is composed sequentially using `Component` from `@geajs/core` as its base class, and during each run, it executes 
`created(props)` and `dispose()`. It does not perform DOM rendering or 
`onAfterRender()`. You can also specify any additional invariants.

```ts
import { expect, test } from 'vitest'
import { testMixinLifecycle } from '@geastack-community/geapbt'
import { withFoo, withSelectable } from './mixins'

test('mixin lifecycle', () => {
  testMixinLifecycle({
    mixins: [withFoo, withSelectable],
    runs: 200,
    invariants: (component) => {
      expect(component).toBeDefined()
    },
  })
})
```

## Reproducing failures

The default value for `runs` is `100`. If you specify `seed`, you can reproduce the failures reported by fast-check.
Component and store helpers pass on generation errors without modifying them.

```ts
testStoreInvariants(UserStore, {
  seed: 12345,
  runs: 200,
  actions: { reset: [] },
  invariants: (store) => {
    expect(store.age).toBeGreaterThanOrEqual(0)
  },
})
```
