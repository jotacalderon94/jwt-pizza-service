const request = require('supertest');
const app = require('../service');
const jwt = require('jsonwebtoken');
const { DB } = require('../database/database');

const testUser = { name: 'pizza diner', email: 'reg@test.com', password: 'a' };
let testUserAuthToken;

beforeAll(async () => {
  testUser.email = Math.random().toString(36).substring(2, 12) + '@test.com';
  const registerRes = await request(app).post('/api/auth').send(testUser);
  testUserAuthToken = registerRes.body.token;
  expectValidJwt(testUserAuthToken);
});

test('login', async () => {
  const loginRes = await request(app).put('/api/auth').send(testUser);
  expect(loginRes.status).toBe(200);
  expectValidJwt(loginRes.body.token);

  const expectedUser = { ...testUser, roles: [{ role: 'diner' }] };
  delete expectedUser.password;
  expect(loginRes.body.user).toMatchObject(expectedUser);
});

test('registration validates required fields', async () => {
  const registerRes = await request(app).post('/api/auth').send({ email: 'missing-fields@test.com' });

  expect(registerRes.status).toBe(400);
  expect(registerRes.body).toEqual({ message: 'name, email, and password are required' });
});

test('login rejects an unknown user', async () => {
  const loginRes = await request(app).put('/api/auth').send({ email: `${randomSuffix()}@test.com`, password: 'wrong' });

  expect(loginRes.status).toBe(404);
  expect(loginRes.body.message).toBe('unknown user');
});

test('invalid logged-in JWTs are rejected', async () => {
  const invalidToken = jwt.sign({ id: 1 }, 'a different secret');
  await DB.loginUser(1, invalidToken);

  const response = await request(app).get('/api/user/me').set('Authorization', `Bearer ${invalidToken}`);

  expect(response.status).toBe(401);
  await DB.logoutUser(invalidToken);
});

test('logout invalidates a token', async () => {
  const logoutRes = await request(app).delete('/api/auth').set('Authorization', `Bearer ${testUserAuthToken}`);
  expect(logoutRes.status).toBe(200);
  expect(logoutRes.body).toEqual({ message: 'logout successful' });

  const afterLogout = await request(app).get('/api/user/me').set('Authorization', `Bearer ${testUserAuthToken}`);
  expect(afterLogout.status).toBe(401);

  const withoutToken = await request(app).delete('/api/auth');
  expect(withoutToken.status).toBe(401);
});

function randomSuffix() {
  return Math.random().toString(36).slice(2, 12);
}

function expectValidJwt(potentialJwt) {
  expect(potentialJwt).toMatch(/^[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*$/);
}
