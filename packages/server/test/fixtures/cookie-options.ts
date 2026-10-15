import type { ServerOptions } from '../../src/types'

export const cookieCases = [
  { name: 'none', cookies: [] },
  { name: 'one', cookies: ['session=one; Path=/; HttpOnly'] },
  {
    name: 'many',
    cookies: [
      'session=first; Expires=Wed, 21 Oct 2037 07:28:00 GMT; Path=/; HttpOnly',
      'preferences=dark; Path=/; SameSite=Lax',
      'session=second; Path=/admin; Secure',
    ],
  },
]

export function createCookieOptions() {
  return {
    manifest: {
      version: 1,
      routes: cookieCases.map(({ name }) => ({
        method: 'GET',
        url: `/cookies/${name}`,
        response: { type: 'module', module: `mock:${name}` },
      })),
    },
    moduleMap: Object.fromEntries(cookieCases.map(({ name, cookies }) => [
      `mock:${name}`,
      {
        default: {
          handler: () => {
            const headers = new Headers({ 'X-Test': 'cookies' })
            for (const [index, cookie] of cookies.entries()) {
              headers.append(index % 2 ? 'set-cookie' : 'Set-Cookie', cookie)
            }
            return new Response(name, { headers })
          },
        },
      },
    ])),
  } satisfies ServerOptions
}
