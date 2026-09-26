import { Store } from '@geajs/core'

export class AsyncCounterStore extends Store {
  count = 0

  async reset(): Promise<void> {
    await Promise.resolve()
    this.count = 0
  }

  async increment(): Promise<void> {
    await Promise.resolve()
    this.count += 1
  }

  async setCount(value: number): Promise<void> {
    await Promise.resolve()
    this.count = Math.max(0, Math.trunc(value))
  }
}

export default new AsyncCounterStore()
