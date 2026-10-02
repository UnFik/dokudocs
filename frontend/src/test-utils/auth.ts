export function testSession(
  id = 'b4d13df7-76a2-4da5-8817-91d40f832abd',
  exp = Math.floor(Date.now() / 1000) + 3600
) {
  const user = {
    id,
    accountNo: 'ACC-1',
    email: 'user@example.com',
    role: ['member'],
    exp,
  }
  const accessToken = `${btoa(JSON.stringify({ alg: 'HS256' }))}.${btoa(JSON.stringify({ sub: id, exp }))}.signature`
  return { user, accessToken }
}
export function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(status < 400 ? { data } : data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
