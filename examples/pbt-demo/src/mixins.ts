import { Component } from '@geajs/core'

export function withFoo<TBase extends new (...args: any[]) => Component>(Base: TBase) {
  return class WithFoo extends Base {
    fooReady = false

    created(props?: this['props']): void {
      super.created(props)
      this.fooReady = true
    }

    dispose(): void {
      this.fooReady = false
      super.dispose()
    }
  }
}

export function withSelectable<TBase extends new (...args: any[]) => Component>(Base: TBase) {
  return class WithSelectable extends Base {
    selectableReady = false

    created(props?: this['props']): void {
      super.created(props)
      this.selectableReady = true
    }

    dispose(): void {
      this.selectableReady = false
      super.dispose()
    }
  }
}
