import { Component } from '@geajs/core'

export type CheckboxProps = {
  checked: boolean
  disabled: boolean
}

export default class Checkbox extends Component {
  declare props: CheckboxProps
  checked = false
  initialChecked = false
  interactionAttempts = 0

  created(): void {
    this.checked = this.props.checked
    this.initialChecked = this.checked
  }

  toggle(): void {
    this.interactionAttempts += 1
    if (!this.props.disabled) this.checked = !this.checked
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === ' ') {
      event.preventDefault()
      this.toggle()
    }
  }

  template() {
    return (
      <button
        type="button"
        role="checkbox"
        aria-checked={this.checked}
        aria-disabled={this.props.disabled}
        disabled={this.props.disabled}
        click={this.toggle}
        keydown={this.onKeyDown}
      >
        {this.checked ? 'Selected' : 'Not selected'}
      </button>
    )
  }
}
