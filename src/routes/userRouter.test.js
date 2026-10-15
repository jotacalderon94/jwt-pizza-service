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

test('admin can list users with pagination', async () => {
  const response = await request(app)
    .get('/api/user?page=1&limit=10&name=*')
    .set('Authorization', `Bearer ${adminToken}`);

  expect(response.status).toBe(200);
  expect(response.body.users).toBeInstanceOf(Array);
  expect(response.body.users.length).toBeLessThanOrEqual(10);
  expect(response.body.more).toEqual(expect.any(Boolean));

  if (response.body.users.length > 0) {
    expect(response.body.users[0]).toMatchObject({
      id: expect.any(Number),
      name: expect.any(String),
      email: expect.any(String),
      roles: expect.any(Array),
    });

    expect(response.body.users[0].password).toBeUndefined();
  }
});

test('non-admin cannot list users', async () => {
  const response = await request(app)
    .get('/api/user')
    .set('Authorization', `Bearer ${dinerToken}`);

  expect(response.status).toBe(403);
});

test('list users requires authentication', async () => {
  const response = await request(app).get('/api/user');

  expect(response.status).toBe(401);
});

test('admin can filter users by name', async () => {
  const uniqueName = `filter-target-${suffix()}`;

  await DB.addUser({
    name: uniqueName,
    email: `${suffix()}@test.com`,
    password: 'password123',
    roles: [{ role: Role.Diner }],
  });

  const response = await request(app)
    .get(`/api/user?page=1&limit=10&name=${encodeURIComponent(uniqueName)}`)
    .set('Authorization', `Bearer ${adminToken}`);

  expect(response.status).toBe(200);
  expect(response.body.users).toHaveLength(1);
  expect(response.body.users[0].name).toBe(uniqueName);
  expect(response.body.more).toBe(false);
});

test('admin can delete another user', async () => {
  const email = `${suffix()}@test.com`;

  const target = await DB.addUser({
    name: `delete target ${suffix()}`,
    email,
    password: 'password123',
    roles: [{ role: Role.Diner }],
  });

  const response = await request(app)
    .delete(`/api/user/${target.id}`)
    .set('Authorization', `Bearer ${adminToken}`);

  expect(response.status).toBe(200);
  expect(response.body).toEqual({ message: 'user deleted' });

  await expect(DB.getUser(email)).rejects.toThrow('unknown user');
});

test('non-admin cannot delete users', async () => {
  const response = await request(app)
    .delete('/api/user/1')
    .set('Authorization', `Bearer ${dinerToken}`);

  expect(response.status).toBe(403);
});

test('admin cannot delete their own account', async () => {
  const response = await request(app)
    .get('/api/user/me')
    .set('Authorization', `Bearer ${adminToken}`);

  const deletion = await request(app)
    .delete(`/api/user/${response.body.id}`)
    .set('Authorization', `Bearer ${adminToken}`);

  expect(deletion.status).toBe(403);
});

test('deleting a nonexistent user returns 404', async () => {
  const response = await request(app)
    .delete('/api/user/999999999')
    .set('Authorization', `Bearer ${adminToken}`);

  expect(response.status).toBe(404);
});

test('user can update only their name', async () => {
  const email = `${suffix()}@test.com`;
  const password = 'original-password';

  const target = await DB.addUser({
    name: 'Original Name',
    email,
    password,
    roles: [{ role: Role.Diner }],
  });

  const token = (
    await request(app)
      .put('/api/auth')
      .send({ email, password })
  ).body.token;

  const updatedName = `New Name ${suffix()}`;

  const response = await request(app)
    .put(`/api/user/${target.id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ name: updatedName });

  expect(response.status).toBe(200);
  expect(response.body.user.name).toBe(updatedName);
  expect(response.body.user.email).toBe(email);
  expect(response.body.token).toEqual(expect.any(String));
});

test('invalid pagination returns 400', async () => {
  const response = await request(app)
    .get('/api/user?page=0&limit=-1')
    .set('Authorization', `Bearer ${adminToken}`);

  expect(response.status).toBe(400);
});

test('user can update only their email and log in again', async () => {
  const originalEmail = `${suffix()}@test.com`;
  const newEmail = `${suffix()}@test.com`;
  const password = 'email-test-password';

  const target = await DB.addUser({
    name: 'Email Test User',
    email: originalEmail,
    password,
    roles: [{ role: Role.Diner }],
  });

  const login = await request(app)
    .put('/api/auth')
    .send({ email: originalEmail, password });

  const update = await request(app)
    .put(`/api/user/${target.id}`)
    .set('Authorization', `Bearer ${login.body.token}`)
    .send({ email: newEmail });

  expect(update.status).toBe(200);
  expect(update.body.user.email).toBe(newEmail);

  const newLogin = await request(app)
    .put('/api/auth')
    .send({ email: newEmail, password });

  expect(newLogin.status).toBe(200);
  expect(newLogin.body.token).toEqual(expect.any(String));
});

test('list users returns more when additional pages exist', async () => {
  const response = await request(app)
    .get('/api/user?page=1&limit=1&name=*')
    .set('Authorization', `Bearer ${adminToken}`);

  expect(response.status).toBe(200);
  expect(response.body.users).toHaveLength(1);
  expect(response.body.more).toBe(true);

  const secondPage = await request(app)
    .get('/api/user?page=2&limit=1&name=*')
    .set('Authorization', `Bearer ${adminToken}`);

  expect(secondPage.status).toBe(200);
  expect(secondPage.body.users).toHaveLength(1);
  expect(secondPage.body.users[0].id)
    .not.toBe(response.body.users[0].id);
});

test('deleted user can no longer use their authentication token', async () => {
  const email = `${suffix()}@test.com`;
  const password = 'delete-token-password';

  const target = await DB.addUser({
    name: 'Token Deletion Test',
    email,
    password,
    roles: [{ role: Role.Diner }],
  });

  const login = await request(app)
    .put('/api/auth')
    .send({ email, password });

  expect(login.status).toBe(200);

  const deletion = await request(app)
    .delete(`/api/user/${target.id}`)
    .set('Authorization', `Bearer ${adminToken}`);

  expect(deletion.status).toBe(200);

  const profile = await request(app)
    .get('/api/user/me')
    .set('Authorization', `Bearer ${login.body.token}`);

  expect(profile.status).toBe(401);
});