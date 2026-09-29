const request = require('supertest');
const app = require('../service');
const { DB, Role } = require('../database/database');

const suffix = () => Math.random().toString(36).slice(2, 12);
const admin = { name: `test admin ${suffix()}`, email: `${suffix()}@test.com`, password: 'admin-password' };
const diner = { name: `test diner ${suffix()}`, email: `${suffix()}@test.com`, password: 'diner-password' };
let adminToken;
let dinerToken;

beforeAll(async () => {
  await DB.addUser({ ...admin, roles: [{ role: Role.Admin }] });
  await DB.addUser({ ...diner, roles: [{ role: Role.Diner }] });
  adminToken = (await request(app).put('/api/auth').send(admin)).body.token;
  dinerToken = (await request(app).put('/api/auth').send(diner)).body.token;
});

test('authenticated users can get their profile', async () => {
  const response = await request(app).get('/api/user/me').set('Authorization', `Bearer ${dinerToken}`);

  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({ id: expect.any(Number), name: diner.name, email: diner.email, roles: [{ role: Role.Diner }] });
});

test('profile endpoints require authentication', async () => {
  const response = await request(app).get('/api/user/me');
  expect(response.status).toBe(401);
});

test('users cannot update another user', async () => {
  const response = await request(app)
    .put('/api/user/1')
    .set('Authorization', `Bearer ${dinerToken}`)
    .send({ name: 'not allowed', email: `${suffix()}@test.com`, password: 'new-password' });

  expect(response.status).toBe(403);
  expect(response.body.message).toBe('unauthorized');
});

test('an admin can update another user', async () => {
  const updatedName = `updated diner ${suffix()}`;
  const updatedEmail = `${suffix()}@test.com`;
  const response = await request(app)
    .put(`/api/user/${(await DB.getUser(diner.email, diner.password)).id}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: updatedName, email: updatedEmail, password: 'updated-password' });

  expect(response.status).toBe(200);
  expect(response.body.user).toMatchObject({ name: updatedName, email: updatedEmail });
  expect(response.body.user.password).toBeUndefined();
  expect(response.body.token).toMatch(/^[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+$/);
});

test('a user can update their own profile', async () => {
  const updatedName = `self updated ${suffix()}`;
  const updatedEmail = `${suffix()}@test.com`;
  const userId = (await DB.getUser(admin.email, admin.password)).id;
  const response = await request(app)
    .put(`/api/user/${userId}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: updatedName, email: updatedEmail, password: 'new-admin-password' });

  expect(response.status).toBe(200);
  expect(response.body.user).toMatchObject({ id: userId, name: updatedName, email: updatedEmail });
});

test('implemented placeholder user endpoints return their documented shape', async () => {
  const deleteResponse = await request(app).delete('/api/user/123').set('Authorization', `Bearer ${adminToken}`);
  const listResponse = await request(app).get('/api/user').set('Authorization', `Bearer ${adminToken}`);

  expect(deleteResponse.body).toEqual({ message: 'not implemented' });
  expect(listResponse.body).toEqual({ message: 'not implemented', users: [], more: false });
});
