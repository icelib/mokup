import { expect, test } from '@playwright/test'

test('local D1 preserves accounts and supports auth and user requests', async ({ request, baseURL }) => {
  if (!baseURL) {
    throw new Error('The local D1 runner must provide E2E_BASE_URL.')
  }
  const headers = { Origin: baseURL }

  const existingSignIn = await request.post('/api/auth/sign-in/email', {
    headers,
    data: { email: 'existing@example.com', password: 'existing-password-123' },
  })
  await expect(existingSignIn).toBeOK()
  const existingSession = await request.get('/api/auth/get-session')
  await expect(existingSession).toBeOK()
  expect(await existingSession.json()).toMatchObject({ user: { id: 'existing-user' } })

  const accounts = await request.get('/api/auth/list-accounts')
  await expect(accounts).toBeOK()
  expect(await accounts.json()).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'existing-credential', providerId: 'credential', accountId: 'existing-user' }),
    expect.objectContaining({ id: 'existing-github', providerId: 'github', accountId: 'existing-github-id' }),
  ]))

  const existingSignOut = await request.post('/api/auth/sign-out', { headers, data: {} })
  await expect(existingSignOut).toBeOK()
  expect(await (await request.get('/api/auth/get-session')).json()).toBeNull()

  const email = 'new-user@example.com'
  const password = 'new-password-123'
  const signUp = await request.post('/api/auth/sign-up/email', {
    headers,
    data: { name: 'New User', email, password },
  })
  await expect(signUp).toBeOK()
  const createdAccount = await signUp.json()
  expect(createdAccount).toMatchObject({ user: { name: 'New User', email } })

  const session = await request.get('/api/auth/get-session')
  await expect(session).toBeOK()
  expect(await session.json()).toMatchObject({ user: { id: createdAccount.user.id, email } })

  const signOut = await request.post('/api/auth/sign-out', { headers, data: {} })
  await expect(signOut).toBeOK()
  expect(await (await request.get('/api/auth/get-session')).json()).toBeNull()

  const signIn = await request.post('/api/auth/sign-in/email', {
    headers,
    data: { email, password },
  })
  await expect(signIn).toBeOK()
  const signedInSession = await request.get('/api/auth/get-session')
  await expect(signedInSession).toBeOK()
  expect(await signedInSession.json()).toMatchObject({ user: { id: createdAccount.user.id } })

  const user = { name: 'API User', email: 'api-user@example.com' }
  const createUser = await request.post('/api/users', { data: user })
  await expect(createUser).toBeOK()
  expect(await createUser.json()).toMatchObject({ ok: true, user })

  const users = await request.get('/api/users')
  await expect(users).toBeOK()
  expect(await users.json()).toMatchObject({
    ok: true,
    users: expect.arrayContaining([
      expect.objectContaining({ id: 'existing-user', email: 'existing@example.com' }),
      expect.objectContaining({ id: createdAccount.user.id, email }),
      expect.objectContaining(user),
    ]),
  })

  const duplicate = await request.post('/api/users', { data: user })
  expect(duplicate.status()).toBe(409)
})
