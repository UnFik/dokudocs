// Vitest browser mode runs every spec file in an iframe. A synthetic click on
// an <a href> or a form submit navigates that iframe, and the runner then
// aborts the whole run with "Cannot connect to the iframe". Cancel those
// default actions in the bubble phase, so handlers under test still see the
// event first.
window.addEventListener('click', (event) => {
  const target = event.target
  if (target instanceof Element && target.closest('a[href]'))
    event.preventDefault()
})
window.addEventListener('submit', (event) => event.preventDefault())
