declare module 'vega-lite' {
  const content: unknown
  export default content
  export const version: string
  export const compile: unknown
  export const normalize: unknown
  export type Config = unknown
  export type TopLevelSpec = unknown
}

declare module 'vega-tooltip' {
  const content: unknown
  export default content
  export const Handler: unknown
}

declare module 'rxjs' {
  export interface Subscription {
    unsubscribe(): void
  }
  export interface Observable<T> {
    subscribe(next: (value: T) => void): Subscription
  }
  export function fromEvent<K extends keyof HTMLElementEventMap>(
    target: EventTarget,
    eventName: K
  ): Observable<HTMLElementEventMap[K]>
  export function fromEvent(
    target: EventTarget,
    eventName: string
  ): Observable<Event>
  export function merge(...sources: Observable<Event>[]): Observable<Event>
}

declare module 'seroval' {
  const content: unknown
  export default content
  export const Feature: unknown
  export const createReference: unknown
}
