import { Store } from '@geajs/core'

export class CounterStore extends Store {
  count = 0

  reset(): void {
    this.count = 0
  }

  increment(): void {
    this.count += 1
  }

  decrement(): void {
    this.count = Math.max(0, this.count - 1)
  }

  setCount(value: number): void {
    this.count = Math.max(0, Math.trunc(value))
  }
}

export default new CounterStore()
