import { Component } from '@geajs/core'
import type { ComponentConstructor, Constructor, Mixin } from '@geastack-community/utils'
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

export type MixinLifecycleOptions = TestOptions & {
  mixins: readonly Mixin[]
  invariants?: (instance: Component) => void
}

export type ComponentInvariantOptions<T extends object = object> = TestOptions & {
  props?: Record<string, PropertyInput>
  interactions?: readonly ComponentInteraction<T>[]
  invariants: (component: T) => void
  maxInteractions?: number
}

export type ComponentAsyncInvariantOptions<T extends object = object> = TestOptions & {
  props?: Record<string, PropertyInput>
  interactions?: readonly ComponentInteraction<T>[]
  invariants: (component: T) => void | Promise<void>
  maxInteractions?: number
}

type StandardInteractionValue<T> = T | readonly T[] | (() => T) | fc.Arbitrary<T>
type GeneratedStandardValue<T> = T extends fc.Arbitrary<infer Value>
  ? Value
  : T extends () => infer Value
    ? Value
    : T extends readonly (infer Value)[]
      ? Value
      : T
type GeneratedStandardOptions<Options> = {
  [K in keyof Options]: GeneratedStandardValue<Options[K]>
}

type ComponentMethodKeys<T extends object> = {
  [K in keyof T & string]: T[K] extends (...args: any[]) => unknown ? K : never
}[keyof T & string]

type ComponentMethodInteraction<T extends object> = {
  [K in ComponentMethodKeys<T>]: {
    [P in K]: T[K] extends (...args: infer Args) => unknown
      ? { [Index in keyof Args]: PropertyInput }
      : never
  } & { [P in Exclude<ComponentMethodKeys<T>, K>]?: never }
}[ComponentMethodKeys<T>]

type StandardInteractionDefinition<Options extends object> = {
  readonly optionsType?: Options
  readonly optionKeys: readonly string[]
  generate: (input: unknown) => fc.Arbitrary<Record<string, unknown>>
  perform: (component: object, options: Record<string, unknown>) => void
}

