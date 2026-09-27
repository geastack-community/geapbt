import { describe, expect, it } from 'vitest'
import { boolean, integer } from 'fast-check'
import { Component } from '@geajs/core'
import {
  testComponentInvariants,
  testMixinLifecycle,
  testStoreInvariants,
  testStoreInvariantsAsync,
} from './index'

describe('testMixinLifecycle', () => {
  it('runs creation and disposal for every run', () => {
    const calls: string[] = []
    const withLifecycle = <TBase extends new (...args: any[]) => Component>(Base: TBase) => {
      class WithLifecycle extends Base {
        constructor(...args: any[]) {
          super(...args)
        }

        created(): void {
          calls.push('created')
        }

        dispose(): void {
          calls.push('dispose')
        }
      }
      return WithLifecycle
    }

    testMixinLifecycle({ mixins: [withLifecycle], runs: 3 })

    expect(calls).toEqual([
      'created',
      'dispose',
      'created',
      'dispose',
      'created',
      'dispose',
    ])
  })

  it('runs optional invariants after creation', () => {
    let checked = 0
    testMixinLifecycle({
      mixins: [],
      runs: 2,
      invariants: (component) => {
        expect(component).toBeDefined()
        checked += 1
      },
    })
    expect(checked).toBe(2)
  })
})

describe('testComponentInvariants', () => {
  it('generates props and dispatches randomized interactions', async () => {
    let rendered = 0
    let appended = 0
    let removed = 0
    const host = { remove: () => (removed += 1) }
    const previousDocument = Reflect.get(globalThis, 'document')
    Reflect.set(globalThis, 'document', {
      createElement: () => host,
      body: { appendChild: () => (appended += 1) },
    })

    class Checkbox {
      static activations = 0
      props: Record<string, unknown> = {}
      activations = 0
      cleared = false
      setCheckedValues: boolean[] = []
      el = {
        click: () => {
          this.activations += 1
          Checkbox.activations += 1
        },
        dispatchEvent: (event: Event) => {
          const key = Reflect.get(event, 'key')
          if (event.type === 'keydown' && key === ' ') {
            this.activations += 1
            Checkbox.activations += 1
          }
          return true
        },
      }

      render(): void {
        rendered += 1
      }

      clear(): void {
        this.cleared = true
      }

      setChecked(checked: boolean): void {
        this.setCheckedValues.push(checked)
      }
    }

    try {
      await testComponentInvariants(Checkbox, {
        props: { disabled: 'boolean', checked: 'boolean' },
        interactions: [
          'click',
          'pressSpace',
          { clear: [] },
          { setChecked: [boolean()] },
        ],
        runs: 20,
        seed: 1234,
        invariants: (component) => {
          expect(typeof component.props.disabled).toBe('boolean')
          expect(typeof component.props.checked).toBe('boolean')
          expect(component.activations).toBeGreaterThanOrEqual(0)
          expect(component.setCheckedValues.every((value) => typeof value === 'boolean')).toBe(
            true,
          )
        },
      })
    } finally {
      if (previousDocument === undefined) Reflect.deleteProperty(globalThis, 'document')
      else Reflect.set(globalThis, 'document', previousDocument)
    }

    expect(rendered).toBe(20)
    expect(appended).toBe(20)
    expect(removed).toBe(20)
    expect(Checkbox.activations).toBeGreaterThan(0)
  })

  it('generates combinations for methods with multiple arguments', async () => {
    class RangeComponent {
      start = 0
      end = 10

      setRange(start: number, end: number): void {
        this.start = start
        this.end = end
      }
    }

    await testComponentInvariants(RangeComponent, {
      interactions: [
        { setRange: [integer({ min: 0, max: 10 }), integer({ min: 10, max: 20 })] },
      ],
      runs: 20,
      seed: 89,
      invariants: (component) => {
        expect(component.start).toBeGreaterThanOrEqual(0)
        expect(component.start).toBeLessThanOrEqual(10)
        expect(component.end).toBeGreaterThanOrEqual(10)
        expect(component.end).toBeLessThanOrEqual(20)
      },
    })
  })

  it('uses an argument generator to call a one-argument method', async () => {
    class ComponentWithAction {
      value = 2

      setValue(value: number): void {
        this.value = value
      }
    }

    await testComponentInvariants(ComponentWithAction, {
      interactions: [{ setValue: [integer({ min: 2, max: 4 })] }],
      runs: 20,
      seed: 321,
      invariants: (component) => {
        expect(component.value).toBeGreaterThanOrEqual(2)
        expect(component.value).toBeLessThanOrEqual(4)
      },
    })
  })

  it('supports array values for single-argument methods', async () => {
    class TagsComponent {
      tags: string[] = ['initial']

      setTags(tags: string[]): void {
        this.tags = tags
      }
    }

    await testComponentInvariants(TagsComponent, {
      interactions: [{ setTags: [() => ['profile', 'security']] }],
      runs: 20,
      seed: 322,
      invariants: (component) => {
        expect([['initial'], ['profile', 'security']]).toContainEqual(component.tags)
      },
    })
  })

  it('uses an object descriptor for zero-argument component methods', async () => {
    class ResettableComponent {
      static resets = 0

      reset(): void {
        ResettableComponent.resets += 1
      }
    }

    ResettableComponent.resets = 0
    await testComponentInvariants(ResettableComponent, {
      interactions: [{ reset: [] }],
      runs: 5,
      maxInteractions: 1,
      invariants: () => {},
    })

    expect(ResettableComponent.resets).toBe(5)
  })

  it('distinguishes standard interactions from methods with the same name', async () => {
    class ClickComponent {
      static domClicks = 0
      static methodClicks = 0

      el = {
        click: () => {
          ClickComponent.domClicks += 1
        },
        dispatchEvent: () => true,
      }

      click(): void {
        ClickComponent.methodClicks += 1
      }
    }

    ClickComponent.domClicks = 0
    ClickComponent.methodClicks = 0
    await testComponentInvariants(ClickComponent, {
      interactions: ['click'],
      runs: 1,
      maxInteractions: 1,
      invariants: () => {},
    })
    await testComponentInvariants(ClickComponent, {
      interactions: [{ click: [] }],
      runs: 1,
      maxInteractions: 1,
      invariants: () => {},
    })

    expect(ClickComponent.domClicks).toBe(1)
    expect(ClickComponent.methodClicks).toBe(1)
  })
})

