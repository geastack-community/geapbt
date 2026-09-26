import { Component } from '@geajs/core'
import * as fc from 'fast-check'

export type PropertyInput =
  | 'boolean'
  | 'string'
  | 'number'
  | 'integer'
  | fc.Arbitrary<unknown>
  | (() => unknown)
  | null
  | boolean
  | number
  | string

export type TestOptions = {
  runs?: number
  seed?: number
}

export type Mixin = <TBase extends new (...args: any[]) => Component>(
  base: TBase,
) => new (...args: ConstructorParameters<TBase>) => Component

export type MixinLifecycleOptions = TestOptions & {
  mixins: readonly Mixin[]
  invariants?: (instance: Component) => void
}

export type ComponentInvariantOptions<T extends object = object> = TestOptions & {
  props?: Record<string, PropertyInput>
  interactions?: readonly ('click' | 'pressSpace')[]
  invariants: (component: T) => void | Promise<void>
  maxInteractions?: number
}

export type StoreActionInputs<T extends object> = Partial<{
  [K in keyof T & string]: T[K] extends (...args: infer Args) => unknown
    ? { [Index in keyof Args]: PropertyInput }
    : never
}>

export type StoreInvariantOptions<T extends object = object> = TestOptions & {
  actions: StoreActionInputs<T>
  invariants: (store: T) => void
  maxActions?: number
}

type Constructable<T extends object> = new () => T
type MixinConstructor = new (...args: any[]) => Component

function getRuns(options: TestOptions): number {
  const runs = options.runs ?? 100
  if (!Number.isInteger(runs) || runs < 1) {
    throw new RangeError('runs must be a positive integer')
  }
  return runs
}

function assertSynchronous(value: unknown, callbackName: string): void {
  if (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
  ) {
    throw new TypeError(`${callbackName} must complete synchronously`)
  }
}

function toArbitrary(input: PropertyInput): fc.Arbitrary<unknown> {
  if (input instanceof fc.Arbitrary) return input

  if (typeof input === 'function') {
    return fc.constant(null).map(() => input())
  }

  switch (input) {
    case 'boolean':
      return fc.boolean()
    case 'string':
      return fc.string()
    case 'number':
      return fc.double({ noNaN: true, noDefaultInfinity: true })
    case 'integer':
      return fc.integer()
    default:
      return fc.constant(input)
  }
}

function propertyOptions<Ts extends unknown[]>(options: TestOptions): fc.Parameters<Ts> {
  return {
    numRuns: getRuns(options),
    ...(options.seed === undefined ? {} : { seed: options.seed }),
  }
}

function getMethod(target: object, name: string): ((...args: unknown[]) => unknown) | undefined {
  const method = Reflect.get(target, name)
  if (method === undefined) return undefined
  if (typeof method !== 'function') {
    throw new TypeError(`${name} must be a function`)
  }
  return method as (...args: unknown[]) => unknown
}

function invoke(target: object, name: string, args: unknown[] = []): void {
  const method = getMethod(target, name)
  if (method) assertSynchronous(Reflect.apply(method, target, args), name)
}

function invokeRequired(target: object, name: string, args: unknown[] = []): void {
  const method = getMethod(target, name)
  if (!method) throw new TypeError(`${name} is not a function`)
  assertSynchronous(Reflect.apply(method, target, args), name)
}

function assertInvariants<T extends object>(invariants: (value: T) => void, value: T): void {
  assertSynchronous(invariants(value), 'invariants')
}

async function waitForComponentUpdates(): Promise<void> {
  await new Promise<void>((resolve) => queueMicrotask(resolve))
}

/**
 * Repeatedly compose, construct, initialize, and dispose a Gea Component with
 * the supplied mixins. Optional invariants run after initialization.
 */
export function testMixinLifecycle(options: MixinLifecycleOptions): void {
  const runs = getRuns(options)

  fc.assert(
    fc.property(fc.constant(options.mixins), (mixins) => {
      let Mixed: MixinConstructor = Component
      for (const mixin of mixins) {
        Mixed = mixin(Mixed)
      }
      const instance = new Mixed()
      try {
        invoke(instance, 'created', [Reflect.get(instance, 'props')])
        invoke(instance, 'flushSync')
        if (options.invariants) assertInvariants(options.invariants, instance)
      } finally {
        invoke(instance, 'dispose')
      }
    }),
    propertyOptions(options),
  )
}

/**
 * Fuzz generated component props and interaction sequences, checking the
 * supplied invariant before and after each interaction.
 */
