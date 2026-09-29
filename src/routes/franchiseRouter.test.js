const request = require('supertest');
const app = require('../service');
const { DB, Role } = require('../database/database');

const suffix = () => Math.random().toString(36).slice(2, 12);
const admin = { name: `franchise admin ${suffix()}`, email: `${suffix()}@test.com`, password: 'admin-password' };
const diner = { name: `franchise diner ${suffix()}`, email: `${suffix()}@test.com`, password: 'diner-password' };
const franchisee = { name: `franchisee ${suffix()}`, email: `${suffix()}@test.com`, password: 'franchisee-password' };
let adminToken;
let dinerToken;
let franchiseeToken;
let baseFranchise;
let baseStore;

beforeAll(async () => {
  await DB.addUser({ ...admin, roles: [{ role: Role.Admin }] });
  await DB.addUser({ ...diner, roles: [{ role: Role.Diner }] });
  await DB.addUser({ ...franchisee, roles: [{ role: Role.Diner }] });
  baseFranchise = await DB.createFranchise({ name: `Base franchise ${suffix()}`, admins: [{ email: franchisee.email }] });
  baseStore = await DB.createStore(baseFranchise.id, { name: `Base store ${suffix()}` });
  adminToken = (await request(app).put('/api/auth').send(admin)).body.token;
  dinerToken = (await request(app).put('/api/auth').send(diner)).body.token;
  franchiseeToken = (await request(app).put('/api/auth').send(franchisee)).body.token;
});

test('franchise listings show stores to diners and full details to admins', async () => {
  const dinerResponse = await request(app).get('/api/franchise').query({ name: baseFranchise.name });
  const adminResponse = await request(app).get('/api/franchise').query({ name: baseFranchise.name }).set('Authorization', `Bearer ${adminToken}`);

  expect(dinerResponse.status).toBe(200);
  expect(dinerResponse.body.franchises).toEqual(expect.arrayContaining([expect.objectContaining({ id: baseFranchise.id, stores: expect.any(Array) })]));
  expect(adminResponse.status).toBe(200);
  expect(adminResponse.body.franchises).toEqual(expect.arrayContaining([expect.objectContaining({ id: baseFranchise.id, admins: expect.any(Array), stores: expect.any(Array) })]));
});

test('users can only view their own franchise assignments', async () => {
  const own = await request(app).get(`/api/franchise/${(await DB.getUser(franchisee.email, franchisee.password)).id}`).set('Authorization', `Bearer ${franchiseeToken}`);
  const other = await request(app).get(`/api/franchise/${(await DB.getUser(diner.email, diner.password)).id}`).set('Authorization', `Bearer ${franchiseeToken}`);
  const adminView = await request(app).get(`/api/franchise/${(await DB.getUser(franchisee.email, franchisee.password)).id}`).set('Authorization', `Bearer ${adminToken}`);

  expect(own.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: baseFranchise.id })]));
  expect(other.body).toEqual([]);
  expect(adminView.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: baseFranchise.id })]));
});

test('only admins can create franchises', async () => {
  const franchise = { name: `Created franchise ${suffix()}`, admins: [{ email: franchisee.email }] };
  const unauthenticated = await request(app).post('/api/franchise').send(franchise);
  const dinerResponse = await request(app).post('/api/franchise').set('Authorization', `Bearer ${dinerToken}`).send(franchise);
  const adminResponse = await request(app).post('/api/franchise').set('Authorization', `Bearer ${adminToken}`).send(franchise);

  expect(unauthenticated.status).toBe(401);
  expect(dinerResponse.status).toBe(403);
  expect(adminResponse.status).toBe(200);
  expect(adminResponse.body).toMatchObject({ name: franchise.name, admins: [{ email: franchisee.email, id: expect.any(Number) }] });
});

test('admins and franchise admins can create and delete stores', async () => {
  const deniedCreate = await request(app).post(`/api/franchise/${baseFranchise.id}/store`).set('Authorization', `Bearer ${dinerToken}`).send({ name: 'denied' });
  const adminCreated = await request(app).post(`/api/franchise/${baseFranchise.id}/store`).set('Authorization', `Bearer ${adminToken}`).send({ name: `Admin store ${suffix()}` });
  const franchiseeCreated = await request(app).post(`/api/franchise/${baseFranchise.id}/store`).set('Authorization', `Bearer ${franchiseeToken}`).send({ name: `Franchisee store ${suffix()}` });

  expect(deniedCreate.status).toBe(403);
  expect(adminCreated.status).toBe(200);
  expect(franchiseeCreated.status).toBe(200);

  const deniedDelete = await request(app).delete(`/api/franchise/${baseFranchise.id}/store/${baseStore.id}`).set('Authorization', `Bearer ${dinerToken}`);
  const adminDelete = await request(app).delete(`/api/franchise/${baseFranchise.id}/store/${adminCreated.body.id}`).set('Authorization', `Bearer ${adminToken}`);
  const franchiseeDelete = await request(app).delete(`/api/franchise/${baseFranchise.id}/store/${franchiseeCreated.body.id}`).set('Authorization', `Bearer ${franchiseeToken}`);

  expect(deniedDelete.status).toBe(403);
  expect(adminDelete.body).toEqual({ message: 'store deleted' });
  expect(franchiseeDelete.body).toEqual({ message: 'store deleted' });
});

test('unauthorized users cannot create or delete stores for a missing franchise', async () => {
  const createResponse = await request(app).post('/api/franchise/999999/store').set('Authorization', `Bearer ${dinerToken}`).send({ name: 'missing' });
  const deleteResponse = await request(app).delete('/api/franchise/999999/store/999999').set('Authorization', `Bearer ${dinerToken}`);

  expect(createResponse.status).toBe(403);
  expect(deleteResponse.status).toBe(403);
});

test('a franchise can be deleted through the endpoint', async () => {
  const disposable = await DB.createFranchise({ name: `Disposable franchise ${suffix()}`, admins: [{ email: franchisee.email }] });
  const response = await request(app).delete(`/api/franchise/${disposable.id}`);

  expect(response.status).toBe(200);
  expect(response.body).toEqual({ message: 'franchise deleted' });
  const remaining = await DB.getFranchises(null, 0, 10, disposable.name);
  expect(remaining[0]).toEqual([]);
});
