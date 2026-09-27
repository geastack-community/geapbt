import { expect, it } from 'vitest'
import { boolean, integer } from 'fast-check'
import {
  testComponentInvariants,
  testMixinLifecycle,
  testStoreInvariants,
  testStoreInvariantsAsync,
} from '@geastack-community/geapbt'
import Checkbox from '../src/checkbox'
import { withFoo, withSelectable } from '../src/mixins'
import { CounterStore } from '../src/counter-store'
import { AsyncCounterStore } from '../src/async-counter-store'

it('keeps the counter non-negative through randomized action sequences', () => {
  testStoreInvariants(CounterStore, {
    actions: {
      reset: [],
      increment: [],
      decrement: [],
      setCount: [integer({ min: -500, max: 500 })],
    },
    runs: 250,
    seed: 20260926,
    invariants: (store) => {
      expect(store.count).toBeGreaterThanOrEqual(0)
    },
  })
})

it('awaits asynchronous store actions before checking invariants', async () => {
  await testStoreInvariantsAsync(AsyncCounterStore, {
    actions: {
      reset: [],
      increment: [],
      setCount: [integer({ min: -500, max: 500 })],
    },
    runs: 100,
    seed: 20260927,
    invariants: async (store) => {
      await Promise.resolve()
      expect(store.count).toBeGreaterThanOrEqual(0)
    },
  })
})

it('keeps checkbox ARIA state consistent through randomized interactions', async () => {
  const previousAttempts = new WeakMap<object, number>()

  await testComponentInvariants(Checkbox, {
    props: {
      checked: 'boolean',
      disabled: 'boolean',
    },
    interactions: [
      'click',
      'pressSpace',
      { setChecked: [boolean()] },
    ],
    runs: 100,
    seed: 42,
    invariants: (component) => {
      expect(component.el?.getAttribute('role')).toBe('checkbox')
      expect(component.el?.getAttribute('aria-checked')).toBe(String(component.checked))
      expect(component.el?.getAttribute('aria-disabled')).toBe(
        String(component.props.disabled),
      )
      expect(['true', 'false']).toContain(component.el?.getAttribute('aria-checked'))
      expect(typeof component.checked).toBe('boolean')
      if (component.props.disabled) {
        expect(component.checked).toBe(component.initialChecked)
      }

      const previous = previousAttempts.get(component)
      if (previous !== undefined && !component.props.disabled) {
        expect(component.interactionAttempts).toBeGreaterThan(previous)
      }
      previousAttempts.set(component, component.interactionAttempts)
    },
  })
})

it('composes mixins while preserving their lifecycle hooks', () => {
  testMixinLifecycle({
    mixins: [withFoo, withSelectable],
    runs: 100,
    seed: 7,
    invariants: (component) => {
      expect('fooReady' in component && component.fooReady).toBe(true)
      expect('selectableReady' in component && component.selectableReady).toBe(true)
    },
  })
})
