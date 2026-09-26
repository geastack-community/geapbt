import App from './app'

const root = document.getElementById('app')
if (!root) throw new Error('App root element was not found')

new App().render(root)