type PressKeyOptions = {
  target: string
  key: StandardInteractionValue<string>
  code?: StandardInteractionValue<string>
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

export type StoreAsyncInvariantOptions<T extends object = object> = TestOptions & {
  actions: StoreActionInputs<T>
  invariants: (store: T) => void | Promise<void>
  maxActions?: number
}

type GeneratedInteraction =
  | { kind: 'standard'; name: string; options: Record<string, unknown> }
  | { kind: 'method'; name: string; args: unknown[] }

function defineStandardInteraction<Options extends object>(
  shape: Options,
  perform: (component: object, options: GeneratedStandardOptions<Options>) => void,
): StandardInteractionDefinition<Options> {
  const keys = Object.keys(shape)
  const requiredKeys = keys.filter((key) => Reflect.get(shape, key) !== undefined)
  return {
    optionKeys: keys,
    generate(input) {
      if (
        input === null ||
        typeof input !== 'object' ||
        Array.isArray(input) ||
        requiredKeys.some((key) => !Object.hasOwn(input, key)) ||
        Object.keys(input).some((key) => !keys.includes(key))
      ) {
        throw new TypeError('Invalid standard interaction options')
      }
      const arbitraries = Object.fromEntries(
        keys.map((key) => [
          key,
          toStandardInteractionArbitrary(Reflect.get(input, key)),
        ]),
      ) as Record<string, fc.Arbitrary<unknown>>
      return fc.record(arbitraries)
    },
    perform(component, options) {
      perform(component, options as GeneratedStandardOptions<Options>)
    },
  }
}

const standardInteractions = {
  click: defineStandardInteraction({}, (component) => {
    const root = getInteractionRoot(component, 'click')
    if (typeof Reflect.get(root, 'click') === 'function') {
      invoke(root, 'click')
      return
    }
    dispatchEvent(root, 'click')
  }),
  pressSpace: defineStandardInteraction({}, (component) => {
    const root = getInteractionRoot(component, 'pressSpace')
    dispatchEvent(root, 'keydown', { key: ' ', code: 'Space' })
    dispatchEvent(root, 'keyup', { key: ' ', code: 'Space' })
  }),
  typeText: defineStandardInteraction(
    { target: '', text: '' as StandardInteractionValue<string> },
    (component, { target: selector, text }) => {
      const target = findInteractionTarget(component, selector, 'typeText')
      const tagName = Reflect.get(target, 'tagName')
      const inputType = Reflect.get(target, 'type')
      const textInputTypes = ['text', 'search', 'email', 'url', 'tel', 'password']
      if (
        (tagName !== 'INPUT' && tagName !== 'TEXTAREA') ||
        (tagName === 'INPUT' && !textInputTypes.includes(String(inputType))) ||
        Reflect.get(target, 'disabled') === true ||
        Reflect.get(target, 'readOnly') === true
      ) {
        throw new TypeError(`Cannot type text into the selected ${String(tagName)} element`)
      }
      if (!Reflect.set(target, 'value', text)) {
        throw new TypeError('Text input value could not be set')
      }
      dispatchEvent(target, 'input')
    },
  ),
  pressKey: defineStandardInteraction<PressKeyOptions>(
    {
      target: '',
      key: '' as StandardInteractionValue<string>,
      code: undefined as StandardInteractionValue<string> | undefined,
    },
    (component, { target: selector, key, code }) => {
      const target = findInteractionTarget(component, selector, 'pressKey')
      const keyboardCode = code ?? getKeyboardCode(key)
      dispatchEvent(target, 'keydown', { key, code: keyboardCode })
      dispatchEvent(target, 'keyup', { key, code: keyboardCode })
    },
  ),
}

type StandardInteractionName = keyof typeof standardInteractions
type StandardInteractionInput<Name extends StandardInteractionName> = NonNullable<
  (typeof standardInteractions)[Name]['optionsType']
>
type StandardInteractions = {
  [Name in StandardInteractionName]: keyof StandardInteractionInput<Name> extends never
    ? Name
    : { [Key in Name]: StandardInteractionInput<Name> }
}[StandardInteractionName]

export type ComponentInteraction<T extends object> =
  | StandardInteractions
  | ComponentMethodInteraction<T>

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

function toStandardInteractionArbitrary(
  input: unknown,
  interactionName = 'standard interaction',
): fc.Arbitrary<string> {
  const assertString = (value: unknown): string => {
    if (typeof value !== 'string') {
      throw new TypeError(`${interactionName} values must be strings`)
    }
    return value
  }
  if (input instanceof fc.Arbitrary) return input.map(assertString)
  if (typeof input === 'function') {
    return fc.constant(null).map(() => assertString((input as () => unknown)()))
  }
  if (Array.isArray(input)) {
    if (input.length === 0) {
      throw new TypeError('Standard interaction values must provide at least one option')
    }
    return fc.oneof(...input.map((value) => fc.constant(assertString(value))))
  }
  if (input === undefined) return fc.constant(undefined as never)
  return fc.constant(assertString(input))
}

function toInteractionArbitrary<T extends object>(
  interaction: ComponentInteraction<T>,
): fc.Arbitrary<GeneratedInteraction> {
  if (typeof interaction === 'string') {
    if (!isStandardInteractionName(interaction)) {
      throw new TypeError(`Unsupported standard component interaction "${interaction}"`)
    }
    const definition = standardInteractions[interaction as StandardInteractionName]
    if (definition.optionKeys.length > 0) {
      throw new TypeError(`Standard interaction "${interaction}" requires an options descriptor`)
    }
    return definition.generate({}).map((options) => ({
      kind: 'standard',
      name: interaction,
      options,
    }))
  }

  if (interaction === null || typeof interaction !== 'object' || Array.isArray(interaction)) {
    throw new TypeError('Each custom component interaction must be a single-method object')
  }

  const entries = Object.entries(interaction)
  if (entries.length !== 1) {
    throw new TypeError('Each custom component interaction must specify exactly one method')
  }

  const [name, args] = entries[0]
  if (
    Object.hasOwn(standardInteractions, name) &&
    args !== null &&
    typeof args === 'object' &&
    !Array.isArray(args)
  ) {
    const definition = standardInteractions[name as StandardInteractionName]
    return definition.generate(args as Record<string, unknown>).map((options) => ({
      kind: 'standard',
      name,
      options: options as Record<string, unknown>,
    }))
  }
  if (!Array.isArray(args)) {
    throw new TypeError(`Arguments for component interaction "${name}" must be an array`)
  }

  const argsArbitrary =
    args.length === 0 ? fc.constant([] as unknown[]) : fc.tuple(...args.map(toArbitrary))
  return argsArbitrary.map((generatedArgs) => ({ kind: 'method', name, args: generatedArgs }))
}

function isStandardInteractionName(name: string): name is StandardInteractionName {
  return Object.hasOwn(standardInteractions, name)
}

function validateComponentInteractions<T extends object>(
  component: T,
  interactions: readonly ComponentInteraction<T>[],
): void {
  for (const interaction of interactions) {
    if (typeof interaction === 'string') {
      if (
        isStandardInteractionName(interaction) &&
        standardInteractions[interaction].optionKeys.length === 0
      ) {
        continue
      }
      throw new TypeError(`Unsupported standard component interaction "${interaction}"`)
    }
    const name = Object.keys(interaction)[0]
    const value = name ? Reflect.get(interaction, name) : undefined
    if (name && isStandardInteractionName(name) && value !== null && typeof value === 'object' && !Array.isArray(value)) {
      continue
    }
    if (!name || !getMethod(component, name)) {
      throw new TypeError(`Component interaction "${name ?? ''}" is not a function`)
    }
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

async function invokeAsync(
  target: object,
  name: string,
  args: unknown[] = [],
  required = false,
): Promise<void> {
  const method = getMethod(target, name)
  if (!method) {
    if (required) throw new TypeError(`${name} is not a function`)
    return
  }
  await Reflect.apply(method, target, args)
}

function assertInvariants<T extends object>(invariants: (value: T) => void, value: T): void {
  assertSynchronous(invariants(value), 'invariants')
}

function createStoreSequences<T extends object>(
  actions: StoreActionInputs<T>,
  maxActionsOption: number | undefined,
): { actionNames: string[]; sequences: fc.Arbitrary<{ name: string; args: unknown[] }[]> } {
  const actionNames = Object.keys(actions)
  const maxActions = maxActionsOption ?? Math.max(1, actionNames.length * 5)

  if (!Number.isInteger(maxActions) || maxActions < 0) {
    throw new RangeError('maxActions must be a non-negative integer')
  }

  const actionArbitraries = actionNames.map((name) => {
    const args = actions[name as keyof T & string]
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

  return { actionNames, sequences }
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
      let Mixed: ComponentConstructor = Component
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
export function testComponentInvariants<T extends object>(
  ComponentType: Constructor<T>,
  options: ComponentInvariantOptions<T>,
): void {
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
  const interactionArbitraries = interactions.map((interaction) =>
    toInteractionArbitrary(interaction),
  )
  const sequenceArbitrary =
    interactionArbitraries.length === 0
      ? fc.constant([] as GeneratedInteraction[])
      : fc.array(fc.oneof(...interactionArbitraries), {
          minLength: maxInteractions === 0 ? 0 : 1,
          maxLength: maxInteractions,
        })
  let interactionsValidated = false
  let interactionValidationError: unknown
  let hasInteractionValidationError = false

  try {
    fc.assert(
      fc.property(
        propsArbitrary,
        sequenceArbitrary,
        (generatedProps, generatedInteractions) => {
          if (hasInteractionValidationError) throw interactionValidationError
          const component = new ComponentType()
          let host: HTMLElement | undefined
          try {
            if (!interactionsValidated) {
              interactionsValidated = true
              try {
                validateComponentInteractions(component, interactions)
              } catch (error) {
                interactionValidationError = error
                hasInteractionValidationError = true
                throw error
              }
            }
            host = mountComponent(component, generatedProps)
            invoke(component, 'flushSync')
            options.invariants(component)
            for (const interaction of generatedInteractions) {
              performInteraction(component, interaction)
              invoke(component, 'flushSync')
              options.invariants(component)
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
      propertyOptions<[Record<string, unknown>, GeneratedInteraction[]]>(options),
    )
  } catch (error) {
    if (hasInteractionValidationError) throw interactionValidationError
    throw error
  }
}

/**
 * Run randomized component interactions while awaiting batched updates and
 * asynchronous invariant checks.
 */
export async function testComponentInvariantsAsync<T extends object>(
  ComponentType: Constructor<T>,
  options: ComponentAsyncInvariantOptions<T>,
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
  const interactionArbitraries = interactions.map((interaction) =>
    toInteractionArbitrary(interaction),
  )
  const sequenceArbitrary =
    interactionArbitraries.length === 0
      ? fc.constant([] as GeneratedInteraction[])
      : fc.array(fc.oneof(...interactionArbitraries), {
          minLength: maxInteractions === 0 ? 0 : 1,
          maxLength: maxInteractions,
        })
  let interactionsValidated = false
  let interactionValidationError: unknown
  let hasInteractionValidationError = false

  try {
    await fc.assert(
      fc.asyncProperty(
        propsArbitrary,
        sequenceArbitrary,
        async (generatedProps, generatedInteractions) => {
          if (hasInteractionValidationError) throw interactionValidationError
          const component = new ComponentType()
          let host: HTMLElement | undefined
          try {
            if (!interactionsValidated) {
              interactionsValidated = true
              try {
                validateComponentInteractions(component, interactions)
              } catch (error) {
                interactionValidationError = error
                hasInteractionValidationError = true
                throw error
              }
            }
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
      propertyOptions<[Record<string, unknown>, GeneratedInteraction[]]>(options),
    )
  } catch (error) {
    if (hasInteractionValidationError) throw interactionValidationError
    throw error
  }
}

/**
 * Run randomized store action sequences, checking invariants initially and
 * after every action.
 */
export function testStoreInvariants<T extends object>(
  StoreType: Constructor<T>,
  options: StoreInvariantOptions<T>,
): void {
  const { actionNames, sequences } = createStoreSequences(
    options.actions,
    options.maxActions,
  )

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

/**
 * Run randomized store action sequences, awaiting each action and invariant
 * before continuing to the next state.
 */
export async function testStoreInvariantsAsync<T extends object>(
  StoreType: Constructor<T>,
  options: StoreAsyncInvariantOptions<T>,
): Promise<void> {
  const { actionNames, sequences } = createStoreSequences(
    options.actions,
    options.maxActions,
  )

  await fc.assert(
    fc.asyncProperty(sequences, async (sequence) => {
      const store = new StoreType()
      try {
        for (const name of actionNames) {
          if (!getMethod(store, name)) {
            throw new TypeError(`Store action "${name}" is not a function`)
          }
        }
        await invokeAsync(store, 'flushSync')
        await options.invariants(store)
        for (const action of sequence) {
          await invokeAsync(store, action.name, action.args, true)
          await invokeAsync(store, 'flushSync')
          await options.invariants(store)
        }
      } finally {
        await invokeAsync(store, 'dispose')
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
  interaction: GeneratedInteraction,
): void {
  if (interaction.kind === 'method') {
    invokeRequired(component, interaction.name, interaction.args)
    return
  }
  const definition = standardInteractions[interaction.name as StandardInteractionName]
  definition.perform(component, interaction.options)
}

function getInteractionRoot(component: object, interactionName: string): EventTarget & object {
  const root = Reflect.get(component, 'el')
  if (!isEventTarget(root)) {
    throw new Error(`Cannot perform ${interactionName}: component has no rendered root element`)
  }
  return root
}

function findInteractionTarget(
  component: object,
  selector: string,
  interactionName: string,
): EventTarget & object {
  const root = getInteractionRoot(component, interactionName)
  const matches = Reflect.get(root, 'matches')
  const querySelector = Reflect.get(root, 'querySelector')
  if (typeof matches !== 'function' || typeof querySelector !== 'function') {
    throw new TypeError(`Cannot find ${interactionName} target: component root is not an Element`)
  }
  if (Reflect.apply(matches, root, [selector]) && isEventTarget(root)) return root
  const target = Reflect.apply(querySelector, root, [selector])
  if (!isEventTarget(target)) {
    throw new Error(`Cannot find ${interactionName} target matching "${selector}"`)
  }
  return target
}

function getKeyboardCode(key: string): string {
  if (key === ' ') return 'Space'
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`
  if (/^[0-9]$/.test(key)) return `Digit${key}`
  const codes: Record<string, string> = {
    '-': 'Minus',
    '=': 'Equal',
    '[': 'BracketLeft',
    ']': 'BracketRight',
    '\\': 'Backslash',
    ';': 'Semicolon',
    "'": 'Quote',
    ',': 'Comma',
    '.': 'Period',
    '/': 'Slash',
    '`': 'Backquote',
  }
  return codes[key] ?? key
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
