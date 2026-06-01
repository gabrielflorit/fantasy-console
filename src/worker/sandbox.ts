// Evaluate cassette source with an API object's keys injected as locals.
// 'use strict' catches implicit-global leakage across cassette loads — a
// missing `let` would otherwise bind to `self` and persist into the next
// load. See FACTORY-PLAN.md; the sandbox is not the security boundary.

export function evaluateCassette(
  source: string,
  api: Record<string, unknown>,
) {
  let body = `'use strict';\n${source}`
  new Function(...Object.keys(api), body)(...Object.values(api))
}