describe('testStoreInvariants', () => {
  it('checks invariants after generated action sequences', () => {
    class UserStore {
      age = 0
      error: string | null = null

      reset(): void {
        this.age = 0
      }

      clearError(): void {
        this.error = null
      }

      setAge(age: number): void {
        this.age = age
      }
    }

    testStoreInvariants(UserStore, {
      actions: {
        reset: [],
        clearError: [],
        setAge: [() => Math.floor(Math.random() * 100)],
      },
      runs: 30,
      seed: 987,
      invariants: (store) => {
        expect(store.age).toBeGreaterThanOrEqual(0)
      },
    })
  })

  it('propagates invariant failures', () => {
    class BrokenStore {
      age = 0
      setAge(age: number): void {
        this.age = age
      }
    }

    expect(() =>
      testStoreInvariants(BrokenStore, {
        actions: { setAge: [-1] },
        invariants: (store) => expect(store.age).toBeGreaterThanOrEqual(0),
      }),
    ).toThrow()
  })
})

describe('testStoreInvariantsAsync', () => {
  it('awaits actions and invariants sequentially', async () => {
    const checked = new Map<object, number>()

    class AsyncStore {
      static disposed = 0
      value = 0
      activeActions = 0

      async setValue(value: number): Promise<void> {
        this.activeActions += 1
        expect(this.activeActions).toBe(1)
        await Promise.resolve()
        this.value = value
        this.activeActions -= 1
      }

      async dispose(): Promise<void> {
        await Promise.resolve()
        expect(this.activeActions).toBe(0)
        AsyncStore.disposed += 1
      }
    }

    await testStoreInvariantsAsync(AsyncStore, {
      actions: { setValue: [integer({ min: 0, max: 100 })] },
      runs: 20,
      seed: 103,
      invariants: async (store) => {
        await Promise.resolve()
        expect(store.value).toBeGreaterThanOrEqual(0)
        checked.set(store, (checked.get(store) ?? 0) + 1)
      },
    })

    expect([...checked.values()].every((count) => count > 1)).toBe(true)
    expect(AsyncStore.disposed).toBe(20)
  })

  it('propagates rejected asynchronous actions', async () => {
    class BrokenAsyncStore {
      async fail(): Promise<void> {
        throw new Error('action failed')
      }
    }

    await expect(
      testStoreInvariantsAsync(BrokenAsyncStore, {
        actions: { fail: [] },
        runs: 1,
        seed: 2,
        invariants: () => undefined,
      }),
    ).rejects.toThrow()
  })

  it('propagates rejected asynchronous invariants', async () => {
    class AsyncStore {
      async noop(): Promise<void> {}
    }

    await expect(
      testStoreInvariantsAsync(AsyncStore, {
        actions: { noop: [] },
        runs: 1,
        seed: 3,
        invariants: async () => {
          throw new Error('invariant failed')
        },
      }),
    ).rejects.toThrow()
  })
})