export async function testComponentInvariants<T extends object>(
  ComponentType: Constructable<T>,
  options: ComponentInvariantOptions<T>,
): Promise<void> {
  const props = options.props ?? {}
  const propNames = Object.keys(props)
  const propsArbitrary: fc.Arbitrary<Record<string, unknown>> =
    propNames.length === 0
      ? fc.constant({})
      : fc.record(
          Object.fromEntries(propNames.map((name) => [name, toArbitrary(props[name])])) as Record<
            string,
            fc.Arbitrary<unknown>
          >,
        )
  const interactions = options.interactions ?? []
  const maxInteractions = options.maxInteractions ?? Math.max(1, interactions.length * 3)

  if (!Number.isInteger(maxInteractions) || maxInteractions < 0) {
    throw new RangeError('maxInteractions must be a non-negative integer')
  }
  for (const interaction of interactions) {
    if (interaction !== 'click' && interaction !== 'pressSpace') {
      throw new TypeError(`Unsupported component interaction: ${String(interaction)}`)
    }
  }

  await fc.assert(
    fc.asyncProperty(
      propsArbitrary,
      interactions.length === 0
        ? fc.constant([] as ('click' | 'pressSpace')[])
        : fc.array(fc.constantFrom(...interactions), {
            minLength: maxInteractions === 0 ? 0 : 1,
            maxLength: maxInteractions,
          }),
      async (generatedProps, generatedInteractions) => {
        const component = new ComponentType()
        let host: HTMLElement | undefined
        try {
          host = mountComponent(component, generatedProps)
          invoke(component, 'flushSync')
          await waitForComponentUpdates()
          await options.invariants(component)
          for (const interaction of generatedInteractions) {
            performInteraction(component, interaction)
            invoke(component, 'flushSync')
            await waitForComponentUpdates()
            await options.invariants(component)
          }
        } finally {
          try {
            invoke(component, 'dispose')
          } finally {
            host?.remove()
          }
        }
      },
    ),
    propertyOptions<[Record<string, unknown>, ('click' | 'pressSpace')[]]>(options),
  )
}

/**
 * Run randomized store action sequences, checking invariants initially and
 * after every action.
 */
export function testStoreInvariants<T extends object>(
  StoreType: Constructable<T>,
  options: StoreInvariantOptions<T>,
): void {
  const actionNames = Object.keys(options.actions)
  const maxActions = options.maxActions ?? Math.max(1, actionNames.length * 5)

  if (!Number.isInteger(maxActions) || maxActions < 0) {
    throw new RangeError('maxActions must be a non-negative integer')
  }

  const actionArbitraries = actionNames.map((name) => {
    const args = options.actions[name as keyof T & string]
    if (!Array.isArray(args)) {
      throw new TypeError(`Arguments for store action "${name}" must be an array`)
    }
    const argsArbitrary =
      args.length === 0
        ? fc.constant([] as unknown[])
        : fc.tuple(...args.map(toArbitrary))
    return argsArbitrary.map((generatedArgs) => ({ name, args: generatedArgs }))
  })

  const sequences =
    actionArbitraries.length === 0 || maxActions === 0
      ? fc.constant([] as { name: string; args: unknown[] }[])
      : fc.array(fc.oneof(...actionArbitraries), { minLength: 1, maxLength: maxActions })

  fc.assert(
    fc.property(sequences, (sequence) => {
      const store = new StoreType()
      try {
        for (const name of actionNames) {
          if (!getMethod(store, name)) {
            throw new TypeError(`Store action "${name}" is not a function`)
          }
        }
        invoke(store, 'flushSync')
        assertInvariants(options.invariants, store)
        for (const action of sequence) {
          invokeRequired(store, action.name, action.args)
          invoke(store, 'flushSync')
          assertInvariants(options.invariants, store)
        }
      } finally {
        invoke(store, 'dispose')
      }
    }),
    propertyOptions<[{ name: string; args: unknown[] }[]]>(options),
  )
}

function mountComponent<T extends object>(
  component: T,
  props: Record<string, unknown>,
): HTMLElement | undefined {
  if (!Reflect.set(component, 'props', props)) {
    throw new TypeError('Component props could not be assigned')
  }

  const render = getMethod(component, 'render')
  if (!render) return undefined

  if (typeof document === 'undefined') {
    throw new Error('Component rendering requires a DOM; run this test in a DOM environment')
  }

  const host = document.createElement('div')
  document.body?.appendChild(host)
  try {
    assertSynchronous(Reflect.apply(render, component, [host]), 'render')
  } catch (error) {
    host.remove()
    throw error
  }
  return host
}

function performInteraction(
  component: object,
  interaction: 'click' | 'pressSpace',
): void {
  const root = Reflect.get(component, 'el')
  if (!isEventTarget(root)) {
    throw new Error(`Cannot perform ${interaction}: component has no rendered root element`)
  }

  if (interaction === 'click') {
    if (typeof Reflect.get(root, 'click') === 'function') {
      invoke(root, 'click')
      return
    }
    dispatchEvent(root, 'click')
    return
  }

  dispatchEvent(root, 'keydown', { key: ' ', code: 'Space' })
  dispatchEvent(root, 'keyup', { key: ' ', code: 'Space' })
}

function isEventTarget(value: unknown): value is EventTarget & object {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof Reflect.get(value, 'dispatchEvent') === 'function'
  )
}

function dispatchEvent(
  target: EventTarget & object,
  type: string,
  keyboard?: { key: string; code: string },
): void {
  const ownerDocument = Reflect.get(target, 'ownerDocument') as Document | null | undefined
  const view = ownerDocument?.defaultView
  const EventConstructor =
    view?.Event ?? (typeof globalThis.Event === 'undefined' ? undefined : globalThis.Event)
  if (!EventConstructor) {
    throw new Error('DOM interactions require an Event implementation')
  }
  const KeyboardEventConstructor = view?.KeyboardEvent ?? globalThis.KeyboardEvent
  const event =
    keyboard && KeyboardEventConstructor
      ? new KeyboardEventConstructor(type, { ...keyboard, bubbles: true })
      : new EventConstructor(type, { bubbles: true })

  if (keyboard && !KeyboardEventConstructor) {
    Object.defineProperties(event, {
      key: { value: keyboard.key },
      code: { value: keyboard.code },
    })
  }
  target.dispatchEvent(event)
}
