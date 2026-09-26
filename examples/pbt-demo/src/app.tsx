import { Component } from '@geajs/core'
import counterStore from './counter-store'

export default class App extends Component {
  template() {
    return (
      <main>
        <h1>Gea property-based testing demo</h1>
        <p>Counter: {counterStore.count}</p>
        <button click={counterStore.decrement}>-</button>
        <button click={counterStore.increment}>+</button>
      </main>
    )
  }
}
